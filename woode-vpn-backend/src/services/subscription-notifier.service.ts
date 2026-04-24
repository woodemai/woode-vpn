import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../db/prisma.service';
import { TelegramNotifierService } from './telegram-notifier.service';

interface NotificationEvent {
    type: '3days' | '1day' | 'expired';
    hoursRemaining: number | null;
}

@Injectable()
export class SubscriptionNotifierService {
    private readonly logger = new Logger(SubscriptionNotifierService.name);

    constructor(
        private readonly prismaService: PrismaService,
        private readonly telegramNotifierService: TelegramNotifierService,
    ) { }

    /**
     * Check and send expiration notifications every hour
     */
    @Cron(CronExpression.EVERY_HOUR)
    async checkAndNotifyExpiredSubscriptions(): Promise<void> {
        this.logger.debug('Starting subscription expiration check...');

        try {
            const now = new Date();
            const subscriptions = await this.prismaService.subscription.findMany({
                where: {
                    status: 'ACTIVE',
                },
                include: {
                    user: true,
                },
            });

            for (const subscription of subscriptions) {
                const hoursRemaining =
                    (subscription.endsAt.getTime() - now.getTime()) / (1000 * 60 * 60);

                // Check notifications in descending order (expired -> 1 day -> 3 days)
                // This ensures we don't skip notifications if they happen in the same cron run

                // 1. Subscription expired
                if (hoursRemaining < 0 && !subscription.notifiedAfterExpiration) {
                    await this.sendExpirationNotification(subscription, 'expired', null);
                }
                // 2. 1 day before (24 to 0 hours)
                else if (
                    hoursRemaining <= 24 &&
                    hoursRemaining > 0 &&
                    !subscription.notified1DayBefore
                ) {
                    await this.sendExpirationNotification(subscription, '1day', hoursRemaining);
                }
                // 3. 3 days before (72 to 48 hours)
                else if (
                    hoursRemaining <= 72 &&
                    hoursRemaining > 48 &&
                    !subscription.notified3DaysBefore
                ) {
                    await this.sendExpirationNotification(subscription, '3days', hoursRemaining);
                }
            }

            this.logger.debug('Subscription expiration check completed');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            this.logger.error(`Subscription expiration check failed: ${message}`, error);
        }
    }

    private async sendExpirationNotification(
        subscription: any,
        type: '3days' | '1day' | 'expired',
        hoursRemaining: number | null,
    ): Promise<void> {
        const user = subscription.user;

        // Skip if user doesn't have Telegram ID
        if (!user.externalId) {
            this.logger.warn(
                `Cannot notify user ${user.id}: externalId (Telegram ID) is not set`,
            );
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
                            callback_data: 'buy_devices',
                        },
                        {
                            text: '📊 Моя подписка',
                            callback_data: 'my_subscription',
                        },
                    ],
                ],
            };

            // Send photo notification
            await this.telegramNotifierService.sendPhotoToChat(
                user.externalId,
                '/app/logo.jpg',
                caption,
                {
                    parseMode: 'HTML',
                    replyMarkup,
                },
            );

            // Update notification flag
            await this.updateNotificationFlag(subscription.id, type);

            this.logger.log(
                `Expiration notification (${type}) sent to user ${user.id} (${user.telegramName})`,
            );
        } catch (error) {
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

    private async updateNotificationFlag(
        subscriptionId: number,
        type: '3days' | '1day' | 'expired',
    ): Promise<void> {
        const updateData: Record<string, boolean> = {};

        if (type === '3days') {
            updateData.notified3DaysBefore = true;
        } else if (type === '1day') {
            updateData.notified1DayBefore = true;
        } else if (type === 'expired') {
            updateData.notifiedAfterExpiration = true;
        }

        await this.prismaService.subscription.update({
            where: { id: subscriptionId },
            data: updateData,
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
        this.logger.debug(`Notification flags reset for subscription ${subscriptionId}`);
    }
}
