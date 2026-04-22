import { Injectable } from '@nestjs/common';

interface StreamSettings {
  network?: string;
  security?: string;
  tlsSettings?: {
    serverName?: string;
    fingerprint?: string;
  };
  realitySettings?: {
    serverName?: string;
    fingerprint?: string;
    publicKey?: string;
    shortIds?: string[];
    spiderX?: string;
  };
}

@Injectable()
export class SubscriptionService {
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
    return this.encodeBase64Subscription(this.mergePlainSubscriptions(subscriptions));
  }

  buildConfig(
    input: {
      uuid: string;
      host: string;
      port: number;
      inboundRemark: string;
      country: string;
      streamSettingsRaw?: string;
    },
  ): string {
    const streamSettings = this.parseStreamSettings(input.streamSettingsRaw);

    const params = new URLSearchParams();
    const network = streamSettings.network ?? 'tcp';
    const security = streamSettings.security ?? 'none';

    params.set('encryption', 'none');
    params.set('type', network);
    params.set('security', security);

    if (streamSettings.tlsSettings?.serverName) {
      params.set('sni', streamSettings.tlsSettings.serverName);
    }

    if (streamSettings.realitySettings?.serverName) {
      params.set('sni', streamSettings.realitySettings.serverName);
    }

    if (streamSettings.realitySettings?.fingerprint) {
      params.set('fp', streamSettings.realitySettings.fingerprint);
    }

    if (streamSettings.realitySettings?.publicKey) {
      params.set('pbk', streamSettings.realitySettings.publicKey);
    }

    if (streamSettings.realitySettings?.shortIds?.length) {
      params.set('sid', streamSettings.realitySettings.shortIds[0]);
    }

    if (streamSettings.realitySettings?.spiderX) {
      params.set('spx', streamSettings.realitySettings.spiderX);
    }

    const label = `${input.country}-${input.inboundRemark}`;
    return `vless://${input.uuid}@${input.host}:${input.port}?${params.toString()}#${encodeURIComponent(label)}`;
  }

  merge(configs: string[]): string {
    return configs.filter(Boolean).join('\n');
  }

  private parseStreamSettings(raw?: string): StreamSettings {
    if (!raw) {
      return {};
    }

    try {
      return JSON.parse(raw) as StreamSettings;
    } catch {
      return {};
    }
  }
}
