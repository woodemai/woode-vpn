import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { XuiServerConfig } from '../config/xui.config';

type HttpMethod = 'GET' | 'POST';

interface XuiEnvelope<T> {
  success: boolean;
  msg?: string;
  obj?: T;
}

interface XuiInbound {
  id: number;
  port: number;
  protocol: string;
  remark?: string;
  settings?: string;
  streamSettings?: string;
  clientStats?: XuiClientStat[];
}

interface XuiClientStat {
  subId?: string;
  up?: number;
  down?: number;
}

interface XuiInboundClient {
  uuid?: string;
  email?: string;
  subId?: string;
  enable?: boolean;
  [key: string]: unknown;
  id?: string;
}

interface XuiInboundSettings {
  clients?: XuiInboundClient[];
}

interface XuiClientInput {
  id: string;
  email: string;
  subId?: string;
  expiryTime?: number;
  totalGB?: number;
  enable?: boolean;
  limitIp?: number;
}

@Injectable()
export class XuiService {
  private readonly logger = new Logger(XuiService.name);
  private readonly sessionCookie = new Map<string, string>();
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    const timeoutRaw = Number(process.env.XUI_REQUEST_TIMEOUT_MS ?? '10000');
    this.requestTimeoutMs =
      Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 10000;
  }

  getServers(country?: string): XuiServerConfig[] {
    const servers =
      this.configService
        .get<XuiServerConfig[]>('xui.servers')
        ?.filter(server => server.enabled !== false) ?? [];

    if (!country) {
      return servers;
    }

    return servers.filter(
      server => server.country.toLowerCase() === country.toLowerCase(),
    );
  }

  async getInbounds(server: XuiServerConfig): Promise<XuiInbound[]> {
    const list = await this.requestWithFallback<XuiInbound[]>(server, 'GET', [
      'panel/api/inbounds/list',
    ]);

    return list ?? [];
  }

  async getUsageBySubId(
    server: XuiServerConfig,
    subId: string,
  ): Promise<{ upload: number; download: number }> {
    const inbounds = await this.getInbounds(server);

    let upload = 0;
    let download = 0;

    for (const inbound of inbounds) {
      const clientStats = Array.isArray(inbound.clientStats)
        ? inbound.clientStats
        : [];

      for (const client of clientStats) {
        if (client.subId !== subId) {
          continue;
        }

        upload += Number(client.up ?? 0);
        download += Number(client.down ?? 0);
      }
    }

    return { upload, download };
  }

  async addClient(
    server: XuiServerConfig,
    inboundId: number,
    client: XuiClientInput,
  ): Promise<void> {
    const payload = new URLSearchParams({
      id: String(inboundId),
      settings: JSON.stringify({
        clients: [
          {
            id: client.id,
            flow: 'xtls-rprx-vision',
            email: client.email,
            limitIp: client.limitIp ?? 0,
            totalGB: client.totalGB ?? 0,
            expiryTime: client.expiryTime ?? 0,
            enable: client.enable ?? true,
            tgId: '',
            subId: client.subId ?? client.email,
            comment: '',
            reset: 0,
          },
        ],
      }),
    });

    try {
      await this.requestWithFallback<unknown>(
        server,
        'POST',
        ['panel/api/inbounds/addClient'],
        payload.toString(),
        {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/plain, */*',
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      if (message.toLowerCase().includes('duplicate email')) {
        this.logger.warn(
          `3x-ui addClient duplicate ignored: server=${server.id}, inboundId=${inboundId}, email=${client.email}`,
        );
        return;
      }

      throw error;
    }
  }

  async setClientsEnabledBySubId(
    server: XuiServerConfig,
    subId: string,
    enabled: boolean,
  ): Promise<number> {
    const inbounds = await this.getInbounds(server);
    let changedCount = 0;

    for (const inbound of inbounds) {
      const settings = this.parseInboundSettings(inbound.settings);
      if (!settings?.clients?.length) {
        continue;
      }

      let inboundChanged = false;
      let inboundChangedCount = 0;
      let targetClientId: string | undefined;

      const filteredClients = settings.clients.filter(client => client.subId === subId && client.enable !== enabled)

      const updatedClients = filteredClients.map(client => {
        inboundChanged = true;
        inboundChangedCount += 1;
        targetClientId ??= client.id;

        return { ...client, enable: enabled }
      })

      if (!inboundChanged || !targetClientId) {
        continue;
      }

      const formData = new FormData();
      formData.append('id', String(inbound.id));
      formData.append('settings', JSON.stringify({ clients: updatedClients }));

      try {
        await this.requestWithFallback<unknown>(
          server,
          'POST',
          [
            `panel/api/inbounds/updateClient/${encodeURIComponent(targetClientId)}`,
          ],
          formData,
          {
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json, text/plain, */*',
          },
        );
        changedCount += inboundChangedCount;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown error';
        this.logger.error(
          `3x-ui client toggle failed: server=${server.id}, inboundId=${inbound.id}, enabled=${enabled}, error=${message}`,
        );
      }
    }

    return changedCount;
  }

  async getSubscription(
    server: XuiServerConfig,
    subscriptionToken: string,
  ): Promise<string> {
    if (!server.subscriptionUrl) {
      throw new Error(`No subscriptionUrl configured for server ${server.id}`);
    }

    const base = server.subscriptionUrl.endsWith('/')
      ? server.subscriptionUrl
      : `${server.subscriptionUrl}/`;
    const subscriptionUrl = `${base}${encodeURIComponent(subscriptionToken)}`;

    const startedAt = Date.now();
    this.logger.log(
      `3x-ui subscription fetch started: server=${server.id}, url=${subscriptionUrl}`,
    );

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.get<string>(subscriptionUrl, {
          timeout: this.requestTimeoutMs,
          responseType: 'text',
          headers: {
            Accept: 'text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest',
          },
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new Error(
        `3x-ui subscription request failed for server ${server.id} after ${this.requestTimeoutMs}ms: ${message}`,
      );
    }

    if (typeof response.data !== 'string' || !response.data.trim()) {
      throw new Error(
        `3x-ui subscription response is empty for server ${server.id}`,
      );
    }

    this.logger.log(
      `3x-ui subscription fetched: server=${server.id}, durationMs=${Date.now() - startedAt}, responseLength=${response.data.trim().length}`,
    );

    return response.data.trim();
  }

  private async requestWithFallback<T>(
    server: XuiServerConfig,
    method: HttpMethod,
    paths: string[],
    data?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T | undefined> {
    const startedAt = Date.now();
    await this.ensureLogin(server);

    let lastError: unknown;
    for (const path of paths) {
      try {
        const result = await this.request<T>(
          server,
          method,
          path,
          data,
          extraHeaders,
        );
        this.logger.log(
          `3x-ui request success: server=${server.id}, method=${method}, path=${path}, durationMs=${Date.now() - startedAt}`,
        );
        return result;
      } catch (error) {
        lastError = error;
        const message =
          error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(
          `3x-ui request attempt failed: server=${server.id}, method=${method}, path=${path}, error=${message}`,
        );
      }
    }

    throw lastError;
  }

  private async ensureLogin(server: XuiServerConfig): Promise<void> {
    if (this.sessionCookie.has(server.id)) {
      return;
    }

    const startedAt = Date.now();

    const body = new URLSearchParams({
      username: server.username,
      password: server.password,
      twoFactorCode: '',
    });

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post<XuiEnvelope<unknown>>(
          this.buildServerUrl(server, 'login'),
          body.toString(),
          {
            timeout: this.requestTimeoutMs,
            headers: {
              'Content-Type':
                'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
              Accept: 'application/json, text/plain, */*',
            },
          },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new Error(
        `3x-ui login request failed for server ${server.id} after ${this.requestTimeoutMs}ms: ${message}`,
      );
    }

    if (!response.data?.success) {
      throw new Error(
        `3x-ui login failed for server ${server.id}: ${response.data?.msg ?? 'unknown error'}`,
      );
    }

    const rawCookies = response.headers['set-cookie'];
    if (!rawCookies?.length) {
      throw new Error(`No session cookie returned by server ${server.id}`);
    }

    const cookie = rawCookies.map(entry => entry.split(';')[0]).join('; ');
    this.sessionCookie.set(server.id, cookie);
    this.logger.log(
      `3x-ui login success: server=${server.id}, durationMs=${Date.now() - startedAt}`,
    );
  }

  private async request<T>(
    server: XuiServerConfig,
    method: HttpMethod,
    path: string,
    data?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T | undefined> {
    const cookie = this.sessionCookie.get(server.id);
    let response;
    try {
      response = await firstValueFrom(
        this.httpService.request<XuiEnvelope<T>>({
          url: this.buildServerUrl(server, path),
          method,
          data,
          timeout: this.requestTimeoutMs,
          headers: {
            ...(cookie
              ? {
                Cookie: cookie,
              }
              : {}),
            ...(extraHeaders ?? {}),
          },
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new Error(
        `3x-ui request failed for ${server.id} on ${path} after ${this.requestTimeoutMs}ms: ${message}`,
      );
    }

    if (!response.data?.success) {
      this.logger.warn(
        `3x-ui request failed ${server.id} ${path}: ${response.data?.msg ?? 'unknown error'}`,
      );
      throw new Error(
        `3x-ui request failed for ${server.id} on ${path}: ${response.data?.msg ?? 'unknown error'}`,
      );
    }

    return response.data.obj;
  }

  private buildServerUrl(server: XuiServerConfig, path: string): string {
    const base = server.baseUrl.endsWith('/')
      ? server.baseUrl
      : `${server.baseUrl}/`;
    const normalizedPath = path.replace(/^\/+/, '');
    return new URL(normalizedPath, base).toString();
  }

  private parseInboundSettings(raw?: string): XuiInboundSettings | undefined {
    if (!raw) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(raw) as XuiInboundSettings;
      if (!Array.isArray(parsed.clients)) {
        parsed.clients = [];
      }
      return parsed;
    } catch {
      return undefined;
    }
  }
}
