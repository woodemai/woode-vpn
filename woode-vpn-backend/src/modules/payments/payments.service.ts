import {
  BadRequestException,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { VpnService } from '../vpn/vpn.service';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { YooKassaWebhookDto } from './dto/yookassa-webhook.dto';

interface YooKassaPayment {
  id: string;
  status: string;
  paid: boolean;
  amount?: {
    value?: string;
    currency?: string;
  };
  metadata?: Record<string, string>;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vpnService: VpnService,
  ) {}

  async handleYooKassaWebhook(dto: YooKassaWebhookDto) {
    const isDev = process.env.IS_DEV === 'true';

    if (dto.event !== 'payment.succeeded') {
      return { ok: true, ignored: true };
    }

    const rawPaymentId = dto.object?.id;
    if (typeof rawPaymentId !== 'string' || !rawPaymentId) {
      throw new BadRequestException('Invalid YooKassa webhook payload: payment id is missing');
    }

    // In dev mode, skip payment verification
    const payment = isDev
      ? { id: rawPaymentId, amount: { value: '100' }, metadata: dto.object?.metadata ?? {} }
      : await this.verifyYooKassaPayment(rawPaymentId);

    const metadata = payment.metadata ?? {};

    const rawUserId = metadata.userId;
    if (!rawUserId) {
      throw new BadRequestException('YooKassa payment metadata.userId is required');
    }

    const userId = Number(rawUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new BadRequestException('YooKassa payment metadata.userId must be a positive integer');
    }

    const days = metadata.days
      ? Number(metadata.days)
      : metadata.months
        ? Number(metadata.months) * 30
        : 30;
    if (!Number.isInteger(days) || days <= 0) {
      throw new BadRequestException('YooKassa payment metadata.days must be a positive integer');
    }

    const amountCents = this.toCents(payment.amount?.value);

    const response = await this.confirmPayment({
      userId,
      days,
      paymentId: payment.id,
      amountCents,
    });

    return {
      ok: true,
      event: dto.event,
      paymentId: payment.id,
      result: response,
    };
  }

  async confirmPayment(dto: ConfirmPaymentDto) {
    const isDev = process.env.IS_DEV === 'true';

    if (dto.paymentId && !isDev) {
      const existing = await this.prisma.subscription.findFirst({
        where: { paymentId: dto.paymentId },
      });

      if (existing) {
        const profile = await this.vpnService.getUserProfile(existing.userId);

        return {
          userId: existing.userId,
          endsAt: existing.endsAt,
          subscriptionUrl: profile.subscriptionUrl,
          alreadyProcessed: true,
        };
      }
    } else if (dto.paymentId && isDev) {
      const existing = await this.prisma.subscription.findFirst({
        where: { paymentId: dto.paymentId },
      });

      if (existing) {
        const profile = await this.vpnService.getUserProfile(existing.userId);

        return {
          userId: existing.userId,
          endsAt: existing.endsAt,
          subscriptionUrl: profile.subscriptionUrl,
          alreadyProcessed: true,
        };
      }
    }

    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const now = new Date();
    const days = dto.days ?? (dto.months ? dto.months * 30 : 30);

    const latestSubscription = await this.prisma.subscription.findFirst({
      where: { userId: user.id },
      orderBy: { endsAt: 'desc' },
    });

    const startsAt =
      latestSubscription && latestSubscription.endsAt > now
        ? latestSubscription.endsAt
        : now;

    const endsAt = new Date(startsAt);
    endsAt.setDate(endsAt.getDate() + days);

    if (endsAt <= startsAt) {
      throw new BadRequestException('Invalid subscription dates');
    }

    await this.prisma.subscription.create({
      data: {
        userId: user.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt,
        endsAt,
        paymentId: dto.paymentId || `dev-${Date.now()}`,
        amountCents: dto.amountCents,
      },
    });

    const vpnProvisioning = await this.vpnService.provisionForUser(user.id);

    return {
      userId: user.id,
      endsAt,
      subscriptionUrl: vpnProvisioning.subscriptionUrl,
      subscriptionText: vpnProvisioning.subscriptionText,
      alreadyProcessed: false,
    };
  }

  private async verifyYooKassaPayment(paymentId: string): Promise<YooKassaPayment> {
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secretKey = process.env.YOOKASSA_SECRET_KEY;

    if (!shopId || !secretKey) {
      throw new InternalServerErrorException(
        'YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY must be set',
      );
    }

    const token = Buffer.from(`${shopId}:${secretKey}`).toString('base64');
    const response = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${token}`,
      },
    });

    if (!response.ok) {
      throw new BadRequestException(
        `YooKassa payment verification failed with status ${response.status}`,
      );
    }

    const payment = (await response.json()) as YooKassaPayment;

    if (payment.status !== 'succeeded' || payment.paid !== true) {
      throw new BadRequestException('YooKassa payment is not completed');
    }

    return payment;
  }

  private toCents(raw?: string): number | undefined {
    if (!raw) {
      return undefined;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }

    return Math.round(parsed * 100);
  }
}
