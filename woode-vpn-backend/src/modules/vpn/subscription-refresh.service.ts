import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../db/prisma.service';
import { SubscriptionService } from '../../services/subscription.service';
import { VpnService } from './vpn.service';

@Injectable()
export class SubscriptionRefreshService {
    private readonly logger = new Logger(SubscriptionRefreshService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly subscriptionService: SubscriptionService,
        private readonly vpnService: VpnService,
    ) { }

    @Cron(CronExpression.EVERY_10_MINUTES, { timeZone: 'Europe/Moscow' })
    async refreshSubscriptions(): Promise<void> {
        const startedAt = Date.now();
        const now = new Date();

        const profiles = await this.prisma.vpnProfile.findMany({
            where: {
                active: true,
                user: {
                    subscriptions: {
                        some: {
                            ...this.subscriptionService.getActiveSubscriptionWhere(
                                undefined,
                                now,
                            ),
                        },
                    },
                },
            },
            include: {
                user: true,
            },
        });

        let updated = 0;
        let skippedThrottled = 0;
        let skippedNoToken = 0;
        let skippedNoActiveSubscription = 0;
        let errors = 0;

        for (const profile of profiles) {
            try {
                const configResult =
                    await this.vpnService.refreshProfileConfigs(profile);
                if (configResult === 'updated') {
                    updated += 1;
                }

                if (configResult === 'skipped-throttled') {
                    skippedThrottled += 1;
                }

                if (configResult === 'skipped-no-token') {
                    skippedNoToken += 1;
                }

                if (configResult === 'skipped-no-active-subscription') {
                    skippedNoActiveSubscription += 1;
                    continue;
                }
            } catch (error) {
                errors += 1;
                const message =
                    error instanceof Error ? error.message : 'unknown error';
                this.logger.warn(
                    `subscription refresh failed: profileId=${profile.id}, error=${message}`,
                );
            }
        }

        this.logger.log(
            `subscription refresh finished: total=${profiles.length}, configsUpdated=${updated}, skippedThrottled=${skippedThrottled}, skippedNoToken=${skippedNoToken}, skippedNoActiveSubscription=${skippedNoActiveSubscription}, errors=${errors}, durationMs=${Date.now() - startedAt}`,
        );
    }
}
