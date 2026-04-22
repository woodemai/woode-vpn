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
}

interface XuiClientInput {
  id: string;
  email: string;
  expiryTime?: number;
  totalGB?: number;
  enable?: boolean;
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
    this.requestTimeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 10000;
  }

  getServers(country?: string): XuiServerConfig[] {
    const servers =
      this.configService.get<XuiServerConfig[]>('xui.servers')?.filter(
        (server) => server.enabled !== false,
      ) ?? [];

    if (!country) {
      return servers;
    }

    return servers.filter(
      (server) => server.country.toLowerCase() === country.toLowerCase(),
    );
  }

  async getInbounds(server: XuiServerConfig): Promise<XuiInbound[]> {
    const list = await this.requestWithFallback<XuiInbound[]>(server, 'GET', [
      '/inbounds/list',
      '/panel/api/inbounds/list',
    ]);

    return list ?? [];
  }

  async addClient(
    server: XuiServerConfig,
    inboundId: number,
    client: XuiClientInput,
  ): Promise<void> {
    const payload = {
      id: inboundId,
      settings: JSON.stringify({
        clients: [
          {
            id: client.id,
            email: client.email,
            expiryTime: client.expiryTime ?? 0,
            totalGB: client.totalGB ?? 0,
            enable: client.enable ?? true,
            limitIp: 0,
            tgId: '',
            subId: '',
            reset: 0,
          },
        ],
      }),
    };

    await this.requestWithFallback<unknown>(server, 'POST', [
      '/inbounds/addClient',
      '/panel/api/inbounds/addClient',
    ], payload);
  }

  private async requestWithFallback<T>(
    server: XuiServerConfig,
    method: HttpMethod,
    paths: string[],
    data?: unknown,
  ): Promise<T | undefined> {
    const startedAt = Date.now();
    await this.ensureLogin(server);

    let lastError: unknown;
    for (const path of paths) {
      try {
        const result = await this.request<T>(server, method, path, data);
        this.logger.log(
          `3x-ui request success: server=${server.id}, method=${method}, path=${path}, durationMs=${Date.now() - startedAt}`,
        );
        return result;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : 'unknown error';
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
    });

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post<XuiEnvelope<unknown>>(
          `${server.baseUrl}/login`,
          body.toString(),
          {
            timeout: this.requestTimeoutMs,
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
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

    const cookie = rawCookies.map((entry) => entry.split(';')[0]).join('; ');
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
  ): Promise<T | undefined> {
    const cookie = this.sessionCookie.get(server.id);
    let response;
    try {
      response = await firstValueFrom(
        this.httpService.request<XuiEnvelope<T>>({
          baseURL: server.baseUrl,
          url: path,
          method,
          data,
          timeout: this.requestTimeoutMs,
          headers: cookie
            ? {
                Cookie: cookie,
              }
            : undefined,
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
}
