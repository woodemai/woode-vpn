import { Injectable } from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@prisma/client';

interface StreamSettings {
  network?: string;
  security?: string;
  externalProxy?: unknown[];
  xhttpSettings?: {
    path?: string;
    host?: string;
    headers?: Record<string, string>;
    scMaxBufferedPosts?: number;
    scMaxEachPostBytes?: string;
    scStreamUpServerSecs?: string;
    noSSEHeader?: boolean;
    xPaddingBytes?: string;
    mode?: string;
    xPaddingObfsMode?: boolean;
    xPaddingKey?: string;
    xPaddingHeader?: string;
    xPaddingPlacement?: string;
    xPaddingMethod?: string;
    uplinkHTTPMethod?: string;
    sessionPlacement?: string;
    sessionKey?: string;
    seqPlacement?: string;
    seqKey?: string;
    uplinkDataPlacement?: string;
    uplinkDataKey?: string;
    uplinkChunkSize?: number;
  };
  realitySettings?: {
    show: false;
    xver: 0;
    target: string;
    serverNames: string[];
    privateKey: string;
    minClientVer: string;
    maxClientVer: string;
    maxTimediff: number;
    shortIds?: string[];
    mldsa65Seed?: string;
    settings?: {
      publicKey?: string;
      fingerprint?: string;
      serverName?: string;
      spiderX?: string;
      mldsa65Verify?: string;
    };
  };
  tcpSettings?: { acceptProxyProtocol: boolean; header: { type: string } };
}

type InboundSettingsClient = {
  comment: string;
  created_at: number;
  email: string;
  enable: boolean;
  expiryTime: number;
  flow: string;
  id: string;
  limitIp: number;
  reset: number;
  subId: string;
  tgId: number;
  totalGB: number;
  updated_at: number;
};

type InboundSettings = {
  clients?: InboundSettingsClient[];
  decryption?: string;
  encryption?: string;
  testseed?: number[];
};

@Injectable()
export class SubscriptionService {
  getActiveSubscriptionWhere(
    userId?: number,
    now: Date = new Date(),
  ): Prisma.SubscriptionWhereInput {
    return {
      ...(typeof userId === 'number' ? { userId } : {}),
      status: SubscriptionStatus.ACTIVE,
      startsAt: { lte: now },
      endsAt: { gt: now },
    };
  }

  getNextActiveSubscriptionWhere(
    userId?: number,
    now: Date = new Date(),
  ): Prisma.SubscriptionWhereInput {
    return {
      ...(typeof userId === 'number' ? { userId } : {}),
      status: SubscriptionStatus.ACTIVE,
      startsAt: { gte: now },
      endsAt: { gt: now },
    };
  }

  getActiveSubscriptionOrderBy():
    | Prisma.SubscriptionOrderByWithRelationInput
    | Prisma.SubscriptionOrderByWithRelationInput[] {
    return [{ endsAt: 'desc' }, { id: 'desc' }];
  }

  encodeBase64Subscription(raw: string): string {
    return Buffer.from(raw, 'utf8').toString('base64');
  }

  decodeBase64Subscription(raw: string): string {
    const normalized = raw.replace(/\s+/g, '');
    return Buffer.from(normalized, 'base64').toString('utf8');
  }

  mergePlainSubscriptions(subscriptions: string[]): string {
    const uniqueLines = new Set<string>();

    for (const subscription of subscriptions) {
      for (const line of subscription.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          uniqueLines.add(trimmed);
        }
      }
    }

    return Array.from(uniqueLines).join('\n');
  }

  mergeEncodedSubscriptions(subscriptions: string[]): string {
    return this.encodeBase64Subscription(
      this.mergePlainSubscriptions(subscriptions),
    );
  }

  merge(configs: string[]): string {
    return configs.filter(Boolean).join('\n');
  }

  parseStreamSettings(raw?: string): StreamSettings {
    if (!raw) {
      return {};
    }

    try {
      return JSON.parse(raw) as StreamSettings;
    } catch {
      return {};
    }
  }

  parseSettings(raw?: string): InboundSettings {
    if (!raw) {
      return {};
    }

    try {
      return JSON.parse(raw) as InboundSettings;
    } catch {
      return {};
    }
  }
}
