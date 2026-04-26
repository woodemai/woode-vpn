import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { TelegramNotifierService } from './telegram-notifier.service';

type NotificationType = '3days' | '1day' | 'expired';
type SubscriptionWithUser = Prisma.SubscriptionGetPayload<{
  include: { user: true };
}>;

@Injectable()
export class SubscriptionNotifierService {
  private readonly logger = new Logger(SubscriptionNotifierService.name);
  private static readonly BATCH_SIZE = 500;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly telegramNotifierService: TelegramNotifierService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Check and send expiration notifications every hour
   */
  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'Europe/Moscow' })
  async checkAndNotifyExpiredSubscriptions(): Promise<void> {
    this.logger.debug('Starting subscription expiration check...');

    try {
      const now = new Date();
      const oneDayUpper = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const threeDaysLower = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      const threeDaysUpper = new Date(now.getTime() + 72 * 60 * 60 * 1000);

      await this.processWindow('expired', {
        status: 'ACTIVE',
        endsAt: { lte: now },
        notifiedAfterExpiration: false,
      });

      await this.processWindow('1day', {
        status: 'ACTIVE',
        endsAt: { gt: now, lte: oneDayUpper },
        notified1DayBefore: false,
      });

      await this.processWindow('3days', {
        status: 'ACTIVE',
        endsAt: { gt: threeDaysLower, lte: threeDaysUpper },
        notified3DaysBefore: false,
      });

      this.logger.debug('Subscription expiration check completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `Subscription expiration check failed: ${message}`,
        error,
      );
    }
  }

  private async processWindow(
    type: NotificationType,
    where: Prisma.SubscriptionWhereInput,
  ): Promise<void> {
    let cursorId: number | undefined;

    while (true) {
      const subscriptions = await this.prismaService.subscription.findMany({
        where,
        include: { user: true },
        orderBy: { id: 'asc' },
        take: SubscriptionNotifierService.BATCH_SIZE,
        ...(cursorId
          ? {
              cursor: { id: cursorId },
              skip: 1,
            }
          : {}),
      });

      if (!subscriptions.length) {
        break;
      }

      for (const subscription of subscriptions) {
        const now = Date.now();
        const hoursRemaining =
          (subscription.endsAt.getTime() - now) / (1000 * 60 * 60);

        await this.sendExpirationNotification(
          subscription,
          type,
          type === 'expired' ? null : Math.max(0, hoursRemaining),
        );
      }

      cursorId = subscriptions[subscriptions.length - 1].id;
    }
  }

  private async sendExpirationNotification(
    subscription: SubscriptionWithUser,
    type: NotificationType,
    hoursRemaining: number | null,
  ): Promise<void> {
    const user = subscription.user;
    const logoPath =
      this.configService.get<string>('app.telegram.logoPath') ??
      '/app/logo.jpg';

    // Skip if user doesn't have Telegram ID
    if (!user.externalId) {
      this.logger.warn(
        `Cannot notify user ${user.id}: externalId (Telegram ID) is not set`,
      );
      return;
    }

    const claimed = await this.claimNotification(subscription.id, type);
    if (!claimed) {
      return;
    }

    try {
      // Format remaining time message
      let timeMessage = '';
      if (type === 'expired') {
        timeMessage = 'Ваша подписка истекла';
      } else if (type === '1day' && hoursRemaining !== null) {
        const days = Math.floor(hoursRemaining / 24);
        const hours = Math.round(hoursRemaining % 24);
        timeMessage =
          days > 0
            ? `Осталось ${days} день${days === 1 ? '' : 'ей'} и ${hours} часов`
            : `Осталось ${Math.round(hoursRemaining)} часов`;
      } else if (type === '3days' && hoursRemaining !== null) {
        const days = Math.floor(hoursRemaining / 24);
        timeMessage = `Осталось ${days} дней`;
      }

      const caption = this.buildNotificationCaption(timeMessage, type);

      const replyMarkup = {
        inline_keyboard: [
          [
            {
              text: '🔄 Продлить подписку',
              callback_data: 'MENU_BUY',
            },
            {
              text: '⚙️ Моя подписка',
              callback_data: 'ACTION_CONFIG',
            },
          ],
        ],
      };

      // Send photo notification
      const sent = await this.telegramNotifierService.sendPhotoToChat(
        user.externalId,
        logoPath,
        caption,
        {
          parseMode: 'HTML',
          replyMarkup,
        },
      );

      if (!sent) {
        await this.releaseNotificationClaim(subscription.id, type);
        this.logger.warn(
          `Notification (${type}) was not sent to user ${user.id}, claim released`,
        );
        return;
      }

      this.logger.log(
        `Expiration notification (${type}) sent to user ${user.id} (${user.telegramName})`,
      );
    } catch (error) {
      await this.releaseNotificationClaim(subscription.id, type);
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `Failed to send notification (${type}) to user ${user.id}: ${message}`,
        error,
      );
    }
  }

  private buildNotificationCaption(timeMessage: string, type: string): string {
    let title = '';
    let description = '';

    if (type === 'expired') {
      title = '⏰ Подписка истекла';
      description =
        'Чтобы продолжить пользоваться сервисом, пожалуйста, продлите подписку.';
    } else if (type === '1day') {
      title = '⚠️ Подписка скоро закончится';
      description = `${timeMessage}.\n\nПродлите подписку, чтобы не потерять доступ.`;
    } else if (type === '3days') {
      title = '⏰ Скоро кончится подписка';
      description = `${timeMessage}.\n\nХотите продлить подписку?`;
    }

    return `<b>${title}</b>\n\n${description}`;
  }

  private async claimNotification(
    subscriptionId: number,
    type: NotificationType,
  ): Promise<boolean> {
    const where: Prisma.SubscriptionWhereInput = { id: subscriptionId };
    const data: Prisma.SubscriptionUpdateManyMutationInput = {};

    if (type === '3days') {
      where.notified3DaysBefore = false;
      data.notified3DaysBefore = true;
    } else if (type === '1day') {
      where.notified1DayBefore = false;
      data.notified1DayBefore = true;
    } else if (type === 'expired') {
      where.notifiedAfterExpiration = false;
      data.notifiedAfterExpiration = true;
    }

    const result = await this.prismaService.subscription.updateMany({
      where,
      data,
    });

    return result.count === 1;
  }

  private async releaseNotificationClaim(
    subscriptionId: number,
    type: NotificationType,
  ): Promise<void> {
    const data: Prisma.SubscriptionUpdateInput = {};

    if (type === '3days') {
      data.notified3DaysBefore = false;
    } else if (type === '1day') {
      data.notified1DayBefore = false;
    } else if (type === 'expired') {
      data.notifiedAfterExpiration = false;
    }

    await this.prismaService.subscription.update({
      where: { id: subscriptionId },
      data,
    });
  }

  /**
   * Reset all notification flags when subscription is renewed
   */
  async resetNotificationFlags(subscriptionId: number): Promise<void> {
    await this.prismaService.subscription.update({
      where: { id: subscriptionId },
      data: {
        notified3DaysBefore: false,
        notified1DayBefore: false,
        notifiedAfterExpiration: false,
      },
    });
    this.logger.debug(
      `Notification flags reset for subscription ${subscriptionId}`,
    );
  }
}
