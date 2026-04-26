import {
  BadRequestException,
  InternalServerErrorException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../db/prisma.service';
import { VpnService } from '../vpn/vpn.service';
import { TelegramNotifierService } from '../../services/telegram-notifier.service';
import { SubscriptionNotifierService } from '../../services/subscription-notifier.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
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

interface YooKassaCreatedPayment {
  id: string;
  confirmation?: {
    type?: string;
    confirmation_url?: string;
  };
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
    private readonly telegramNotifierService: TelegramNotifierService,
    private readonly subscriptionNotifierService: SubscriptionNotifierService,
    private readonly configService: ConfigService,
  ) { }

  async createYooKassaPayment(dto: CreatePaymentDto) {
    const startedAt = Date.now();
    this.logger.log(
      `createYooKassaPayment started: userId=${dto.userId}, days=${dto.days ?? 'n/a'}, deviceLimit=${dto.deviceLimit ?? 'n/a'}`,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const days = dto.days ?? 30;
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

    if (typeof amountCents !== 'number') {
      throw new BadRequestException('Amount is required for the selected plan');
    }

    const payment =
      process.env.IS_DEV === 'true'
        ? {
          id: `dev-${randomUUID()}`,
          confirmation: {
            type: 'redirect',
            confirmation_url: this.buildDevPaymentUrl(
              dto.userId,
              days,
              deviceLimit,
              amountCents,
            ),
          },
        }
        : await this.createYooKassaPaymentIntent({
          userId: user.id,
          days,
          deviceLimit,
          amountCents,
          returnUrl: dto.returnUrl,
        });

    const confirmationUrl = payment.confirmation?.confirmation_url;
    if (!confirmationUrl) {
      throw new InternalServerErrorException(
        'YooKassa confirmation URL is missing',
      );
    }

    this.logger.log(
      `createYooKassaPayment finished: userId=${user.id}, paymentId=${payment.id}, durationMs=${Date.now() - startedAt}`,
    );

    return {
      userId: user.id,
      days,
      deviceLimit,
      amountCents,
      paymentId: payment.id,
      paymentUrl: confirmationUrl,
    };
  }

  async handleYooKassaWebhook(dto: YooKassaWebhookDto) {
    const startedAt = Date.now();
    const isDev = process.env.IS_DEV === 'true';

    if (dto.event !== 'payment.succeeded') {
      return { ok: true, ignored: true };
    }

    const rawPaymentId = dto.object?.id;
    if (typeof rawPaymentId !== 'string' || !rawPaymentId) {
      throw new BadRequestException(
        'Invalid YooKassa webhook payload: payment id is missing',
      );
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
      throw new BadRequestException(
        'YooKassa payment metadata.userId is required',
      );
    }

    const userId = Number(rawUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new BadRequestException(
        'YooKassa payment metadata.userId must be a positive integer',
      );
    }

    const days = metadata.days ? Number(metadata.days) : 30;
    if (!Number.isInteger(days) || days <= 0) {
      throw new BadRequestException(
        'YooKassa payment metadata.days must be a positive integer',
      );
    }

    const deviceLimit = metadata.deviceLimit
      ? Number(metadata.deviceLimit)
      : undefined;

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
      `confirmPayment started: userId=${dto.userId}, days=${dto.days ?? 'n/a'}, deviceLimit=${dto.deviceLimit ?? 'n/a'}, paymentId=${dto.paymentId ?? 'n/a'}, isDev=${isDev}`,
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

    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const now = new Date();
    const days = dto.days ?? 30;
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
      where: { userId: user.id, status: SubscriptionStatus.ACTIVE },
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

    const newSubscription = await this.prisma.subscription.create({
      data: {
        userId: user.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt,
        endsAt,
        paymentId: dto.paymentId ?? (isDev ? `dev-${Date.now()}` : undefined),
        amountCents,
      },
    });

    // Reset notification flags for the new subscription
    await this.subscriptionNotifierService.resetNotificationFlags(
      newSubscription.id,
    );

    const profileSnapshot = dto.paymentId
      ? await this.vpnService.getUserProfile(user.id).catch(() => undefined)
      : undefined;

    let vpnProvisioning:
      | { subscriptionUrl: string; subscriptionText: string }
      | undefined;
    try {
      vpnProvisioning = await this.vpnService.provisionForUser(user.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `confirmPayment provisioning failed for userId=${user.id}: ${message}`,
      );
    }

    if (dto.paymentId && user.externalId) {
      const chatId = user.externalId;
      const logoPath =
        this.configService.get<string>('app.telegram.logoPath') ??
        '/app/logo.jpg';
      const subscriptionUrl =
        vpnProvisioning?.subscriptionUrl ??
        profileSnapshot?.subscriptionUrl ??
        '';

      const caption = this.buildSubscriptionNotificationCaption({
        subscriptionUrl,
        profileName:
          profileSnapshot?.profileName ?? user.telegramName ?? undefined,
        endsAt,
        devicesConnected: profileSnapshot?.devicesConnected,
        devicesMax: profileSnapshot?.devicesMax,
        trafficUsedBytes: profileSnapshot?.trafficUsedBytes,
        trafficTotalBytes: profileSnapshot?.trafficTotalBytes,
      });

      const sent = await this.telegramNotifierService.sendPhotoToChat(
        chatId,
        logoPath,
        caption,
        {
          parseMode: 'HTML',
          replyMarkup: this.buildSubscriptionReplyMarkup(),
        },
      );

      if (!sent) {
        this.logger.warn(
          `Post-payment telegram notification was not sent: userId=${user.id}, chatId=${chatId}`,
        );
      }
    }

    this.logger.log(
      `confirmPayment finished: userId=${user.id}, endsAt=${endsAt.toISOString()}, durationMs=${Date.now() - startedAt}`,
    );

    return {
      userId: user.id,
      endsAt,
      subscriptionUrl:
        vpnProvisioning?.subscriptionUrl ??
        profileSnapshot?.subscriptionUrl ??
        '',
      subscriptionText: vpnProvisioning?.subscriptionText,
      alreadyProcessed: false,
    };
  }

  private async createYooKassaPaymentIntent(input: {
    userId: number;
    days: number;
    deviceLimit: number;
    amountCents: number;
    returnUrl?: string;
  }): Promise<YooKassaCreatedPayment> {
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secretKey = process.env.YOOKASSA_SECRET_KEY;

    if (!shopId || !secretKey) {
      throw new InternalServerErrorException(
        'YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY must be set',
      );
    }

    const token = Buffer.from(`${shopId}:${secretKey}`).toString('base64');
    const amountValue = (input.amountCents / 100).toFixed(2);
    const response = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
        'Idempotence-Key': randomUUID(),
      },
      body: JSON.stringify({
        amount: {
          value: amountValue,
          currency: 'RUB',
        },
        capture: true,
        confirmation: {
          type: 'redirect',
          return_url:
            input.returnUrl?.trim() ||
            process.env.APP_PUBLIC_BASE_URL ||
            'https://t.me',
        },
        description: `WoodeVPN ${input.days} days / ${input.deviceLimit} devices`,
        metadata: {
          userId: String(input.userId),
          days: String(input.days),
          deviceLimit: String(input.deviceLimit),
          amountCents: String(input.amountCents),
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new BadRequestException(
        `YooKassa payment creation failed with status ${response.status}: ${text}`,
      );
    }

    return (await response.json()) as YooKassaCreatedPayment;
  }

  private buildDevPaymentUrl(
    userId: number,
    days: number,
    deviceLimit: number,
    amountCents: number,
  ): string {
    const params = new URLSearchParams({
      userId: String(userId),
      days: String(days),
      deviceLimit: String(deviceLimit),
      amountCents: String(amountCents),
    });

    return `${process.env.APP_PUBLIC_BASE_URL ?? 'https://example.com'}/payments/dev?${params.toString()}`;
  }

  private buildSubscriptionReplyMarkup(): Record<string, unknown> {
    return {
      inline_keyboard: [
        [{ text: '🔄 Продлить подписку', callback_data: 'MENU_BUY' }],
        [
          { text: '📰 Новости', url: 'https://t.me/woodenews' },
          { text: '🛟 Поддержка', url: 'https://t.me/woodemai' },
        ],
      ],
    };
  }

  private buildSubscriptionNotificationCaption(input: {
    subscriptionUrl?: string;
    profileName?: string;
    endsAt: Date;
    devicesConnected?: number;
    devicesMax?: number;
    trafficUsedBytes?: number;
    trafficTotalBytes?: number | null;
  }): string {
    const baseParts = [
      '<b>WoodeVPN ✨</b>',
      '',
      `<blockquote>${[
        `👤 <b>Профиль:</b> ${this.escapeHtml((input.profileName ?? 'не указано').trim())}`,
        `📅 <b>Дата окончания:</b> ${this.formatMoscowDate(input.endsAt)}`,
        `⏳ <b>Осталось времени:</b> ${this.formatRemainingTime(input.endsAt)}`,
        `📱 <b>Устройства:</b> ${typeof input.devicesConnected === 'number' &&
          typeof input.devicesMax === 'number'
          ? `${input.devicesConnected}/${input.devicesMax}`
          : '—'
        }`,
        `📊 <b>Трафик:</b> ${this.formatTraffic(input.trafficUsedBytes, input.trafficTotalBytes)}`,
      ].join('\n')}</blockquote>`,
      '',
      '✅ Подписка успешно продлена!',
      '',
    ];

    if (!input.subscriptionUrl) {
      return [
        ...baseParts,
        'Ссылка готовится.',
      ].join('\n');
    }

    return [
      ...baseParts,
      '',
      '<b>📲 Как подключить подписку в Happ</b>',
      '',
      '1️⃣ Откройте приложение Happ',
      '2️⃣ Нажмите «Добавить подписку»',
      '3️⃣ Выберите «Добавить по QR коду» (выше на экране)',
      '',
      '<b>🔗 Ссылка подписки:</b>',
      `<code>${this.escapeHtml(input.subscriptionUrl)}</code>`,
    ].join('\n');
  }

  private formatTraffic(
    usedBytes?: number,
    totalBytes?: number | null,
  ): string {
    const used = typeof usedBytes === 'number' ? usedBytes : 0;
    if (typeof totalBytes === 'number' && totalBytes > 0) {
      return `${this.formatBytes(used)}/${this.formatBytes(totalBytes)}`;
    }

    return `${this.formatBytes(used)}/∞`;
  }

  private formatBytes(bytes: number): string {
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let value = Math.max(0, bytes);
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    const rounded =
      value >= 100 || unitIndex === 0
        ? Math.round(value).toString()
        : value.toFixed(1);

    return `${rounded} ${units[unitIndex]}`;
  }

  private formatMoscowDate(endsAt: Date): string {
    return (
      new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .format(endsAt)
        .replace(',', '') + ' (МСК)'
    );
  }

  private formatRemainingTime(endsAt: Date): string {
    const diffMs = Math.max(0, endsAt.getTime() - Date.now());
    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    return `${days} дн ${hours} ч ${minutes} мин`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private async verifyYooKassaPayment(
    paymentId: string,
  ): Promise<YooKassaPayment> {
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secretKey = process.env.YOOKASSA_SECRET_KEY;

    if (!shopId || !secretKey) {
      throw new InternalServerErrorException(
        'YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY must be set',
      );
    }

    const token = Buffer.from(`${shopId}:${secretKey}`).toString('base64');
    const response = await fetch(
      `https://api.yookassa.ru/v3/payments/${paymentId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Basic ${token}`,
        },
      },
    );

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

  private extractMetadata(
    rawObject: Record<string, unknown>,
  ): Record<string, string> {
    const rawMetadata = rawObject.metadata;
    if (
      !rawMetadata ||
      typeof rawMetadata !== 'object' ||
      Array.isArray(rawMetadata)
    ) {
      return {};
    }

    const metadataEntries = Object.entries(
      rawMetadata as Record<string, unknown>,
    )
      .filter(([, value]) =>
        ['string', 'number', 'boolean'].includes(typeof value),
      )
      .map(([key, value]) => [key, String(value)]);

    return Object.fromEntries(metadataEntries);
  }

  private resolvePlanPrice(
    days: number,
    deviceLimit: number,
  ): number | undefined {
    const dayPrices = PLAN_PRICE_CENTS[days];
    if (!dayPrices) {
      return undefined;
    }

    const price = dayPrices[deviceLimit];
    if (typeof price !== 'number') {
      throw new BadRequestException(
        'Unsupported number of devices for selected period',
      );
    }

    return price;
  }
}
