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
