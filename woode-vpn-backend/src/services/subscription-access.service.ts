import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { XuiService } from './xui.service';

@Injectable()
export class SubscriptionAccessService {
  private readonly logger = new Logger(SubscriptionAccessService.name);
  private static readonly BATCH_SIZE = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly xuiService: XuiService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'Europe/Moscow' })
  async revokeExpiredSubscriptionsAccess(): Promise<void> {
    const now = new Date();
    let cursorId: number | undefined;

    while (true) {
      const subscriptions = await this.prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.ACTIVE,
          endsAt: { lte: now },
        },
        include: {
          user: {
            include: {
              vpnProfile: true,
            },
          },
        },
        orderBy: { id: 'asc' },
        take: SubscriptionAccessService.BATCH_SIZE,
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
        const profile = subscription.user.vpnProfile;

        if (!profile?.subscriptionToken) {
          await this.markExpired(subscription.id);
          this.logger.log(
            `subscription marked expired without profile: subscriptionId=${subscription.id}, userId=${subscription.userId}`,
          );
          continue;
        }

        const servers = this.xuiService.getServers();
        let disabledTotal = 0;

        for (const server of servers) {
          disabledTotal += await this.xuiService.setClientsEnabledBySubId(
            server,
            profile.subscriptionToken,
            false,
          );
        }

        await this.markExpired(subscription.id);

        this.logger.log(
          `subscription access disabled: subscriptionId=${subscription.id}, userId=${subscription.userId}, disabledClients=${disabledTotal}`,
        );
      }

      cursorId = subscriptions[subscriptions.length - 1].id;
    }
  }

  private async markExpired(subscriptionId: number): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: {
        id: subscriptionId,
        status: SubscriptionStatus.ACTIVE,
      },
      data: {
        status: SubscriptionStatus.EXPIRED,
      },
    });
  }
}
