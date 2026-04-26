import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { VpnService } from './vpn.service';

@Injectable()
export class SubscriptionRefreshService {
    private readonly logger = new Logger(SubscriptionRefreshService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly vpnService: VpnService,
    ) { }

    @Cron(CronExpression.EVERY_HOUR, { timeZone: 'Europe/Moscow' })
    async refreshSubscriptions(): Promise<void> {
        const startedAt = Date.now();

        const profiles = await this.prisma.vpnProfile.findMany({
            where: {
                active: true,
                user: {
                    subscriptions: {
                        some: {
                            status: SubscriptionStatus.ACTIVE,
                            endsAt: {
                                gt: new Date(),
                            },
                        },
                    },
                },
            },
            select: {
                id: true,
            },
        });

        let updated = 0;
        let skippedThrottled = 0;
        let skippedNoToken = 0;
        let skippedNoActiveSubscription = 0;
        let errors = 0;

        for (const profile of profiles) {
            try {
                const result = await this.vpnService.refreshProfileConfigs(profile.id);
                if (result === 'updated') {
                    updated += 1;
                    continue;
                }

                if (result === 'skipped-throttled') {
                    skippedThrottled += 1;
                    continue;
                }

                if (result === 'skipped-no-token') {
                    skippedNoToken += 1;
                    continue;
                }

                if (result === 'skipped-no-active-subscription') {
                    skippedNoActiveSubscription += 1;
                }
            } catch (error) {
                errors += 1;
                const message = error instanceof Error ? error.message : 'unknown error';
                this.logger.warn(
                    `subscription refresh failed: profileId=${profile.id}, error=${message}`,
                );
            }
        }

        this.logger.log(
            `subscription refresh finished: total=${profiles.length}, updated=${updated}, skippedThrottled=${skippedThrottled}, skippedNoToken=${skippedNoToken}, skippedNoActiveSubscription=${skippedNoActiveSubscription}, errors=${errors}, durationMs=${Date.now() - startedAt}`,
        );
    }
}
