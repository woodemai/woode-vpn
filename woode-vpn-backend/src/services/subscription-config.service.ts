import { Injectable } from '@nestjs/common';
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

  constructor(private readonly prisma: PrismaService) { }

  async get(): Promise<SubscriptionConfig> {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const config = await this.prisma.subscriptionConfig.upsert({
      where: { id: 1 },
      create: {
        title: 'Woode VPN',
        supportUrl: 'https://t.me/woodemai',
        profileUrl: null,
        announce: '',
        updateIntervalHours: 6,
      },
      update: {},
    });

    this.cachedConfig = config;
    return config;
  }

  async update(
    data: UpdateSubscriptionConfigInput,
  ): Promise<SubscriptionConfig> {
    await this.get();
    const normalized = this.normalizeInput(data);

    const updated = await this.prisma.subscriptionConfig.update({
      where: { id: 1 },
      data: normalized,
    });

    this.cachedConfig = updated;
    return updated;
  }

  private normalizeInput(
    data: UpdateSubscriptionConfigInput,
  ): UpdateSubscriptionConfigInput {
    return {
      title: data.title === undefined ? undefined : data.title.trim(),
      supportUrl:
        data.supportUrl === undefined
          ? undefined
          : data.supportUrl?.trim() || null,
      profileUrl:
        data.profileUrl === undefined
          ? undefined
          : data.profileUrl?.trim() || null,
      announce: data.announce === undefined ? undefined : data.announce.trim(),
      updateIntervalHours:
        data.updateIntervalHours === undefined
          ? undefined
          : Math.max(1, Math.floor(data.updateIntervalHours)),
    };
  }
}
