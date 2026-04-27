import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XuiServer } from '@prisma/client';
import { firstValueFrom } from 'rxjs';

type HttpMethod = 'GET' | 'POST';

interface XuiEnvelope<T> {
  success: boolean;
  msg?: string;
  obj?: T;
}

class XuiRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

type XuiInboundClientStat = {
  id: number;
  inboundId: number;
  enable: boolean;
  email: string;
  uuid: string;
  subId?: string;
  up?: number;
  down?: number;
  allTime?: number;
  expiryTime?: number;
  total?: number;
  reset?: number;
  lastOnline?: number;
};

export type XuiInbound = {
  id: number;
  up: number;
  down: number;
  total: number;
  allTime: number;
  remark?: string;
  enable: boolean;
  expiryTime: number;
  trafficReset: string;
  lastTrafficResetTime: number;
  clientStats: XuiInboundClientStat[];
  listen: string;
  port: number;
  protocol: string;
  tag: string;
  sniffing?: string;
  settings?: string;
  streamSettings?: string;
};

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
  private readonly sessionCookie = new Map<number, string>();
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    const timeoutRaw = Number(process.env.XUI_REQUEST_TIMEOUT_MS ?? '5000');
    this.requestTimeoutMs =
      Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 10000;
  }

  async getInbounds(server: XuiServer): Promise<XuiInbound[]> {
    const inbounds = await this.request<XuiInbound[]>(
      server,
      'GET',
      'panel/api/inbounds/list',
    );

    return Array.isArray(inbounds) ? inbounds : [];
  }

  async getUsageBySubId(
    server: XuiServer,
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
    server: XuiServer,
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
      await this.request<unknown>(
        server,
        'POST',
        'panel/api/inbounds/addClient',
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
    server: XuiServer,
    subId: string,
    enabled: boolean,
  ): Promise<number> {
    const inbounds = await this.getInbounds(server);
    let changedCount = 0;

    for (const inbound of inbounds) {
      let inboundChanged = false;
      let inboundChangedCount = 0;
      let targetClientId: string | undefined;

      const updatedClients = inbound.clientStats
        .filter(client => client.subId === subId && client.enable !== enabled)
        .map(client => {
          inboundChanged = true;
          inboundChangedCount += 1;
          targetClientId ??= client.uuid;

          return { ...client, enable: enabled };
        });

      if (!inboundChanged || !targetClientId) {
        continue;
      }

      const formData = new FormData();
      formData.append('id', String(inbound.id));
      formData.append('settings', JSON.stringify({ clients: updatedClients }));

      try {
        await this.request<unknown>(
          server,
          'POST',
          `panel/api/inbounds/updateClient/${encodeURIComponent(targetClientId)}`,
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

  private async request<T>(
    server: XuiServer,
    method: HttpMethod,
    path: string,
    data?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    await this.ensureLogin(server);

    let envelope: XuiEnvelope<T>;

    try {
      envelope = await this.executeRequest(
        server,
        method,
        path,
        data,
        extraHeaders,
      );
    } catch (error) {
      if (this.isUnauthorized(error)) {
        this.sessionCookie.delete(server.id);
        await this.ensureLogin(server, true);
        envelope = await this.executeRequest(
          server,
          method,
          path,
          data,
          extraHeaders,
        );
      } else {
        throw error;
      }
    }

    if (!envelope.success) {
      const message = envelope.msg ?? 'unknown error';
      this.logger.warn(`3x-ui request failed ${server.id} ${path}: ${message}`);
      throw new Error(
        `3x-ui request failed for ${server.id} on ${path}: ${message}`,
      );
    }

    return envelope.obj as T;
  }

  private async executeRequest<T>(
    server: XuiServer,
    method: HttpMethod,
    path: string,
    data?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<XuiEnvelope<T>> {
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
      const statusCode =
        typeof error === 'object' &&
          error !== null &&
          'response' in error &&
          typeof (error as { response?: { status?: number } }).response
            ?.status === 'number'
          ? (error as { response?: { status?: number } }).response?.status
          : undefined;
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new XuiRequestError(
        `3x-ui request failed for ${server.id} on ${path} after ${this.requestTimeoutMs}ms: ${message}`,
        statusCode,
      );
    }

    if (!response.data) {
      throw new XuiRequestError(
        `3x-ui request failed for ${server.id} on ${path}: empty response`,
      );
    }

    return response.data;
  }

  private async ensureLogin(server: XuiServer, force = false): Promise<void> {
    if (!force && this.sessionCookie.has(server.id)) {
      return;
    }

    const body = new URLSearchParams({
      username: server.username,
      password: server.password,
      twoFactorCode: '',
    });

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post<XuiEnvelope<null>>(
          this.buildServerUrl(server, 'login/'),
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
  }

  private isUnauthorized(error: unknown): boolean {
    return (
      error instanceof XuiRequestError &&
      (error.statusCode === 401 || error.statusCode === 403)
    );
  }

  private buildServerUrl(server: XuiServer, path: string): string {
    const normalize = (s: string) => s.replace(/^\/+|\/+$/g, '');

    const basePath = server.webBasePath
      ? `/${normalize(server.webBasePath)}`
      : '';
    const cleanPath = `/${normalize(path)}`;

    return `https://${server.host}:${server.port}${basePath}${cleanPath}`;
  }
}
