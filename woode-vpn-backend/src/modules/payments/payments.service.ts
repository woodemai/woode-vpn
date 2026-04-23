import {
  BadRequestException,
  InternalServerErrorException,
  Injectable,
  Logger,
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

const PLAN_PRICE_CENTS: Record<number, Record<number, number>> = {
  30: {
    5: 10000,
    10: 15000,
    15: 20000,
  },
  90: {
    5: 27000,
    10: 40000,
    15: 54000,
  },
  180: {
    5: 51000,
    10: 76000,
    15: 100000,
  },
  365: {
    5: 100000,
    10: 145000,
    15: 200000,
  },
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vpnService: VpnService,
  ) {}

  async handleYooKassaWebhook(dto: YooKassaWebhookDto) {
    const startedAt = Date.now();
    const isDev = process.env.IS_DEV === 'true';

    if (dto.event !== 'payment.succeeded') {
      return { ok: true, ignored: true };
    }

    const rawPaymentId = dto.object?.id;
    if (typeof rawPaymentId !== 'string' || !rawPaymentId) {
      throw new BadRequestException('Invalid YooKassa webhook payload: payment id is missing');
    }

    const webhookMetadata = this.extractMetadata(dto.object);

    // In dev mode, skip payment verification and emulate a successful payment.
    const payment: YooKassaPayment = isDev
      ? {
          id: rawPaymentId,
          status: 'succeeded',
          paid: true,
          amount: { value: '100' },
          metadata: webhookMetadata,
        }
      : await this.verifyYooKassaPayment(rawPaymentId);

    const metadata = payment.metadata ?? {};

    const rawUserId = metadata.userId ?? '';
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

    const deviceLimit = metadata.deviceLimit ? Number(metadata.deviceLimit) : undefined;

    const amountCents = this.toCents(payment.amount?.value);

    const response = await this.confirmPayment({
      userId,
      days,
      paymentId: payment.id,
      amountCents,
      deviceLimit,
    });

    this.logger.log(
      `Webhook processed: paymentId=${payment.id}, userId=${userId}, days=${days}, isDev=${isDev}, durationMs=${Date.now() - startedAt}`,
    );

    return {
      ok: true,
      event: dto.event,
      paymentId: payment.id,
      result: response,
    };
  }

  async confirmPayment(dto: ConfirmPaymentDto) {
    const startedAt = Date.now();
    const isDev = process.env.IS_DEV === 'true';

    this.logger.log(
      `confirmPayment started: userId=${dto.userId}, days=${dto.days ?? 'n/a'}, months=${dto.months ?? 'n/a'}, deviceLimit=${dto.deviceLimit ?? 'n/a'}, paymentId=${dto.paymentId ?? 'n/a'}, isDev=${isDev}`,
    );

    if (dto.paymentId) {
      const existing = await this.prisma.subscription.findFirst({
        where: { paymentId: dto.paymentId },
      });

      if (existing) {
        const profile = await this.vpnService.getUserProfile(existing.userId);
        this.logger.log(
          `confirmPayment idempotent hit: paymentId=${dto.paymentId}, userId=${existing.userId}, durationMs=${Date.now() - startedAt}`,
        );

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
    const deviceLimit = dto.deviceLimit ?? 5;

    const expectedAmountCents = this.resolvePlanPrice(days, deviceLimit);
    if (
      typeof expectedAmountCents === 'number' &&
      typeof dto.amountCents === 'number' &&
      dto.amountCents !== expectedAmountCents
    ) {
      throw new BadRequestException(
        `Invalid amount for selected plan: expected ${expectedAmountCents}, got ${dto.amountCents}`,
      );
    }

    const amountCents =
      typeof expectedAmountCents === 'number'
        ? expectedAmountCents
        : dto.amountCents;

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
        paymentId: dto.paymentId ?? (isDev ? `dev-${Date.now()}` : undefined),
        amountCents,
      },
    });

    const vpnProvisioning = await this.vpnService.provisionForUser(user.id);

    this.logger.log(
      `confirmPayment finished: userId=${user.id}, endsAt=${endsAt.toISOString()}, durationMs=${Date.now() - startedAt}`,
    );

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

  private extractMetadata(rawObject: Record<string, unknown>): Record<string, string> {
    const rawMetadata = rawObject.metadata;
    if (!rawMetadata || typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
      return {};
    }

    const metadataEntries = Object.entries(rawMetadata as Record<string, unknown>)
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
      .map(([key, value]) => [key, String(value)]);

    return Object.fromEntries(metadataEntries);
  }

  private resolvePlanPrice(days: number, deviceLimit: number): number | undefined {
    const dayPrices = PLAN_PRICE_CENTS[days];
    if (!dayPrices) {
      return undefined;
    }

    const price = dayPrices[deviceLimit];
    if (typeof price !== 'number') {
      throw new BadRequestException('Unsupported number of devices for selected period');
    }

    return price;
  }
}
