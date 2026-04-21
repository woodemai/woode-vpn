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

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

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
    await this.ensureLogin(server);

    let lastError: unknown;
    for (const path of paths) {
      try {
        return await this.request<T>(server, method, path, data);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  private async ensureLogin(server: XuiServerConfig): Promise<void> {
    if (this.sessionCookie.has(server.id)) {
      return;
    }

    const body = new URLSearchParams({
      username: server.username,
      password: server.password,
    });

    const response = await firstValueFrom(
      this.httpService.post<XuiEnvelope<unknown>>(
        `${server.baseUrl}/login`,
        body.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      ),
    );

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
  }

  private async request<T>(
    server: XuiServerConfig,
    method: HttpMethod,
    path: string,
    data?: unknown,
  ): Promise<T | undefined> {
    const cookie = this.sessionCookie.get(server.id);
    const response = await firstValueFrom(
      this.httpService.request<XuiEnvelope<T>>({
        baseURL: server.baseUrl,
        url: path,
        method,
        data,
        headers: cookie
          ? {
              Cookie: cookie,
            }
          : undefined,
      }),
    );

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
