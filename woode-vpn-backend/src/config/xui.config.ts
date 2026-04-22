import { registerAs } from '@nestjs/config';

export interface XuiServerConfig {
  id: string;
  country: string;
  baseUrl: string;
  subscriptionUrl?: string;
  username: string;
  password: string;
  publicHost?: string;
  inboundIds?: number[];
  enabled?: boolean;
}

function parseServers(raw: string | undefined): XuiServerConfig[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as XuiServerConfig[];

    return parsed.filter((server) => server.enabled !== false);
  } catch {
    return [];
  }
}

export default registerAs('xui', () => ({
  servers: parseServers(process.env.XUI_SERVERS_JSON),
}));
