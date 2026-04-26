import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { TelegramNotifierService } from '../../services/telegram-notifier.service';
import { VpnService } from '../vpn/vpn.service';

@Injectable()
export class AdminSubscriptionsService {
    private readonly logger = new Logger(AdminSubscriptionsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly vpnService: VpnService,
        private readonly telegramNotifierService: TelegramNotifierService,
    ) { }

    async cancelLastSubscription(subscriptionId: number): Promise<{
        success: boolean;
        subscriptionId: number;
        userId: number;
        status: 'CANCELED';
    }> {
        const subscription = await this.prisma.subscription.findUnique({
            where: { id: subscriptionId },
            include: { user: true },
        });

        if (!subscription) {
            throw new NotFoundException('Подписка не найдена');
        }

        const latestSubscription = await this.prisma.subscription.findFirst({
            where: {
                userId: subscription.userId,
                status: SubscriptionStatus.ACTIVE,
            },
            orderBy: [{ endsAt: 'desc' }, { id: 'desc' }],
        });

        if (!latestSubscription || latestSubscription.id !== subscription.id) {
            throw new BadRequestException('Можно отменить только последнюю подписку пользователя');
        }

        if (subscription.status !== SubscriptionStatus.ACTIVE) {
            throw new BadRequestException('Подписка уже не активна');
        }

        const canceledSubscription = await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                status: SubscriptionStatus.CANCELED,
                notified3DaysBefore: false,
                notified1DayBefore: false,
                notifiedAfterExpiration: false,
            },
        });

        const nextActiveSubscription = await this.prisma.subscription.findFirst({
            where: {
                userId: subscription.userId,
                status: SubscriptionStatus.ACTIVE,
                endsAt: { gt: new Date() },
            },
            orderBy: [{ endsAt: 'desc' }, { id: 'desc' }],
        });

        if (!nextActiveSubscription) {
            await this.vpnService.disableUserProfile(subscription.userId);
        }

        await this.sendCancellationNotification(
            canceledSubscription.userId,
            canceledSubscription.startsAt,
            canceledSubscription.endsAt,
            nextActiveSubscription?.endsAt,
            subscription.user.externalId ?? undefined,
        );

        this.logger.log(
            `subscription cancel: action=cancel, subscriptionId=${canceledSubscription.id}, userId=${canceledSubscription.userId}, timestamp=${new Date().toISOString()}`,
        );

        return {
            success: true,
            subscriptionId: canceledSubscription.id,
            userId: canceledSubscription.userId,
            status: 'CANCELED',
        };
    }

    private async sendCancellationNotification(
        userId: number,
        startsAt: Date,
        endsAt: Date,
        nextActiveEndsAt: Date | undefined,
        externalId: string | undefined,
    ): Promise<void> {
        if (!externalId?.trim()) {
            return;
        }

        const periodMessage = [
            '⚠️ Подписка отменена',
            '',
            '📅 Период:',
            `с ${this.formatMoscowDate(startsAt)}`,
            `по ${this.formatMoscowDate(endsAt)}`,
            '',
            '❌ Этот период больше не действует',
        ];

        if (nextActiveEndsAt) {
            periodMessage.push('', 'ℹ️ Текущий доступ:', `до ${this.formatMoscowDate(nextActiveEndsAt)}`);
        } else {
            periodMessage.push('', '❌ Доступ к VPN полностью отключён');
        }

        await this.telegramNotifierService.sendToChat(externalId, periodMessage.join('\n'));

        this.logger.log(
            `subscription cancel notification sent: userId=${userId}, nextActive=${nextActiveEndsAt ? 'yes' : 'no'}`,
        );
    }

    private formatMoscowDate(date: Date): string {
        return new Intl.DateTimeFormat('ru-RU', {
            timeZone: 'Europe/Moscow',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        })
            .format(date)
            .replace(',', '');
    }
}
