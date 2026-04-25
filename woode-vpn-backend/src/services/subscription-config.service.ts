import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionConfig } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';

export interface UpdateSubscriptionConfigInput {
    title?: string;
    supportUrl?: string | null;
    profileUrl?: string | null;
    announce?: string;
    updateIntervalHours?: number;
}

@Injectable()
export class SubscriptionConfigService {
    private cachedConfig?: SubscriptionConfig;

    constructor(
        private readonly prisma: PrismaService,
        private readonly configService: ConfigService,
    ) { }

    async get(): Promise<SubscriptionConfig> {
        if (this.cachedConfig) {
            return this.cachedConfig;
        }

        const config = await this.prisma.subscriptionConfig.upsert({
            where: { id: 1 },
            create: this.getDefaultConfig(),
            update: {},
        });

        this.cachedConfig = config;
        return config;
    }

    async update(data: UpdateSubscriptionConfigInput): Promise<SubscriptionConfig> {
        const current = await this.get();
        const normalized = this.normalizeInput(data);

        const updated = await this.prisma.subscriptionConfig.upsert({
            where: { id: 1 },
            create: {
                ...this.getDefaultConfig(),
                ...normalized,
            },
            update: {
                title: normalized.title ?? current.title,
                supportUrl:
                    normalized.supportUrl === undefined
                        ? current.supportUrl
                        : normalized.supportUrl,
                profileUrl:
                    normalized.profileUrl === undefined
                        ? current.profileUrl
                        : normalized.profileUrl,
                announce: normalized.announce ?? current.announce,
                updateIntervalHours:
                    normalized.updateIntervalHours ?? current.updateIntervalHours,
            },
        });

        this.cachedConfig = updated;
        return updated;
    }

    private getDefaultConfig(): Omit<SubscriptionConfig, 'updatedAt'> {
        return {
            id: 1,
            title: process.env.SUBSCRIPTION_TITLE ?? 'Woode VPN',
            supportUrl: process.env.SUBSCRIPTION_SUPPORT_URL ?? null,
            profileUrl: process.env.SUBSCRIPTION_PROFILE_URL ?? null,
            announce: process.env.SUBSCRIPTION_ANNOUNCE ?? '',
            updateIntervalHours: Math.max(
                1,
                Number(process.env.SUBSCRIPTION_UPDATE_INTERVAL_HOURS ?? 12),
            ),
        };
    }

    private normalizeInput(data: UpdateSubscriptionConfigInput): UpdateSubscriptionConfigInput {
        return {
            title: data.title?.trim(),
            supportUrl:
                data.supportUrl === undefined ? undefined : data.supportUrl?.trim() || null,
            profileUrl:
                data.profileUrl === undefined ? undefined : data.profileUrl?.trim() || null,
            announce: data.announce?.trim(),
            updateIntervalHours:
                data.updateIntervalHours === undefined
                    ? undefined
                    : Math.max(1, Math.floor(data.updateIntervalHours)),
        };
    }
}
