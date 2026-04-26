import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SubscriptionStatus, VpnProfile } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../../db/prisma.service';
import { SubscriptionConfigService } from '../../services/subscription-config.service';
import { SubscriptionService } from '../../services/subscription.service';
import { TelegramNotifierService } from '../../services/telegram-notifier.service';
import { XuiService } from '../../services/xui.service';
import { slugify } from 'transliteration';

type XuiInboundItem = Awaited<ReturnType<XuiService['getInbounds']>>[number];

interface ClientMapping {
  serverId: string;
  country: string;
  inboundId: number;
  uuid: string;
}

interface InboundSettingsClient {
  id?: string;
  email?: string;
  subId?: string;
}

interface InboundSettingsPayload {
  clients?: InboundSettingsClient[];
}

interface CachedSubscription {
  configs: string[];
  expiresAt: number;
}

type DeviceBindResult =
  | { status: 'existing' }
  | { status: 'created'; currentCount: number }
  | { status: 'limit_exceeded'; currentCount: number };

const PLAN_PRICE_CENTS: Record<number, Record<number, number>> = {
  30: { 5: 10000, 10: 15000, 15: 20000 },
  90: { 5: 27000, 10: 40000, 15: 54000 },
  180: { 5: 51000, 10: 76000, 15: 100000 },
  365: { 5: 100000, 10: 145000, 15: 200000 },
};

function createShortUniqueLabel(value: string): string {
  const slug = slugify(value, {
    lowercase: true,
    separator: '.',
  }).slice(0, 12);

  const hash = Buffer.from(value, 'utf8').toString('hex').slice(0, 4);
  const compactSlug = slug || 'user';

  return `${compactSlug}-${hash}`;
}

const generateSubscriptionToken = customAlphabet(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  10,
);

@Injectable()
export class VpnService {
  private readonly logger = new Logger(VpnService.name);
  private readonly subscriptionConfigsCache = new Map<
    string,
    CachedSubscription
  >();
  private readonly subscriptionCacheTtlMs: number;
  private readonly refreshThrottleMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly xuiService: XuiService,
    private readonly subscriptionConfigService: SubscriptionConfigService,
    private readonly subscriptionService: SubscriptionService,
    private readonly telegramNotifierService: TelegramNotifierService,
    private readonly configService: ConfigService,
  ) {
    const cacheTtlMinutes = Number(
      this.configService.get<number>('app.subscription.cacheTtlMinutes') ?? 10,
    );
    const refreshThrottleMinutes = Number(
      this.configService.get<number>('app.subscription.refreshThrottleMinutes') ??
      10,
    );

    this.subscriptionCacheTtlMs =
      Number.isFinite(cacheTtlMinutes) && cacheTtlMinutes > 0
        ? cacheTtlMinutes * 60_000
        : 10 * 60_000;
    this.refreshThrottleMs =
      Number.isFinite(refreshThrottleMinutes) && refreshThrottleMinutes > 0
        ? refreshThrottleMinutes * 60_000
        : 10 * 60_000;
  }

  async provisionForUser(
    userId: number,
    country?: string,
  ): Promise<{
    profile: VpnProfile;
    subscriptionText: string;
    subscriptionUrl: string;
  }> {
    const startedAt = Date.now();
    this.logger.log(
      `provisionForUser started: userId=${userId}, country=${country ?? 'all'}`,
    );

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const telegramNameSource =
      (user as typeof user & { telegramName?: string | null }).telegramName ??
      user.externalId ??
      `user-${userId}`;
    const xuiEmailPrefix = createShortUniqueLabel(telegramNameSource);

    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: {
          gt: new Date(),
        },
      },
      orderBy: { endsAt: 'desc' },
    });

    if (!activeSubscription) {
      throw new BadRequestException('No active subscription');
    }

    const deviceLimit =
      this.resolveDeviceLimitFromSubscription(activeSubscription);

    const existingProfile = await this.prisma.vpnProfile.findUnique({
      where: { userId },
    });
    const existingMappings = this.parseClientMappings(
      existingProfile?.clientMappings ?? null,
    );

    const servers = this.xuiService.getServers();
    if (!servers.length) {
      throw new BadRequestException('No x-ui servers configured');
    }

    this.logger.log(
      `provisionForUser servers selected: userId=${userId}, servers=${servers.length}`,
    );

    const token =
      existingProfile?.subscriptionToken ?? generateSubscriptionToken();
    const subscriptions: string[] = [];
    const mappings: ClientMapping[] = [];

    for (const server of servers) {
      const serverStartedAt = Date.now();

      if (existingProfile?.subscriptionToken) {
        const reenabled = await this.xuiService.setClientsEnabledBySubId(
          server,
          existingProfile.subscriptionToken,
          true,
        );

        if (reenabled > 0) {
          this.logger.log(
            `server clients re-enabled: userId=${userId}, server=${server.id}, count=${reenabled}`,
          );
        }
      }

      const serverConfigs: string[] = [];
      const inbounds = await this.xuiService.getInbounds(server);
      const allowedInboundIds = server.inboundIds ?? [];
      const selectedInbounds = inbounds
        .filter(
          item =>
            allowedInboundIds.length === 0 ||
            allowedInboundIds.includes(item.id),
        )
        .filter(item => item.protocol === 'vless');

      this.logger.log(
        `server inbounds prepared: userId=${userId}, server=${server.id}, total=${inbounds.length}, selectedVless=${selectedInbounds.length}`,
      );

      if (!selectedInbounds.length) {
        continue;
      }

      for (const inbound of selectedInbounds) {
        const existingMapping = existingMappings.find(
          mapping =>
            mapping.serverId === server.id && mapping.inboundId === inbound.id,
        );
        const uuid = existingMapping?.uuid ?? randomUUID();
        const email = `${xuiEmailPrefix}-${server.id}-${inbound.id}`;

        if (!existingMapping) {
          await this.xuiService.addClient(server, inbound.id, {
            id: uuid,
            email,
            subId: token,
            enable: true,
            limitIp: deviceLimit,
          });
        }

        const host = server.publicHost ?? new URL(server.baseUrl).hostname;
        const config = this.subscriptionService.buildConfig({
          uuid,
          host,
          port: inbound.port,
          inboundRemark: inbound.remark ?? `inbound-${inbound.id}`,
          country: server.country,
          streamSettingsRaw: inbound.streamSettings,
        });

        serverConfigs.push(config);
        mappings.push({
          serverId: server.id,
          country: server.country,
          inboundId: inbound.id,
          uuid,
        });
      }

      if (server.subscriptionUrl) {
        const encodedSubscription = await this.xuiService.getSubscription(
          server,
          token,
        );
        const decodedSubscription =
          this.subscriptionService.decodeBase64Subscription(
            encodedSubscription,
          );
        subscriptions.push(decodedSubscription);
        this.logger.log(
          `server subscription collected: userId=${userId}, server=${server.id}, decodedLength=${decodedSubscription.length}`,
        );
      } else {
        subscriptions.push(...serverConfigs);
      }

      this.logger.log(
        `server provisioning done: userId=${userId}, server=${server.id}, durationMs=${Date.now() - serverStartedAt}`,
      );
    }

    if (!subscriptions.length) {
      throw new BadRequestException('No inbounds available for provisioning');
    }

    const profile = await this.prisma.vpnProfile.upsert({
      where: { userId },
      create: {
        userId,
        subscriptionToken: token,
        configs: subscriptions as unknown as Prisma.InputJsonValue,
        clientMappings: mappings as unknown as Prisma.InputJsonValue,
        active: true,
      },
      update: {
        configs: subscriptions as unknown as Prisma.InputJsonValue,
        clientMappings: mappings as unknown as Prisma.InputJsonValue,
        active: true,
      },
    });

    this.setCachedSubscriptions(token, subscriptions);

    const subscriptionText =
      this.subscriptionService.mergeEncodedSubscriptions(subscriptions);
    const subscriptionUrl = this.buildSubscriptionUrl(
      profile.subscriptionToken,
    );

    this.logger.log(
      `provisionForUser finished: userId=${userId}, subscriptions=${subscriptions.length}, durationMs=${Date.now() - startedAt}`,
    );

    return {
      profile,
      subscriptionText,
      subscriptionUrl,
    };
  }

  async getSubscriptionByToken(token: string, hwid?: string): Promise<string> {
    const payload = await this.getSubscriptionPayloadByToken(token, hwid);
    return payload.subscriptionText;
  }

  async getSubscriptionPayloadByToken(
    token: string,
    hwid?: string,
  ): Promise<{
    subscriptionText: string;
    plainSubscriptionText: string;
    userInfo: string;
    profileTitleBase64: string;
    profileUpdateIntervalHours: number;
    supportUrl: string;
    profileUrl: string;
    announce: string;
  }> {
    const profile = await this.prisma.vpnProfile.findUnique({
      where: { subscriptionToken: token },
      include: { user: true },
    });

    if (!profile || !profile.active) {
      throw new NotFoundException('Subscription token not found');
    }

    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId: profile.userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: {
          gt: new Date(),
        },
      },
      orderBy: { endsAt: 'desc' },
    });

    if (!activeSubscription) {
      throw new BadRequestException('Subscription expired');
    }

    const deviceLimit =
      this.resolveDeviceLimitFromSubscription(activeSubscription);
    const normalizedHwid = this.normalizeHwid(hwid);

    if (!normalizedHwid) {
      return await this.buildDeviceLimitExceededPayload(
        activeSubscription.endsAt,
        'Включить передачу HWID',
      );
    }

    const bindResult = await this.bindDeviceOrCheckLimit(
      profile.id,
      normalizedHwid,
      deviceLimit,
    );

    if (bindResult.status === 'created') {
      await this.notifyNewDeviceBound({
        userId: profile.userId,
        externalId: profile.user.externalId,
        hwid: normalizedHwid,
        currentCount: bindResult.currentCount,
        deviceLimit,
      });
    }

    if (bindResult.status === 'limit_exceeded') {
      await this.notifyDeviceLimitExceeded({
        userId: profile.userId,
        externalId: profile.user.externalId,
        hwid: normalizedHwid,
        currentCount: bindResult.currentCount,
        deviceLimit,
      });
      return await this.buildDeviceLimitExceededPayload(
        activeSubscription.endsAt,
      );
    }

    const storedSubscriptions = Array.isArray(profile.configs)
      ? (profile.configs as string[])
      : [];
    const cachedSubscriptions = this.getCachedSubscriptions(token);
    const effectiveSubscriptions =
      cachedSubscriptions ?? storedSubscriptions;

    if (!cachedSubscriptions && storedSubscriptions.length) {
      this.setCachedSubscriptions(token, storedSubscriptions);
    }

    const mergedPlainText = this.subscriptionService.mergePlainSubscriptions(
      effectiveSubscriptions,
    );

    if (!mergedPlainText.trim()) {
      throw new BadRequestException('Subscription has no active nodes');
    }

    const totalBytes = Math.max(
      0,
      Number(
        this.configService.get<number>('app.subscription.totalBytes') ?? 0,
      ),
    );
    const expireTs = Math.floor(activeSubscription.endsAt.getTime() / 1000);
    const usage = await this.fetchUsageTotals(token);
    const userInfo = `upload=${usage.upload}; download=${usage.download}; total=${totalBytes}; expire=${expireTs}`;

    const subscriptionConfig = await this.subscriptionConfigService.get();
    const title = subscriptionConfig.title;
    const profileTitleBase64 = Buffer.from(title, 'utf8').toString('base64');
    const profileUpdateIntervalHours = Math.max(
      1,
      Number(subscriptionConfig.updateIntervalHours),
    );

    const supportUrl = subscriptionConfig.supportUrl ?? '';
    const profileUrl = subscriptionConfig.profileUrl ?? '';
    const announce = subscriptionConfig.announce;

    const metaLines = [
      `#profile-title: ${title}`,
      `#profile-update-interval: ${profileUpdateIntervalHours}`,
      `#subscription-userinfo: ${userInfo}`,
      ...(supportUrl ? [`#support-url: ${supportUrl}`] : []),
      ...(profileUrl ? [`#profile-web-page-url: ${profileUrl}`] : []),
      ...(announce ? [`#announce: ${announce}`] : []),
    ];

    const plainSubscriptionText = `${metaLines.join('\n')}\n${mergedPlainText}`;
    const subscriptionText = this.subscriptionService.encodeBase64Subscription(
      plainSubscriptionText,
    );

    return {
      subscriptionText,
      plainSubscriptionText,
      userInfo,
      profileTitleBase64,
      profileUpdateIntervalHours,
      supportUrl,
      profileUrl,
      announce,
    };
  }

  async refreshProfileConfigs(profileId: number): Promise<
    | 'updated'
    | 'skipped-throttled'
    | 'skipped-no-token'
    | 'skipped-no-active-subscription'
  > {
    const profile = await this.prisma.vpnProfile.findUnique({
      where: { id: profileId },
      include: { user: true },
    });

    if (!profile?.active || !profile.subscriptionToken) {
      return 'skipped-no-token';
    }

    if (
      profile.lastRefreshedAt &&
      Date.now() - profile.lastRefreshedAt.getTime() < this.refreshThrottleMs
    ) {
      return 'skipped-throttled';
    }

    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId: profile.userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: {
          gt: new Date(),
        },
      },
      orderBy: { endsAt: 'desc' },
    });

    if (!activeSubscription) {
      return 'skipped-no-active-subscription';
    }

    const deviceLimit =
      this.resolveDeviceLimitFromSubscription(activeSubscription);
    const token = profile.subscriptionToken;
    const currentMappings = this.parseClientMappings(profile.clientMappings);
    const syncResult = await this.syncProfileInbounds({
      token,
      userId: profile.userId,
      user: profile.user,
      currentMappings,
      deviceLimit,
    });

    const refreshFromXui =
      this.configService.get<boolean>('app.subscription.refreshFromXui') ??
      true;

    const nextConfigs: string[] = [];

    if (refreshFromXui) {
      const liveSubscriptions = await this.fetchLiveSubscriptions(token);
      if (liveSubscriptions.length) {
        nextConfigs.push(...liveSubscriptions);
      }
    }

    if (!refreshFromXui || !nextConfigs.length) {
      const rebuiltSubscriptions = await this.buildSubscriptionsFromMappings(
        syncResult.mappings,
      );
      if (rebuiltSubscriptions.length) {
        nextConfigs.push(...rebuiltSubscriptions);
      }
    }

    const fallbackConfigs = Array.isArray(profile.configs)
      ? (profile.configs as string[])
      : [];
    const configsToStore = nextConfigs.length ? nextConfigs : fallbackConfigs;

    const updateData: Prisma.VpnProfileUpdateInput = {
      clientMappings: syncResult.mappings as unknown as Prisma.InputJsonValue,
      lastRefreshedAt: new Date(),
    };

    if (configsToStore.length) {
      updateData.configs = configsToStore as unknown as Prisma.InputJsonValue;
    }

    await this.prisma.vpnProfile.update({
      where: { id: profile.id },
      data: updateData,
    });

    if (configsToStore.length) {
      this.setCachedSubscriptions(token, configsToStore);
    }

    return 'updated';
  }

  private async fetchLiveSubscriptions(token: string): Promise<string[]> {
    const servers = this.xuiService
      .getServers()
      .filter(server => Boolean(server.subscriptionUrl));

    if (!servers.length) {
      return [];
    }

    const liveSubscriptions = await Promise.all(
      servers.map(async server => {
        try {
          const encodedSubscription = await this.xuiService.getSubscription(
            server,
            token,
          );
          const decodedSubscription =
            this.subscriptionService.decodeBase64Subscription(
              encodedSubscription,
            );

          return decodedSubscription.trim() ? decodedSubscription : null;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'unknown error';
          this.logger.warn(
            `live subscription refresh failed: server=${server.id}, token=${token}, error=${message}`,
          );
          return null;
        }
      }),
    );

    return liveSubscriptions.filter((item): item is string => Boolean(item));
  }

  private getCachedSubscriptions(token: string): string[] | null {
    const cached = this.subscriptionConfigsCache.get(token);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt <= Date.now()) {
      this.subscriptionConfigsCache.delete(token);
      return null;
    }

    return [...cached.configs];
  }

  private setCachedSubscriptions(token: string, configs: string[]): void {
    this.subscriptionConfigsCache.set(token, {
      configs: [...configs],
      expiresAt: Date.now() + this.subscriptionCacheTtlMs,
    });
  }

  private parseClientMappings(raw: Prisma.JsonValue | null): ClientMapping[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    const mappings: ClientMapping[] = [];

    for (const item of raw) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        continue;
      }

      const record = item as Record<string, unknown>;
      if (
        typeof record.serverId !== 'string' ||
        typeof record.country !== 'string' ||
        typeof record.inboundId !== 'number' ||
        typeof record.uuid !== 'string'
      ) {
        continue;
      }

      mappings.push({
        serverId: record.serverId,
        country: record.country,
        inboundId: record.inboundId,
        uuid: record.uuid,
      });
    }

    return mappings;
  }

  private resolveXuiEmailPrefix(
    user: { telegramName: string | null; externalId: string | null },
    userId: number,
  ): string {
    const telegramNameSource =
      user.telegramName ?? user.externalId ?? `user-${userId}`;

    return createShortUniqueLabel(telegramNameSource);
  }

  private parseInboundClients(raw?: string): InboundSettingsClient[] {
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as InboundSettingsPayload;
      return Array.isArray(parsed.clients) ? parsed.clients : [];
    } catch {
      return [];
    }
  }

  private async syncProfileInbounds(input: {
    token: string;
    userId: number;
    user: { telegramName: string | null; externalId: string | null };
    currentMappings: ClientMapping[];
    deviceLimit: number;
  }): Promise<{ mappings: ClientMapping[]; changed: boolean }> {
    const servers = this.xuiService.getServers();
    if (!servers.length) {
      return { mappings: input.currentMappings, changed: false };
    }

    const mappingMap = new Map<string, ClientMapping>();
    for (const mapping of input.currentMappings) {
      mappingMap.set(`${mapping.serverId}:${mapping.inboundId}`, mapping);
    }

    const emailPrefix = this.resolveXuiEmailPrefix(input.user, input.userId);
    let changed = false;

    for (const server of servers) {
      let inbounds: XuiInboundItem[];
      try {
        inbounds = await this.xuiService.getInbounds(server);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(
          `sync inbounds skipped: userId=${input.userId}, server=${server.id}, error=${message}`,
        );
        continue;
      }

      const allowedInboundIds = server.inboundIds ?? [];
      const selectedInbounds = inbounds
        .filter(
          item =>
            allowedInboundIds.length === 0 ||
            allowedInboundIds.includes(item.id),
        )
        .filter(item => item.protocol === 'vless');

      for (const inbound of selectedInbounds) {
        const mappingKey = `${server.id}:${inbound.id}`;
        if (mappingMap.has(mappingKey)) {
          continue;
        }

        const email = `${emailPrefix}-${server.id}-${inbound.id}`;
        const existingClient = this.parseInboundClients(inbound.settings).find(
          client => client.subId === input.token || client.email === email,
        );

        const uuid =
          typeof existingClient?.id === 'string' && existingClient.id
            ? existingClient.id
            : randomUUID();

        if (!existingClient) {
          await this.xuiService.addClient(server, inbound.id, {
            id: uuid,
            email,
            subId: input.token,
            enable: true,
            limitIp: input.deviceLimit,
          });
        }

        mappingMap.set(mappingKey, {
          serverId: server.id,
          country: server.country,
          inboundId: inbound.id,
          uuid,
        });
        changed = true;
      }
    }

    return {
      mappings: Array.from(mappingMap.values()),
      changed,
    };
  }

  private async buildSubscriptionsFromMappings(
    mappings: ClientMapping[],
  ): Promise<string[]> {
    if (!mappings.length) {
      return [];
    }

    const servers = this.xuiService.getServers();
    const serverById = new Map(servers.map(server => [server.id, server]));
    const grouped = new Map<string, ClientMapping[]>();

    for (const mapping of mappings) {
      const list = grouped.get(mapping.serverId) ?? [];
      list.push(mapping);
      grouped.set(mapping.serverId, list);
    }

    const subscriptions: string[] = [];

    for (const [serverId, serverMappings] of grouped.entries()) {
      const server = serverById.get(serverId);
      if (!server) {
        continue;
      }

      let inbounds: XuiInboundItem[];
      try {
        inbounds = await this.xuiService.getInbounds(server);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(
          `build subscription skipped: server=${server.id}, error=${message}`,
        );
        continue;
      }

      const inboundById = new Map<number, XuiInboundItem>(
        inbounds.map(inbound => [inbound.id, inbound]),
      );

      for (const mapping of serverMappings) {
        const inbound = inboundById.get(mapping.inboundId);
        if (!inbound) {
          continue;
        }

        const host = server.publicHost ?? new URL(server.baseUrl).hostname;
        const config = this.subscriptionService.buildConfig({
          uuid: mapping.uuid,
          host,
          port: inbound.port,
          inboundRemark: inbound.remark ?? `inbound-${inbound.id}`,
          country: server.country,
          streamSettingsRaw: inbound.streamSettings,
        });
        subscriptions.push(config);
      }
    }

    return subscriptions;
  }

  private async fetchUsageTotals(
    token: string,
  ): Promise<{ upload: number; download: number }> {
    const servers = this.xuiService.getServers();
    if (!servers.length) {
      return { upload: 0, download: 0 };
    }

    const usagePerServer = await Promise.all(
      servers.map(async server => {
        try {
          return await this.xuiService.getUsageBySubId(server, token);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'unknown error';
          this.logger.warn(
            `usage fetch failed: server=${server.id}, token=${token}, error=${message}`,
          );
          return { upload: 0, download: 0 };
        }
      }),
    );

    return usagePerServer.reduce(
      (acc, item) => ({
        upload: acc.upload + item.upload,
        download: acc.download + item.download,
      }),
      { upload: 0, download: 0 },
    );
  }

  async getUserProfile(userId: number): Promise<{
    hasActiveSubscription: boolean;
    subscriptionUrl?: string;
    endsAt?: string;
    profileName?: string;
    devicesConnected?: number;
    devicesMax?: number;
    trafficUsedBytes?: number;
    trafficTotalBytes?: number | null;
  }> {
    const profile = await this.prisma.vpnProfile.findUnique({
      where: { userId },
      include: { user: true },
    });

    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: {
          gt: new Date(),
        },
      },
      orderBy: { endsAt: 'desc' },
    });

    if (!profile || !activeSubscription) {
      return { hasActiveSubscription: false };
    }

    const devicesMax =
      this.resolveDeviceLimitFromSubscription(activeSubscription);
    const devicesConnected = await this.prisma.vpnHwidBinding.count({
      where: { profileId: profile.id },
    });

    const usage = await this.fetchUsageTotals(profile.subscriptionToken);
    const trafficUsedBytes = usage.upload + usage.download;
    const configuredTotalBytes = Math.max(
      0,
      Number(
        this.configService.get<number>('app.subscription.totalBytes') ?? 0,
      ),
    );

    const normalizedProfileName =
      profile.user.telegramName?.trim() || undefined;

    return {
      hasActiveSubscription: true,
      subscriptionUrl: this.buildSubscriptionUrl(profile.subscriptionToken),
      endsAt: activeSubscription.endsAt.toISOString(),
      profileName: normalizedProfileName,
      devicesConnected,
      devicesMax,
      trafficUsedBytes,
      trafficTotalBytes: configuredTotalBytes > 0 ? configuredTotalBytes : null,
    };
  }

  async disableUserProfile(userId: number): Promise<void> {
    const profile = await this.prisma.vpnProfile.findUnique({
      where: { userId },
    });

    if (!profile?.subscriptionToken) {
      return;
    }

    const servers = this.xuiService.getServers();
    let disabledTotal = 0;

    for (const server of servers) {
      disabledTotal += await this.xuiService.setClientsEnabledBySubId(
        server,
        profile.subscriptionToken,
        false,
      );
    }

    await this.prisma.vpnProfile.update({
      where: { id: profile.id },
      data: { active: false },
    });

    this.subscriptionConfigsCache.delete(profile.subscriptionToken);

    this.logger.log(
      `disableUserProfile completed: userId=${userId}, disabledClients=${disabledTotal}`,
    );
  }

  private resolveDeviceLimitFromSubscription(subscription: {
    startsAt: Date;
    endsAt: Date;
    amountCents: number | null;
  }): number {
    const amountCents = subscription.amountCents;
    if (typeof amountCents !== 'number' || amountCents <= 0) {
      return 5;
    }

    const days = this.resolvePlanDays(
      subscription.startsAt,
      subscription.endsAt,
    );
    const dayPrices = PLAN_PRICE_CENTS[days];
    if (!dayPrices) {
      return 5;
    }

    const matched = Object.entries(dayPrices).find(
      ([, price]) => price === amountCents,
    );
    if (!matched) {
      return 5;
    }

    return Number(matched[0]) || 5;
  }

  private resolvePlanDays(startsAt: Date, endsAt: Date): number {
    const diffMs = Math.max(0, endsAt.getTime() - startsAt.getTime());
    return Math.round(diffMs / 86_400_000);
  }

  private normalizeHwid(hwid?: string): string | undefined {
    if (!hwid) {
      return undefined;
    }

    const normalized = hwid.trim().slice(0, 128);
    if (!normalized) {
      return undefined;
    }

    return normalized;
  }

  private async bindDeviceOrCheckLimit(
    profileId: number,
    hwid: string | undefined,
    deviceLimit: number,
  ): Promise<DeviceBindResult> {
    if (!hwid) {
      return { status: 'existing' };
    }

    const existing = await this.prisma.vpnHwidBinding.findFirst({
      where: {
        profileId,
        hwid,
      },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.vpnHwidBinding.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
      return { status: 'existing' };
    }

    const currentCount = await this.prisma.vpnHwidBinding.count({
      where: { profileId },
    });

    if (currentCount >= deviceLimit) {
      return { status: 'limit_exceeded', currentCount };
    }

    await this.prisma.vpnHwidBinding.create({
      data: {
        profileId,
        hwid,
      },
    });

    return { status: 'created', currentCount: currentCount + 1 };
  }

  private async notifyNewDeviceBound(input: {
    userId: number;
    externalId: string | null;
    hwid: string;
    currentCount: number;
    deviceLimit: number;
  }): Promise<void> {
    const chatId = this.resolveTelegramChatId(input.externalId);
    if (!chatId) {
      return;
    }

    const message = [
      '📲 <b>Новое устройство подключено</b>',
      `• <b>HWID:</b> <code>${this.escapeHtml(input.hwid)}</code>`,
      `• <b>Устройства:</b> ${input.currentCount}/${input.deviceLimit}`,
      `• <b>User ID:</b> ${input.userId}`,
    ].join('\n');

    await this.telegramNotifierService.sendToChat(chatId, message, {
      parseMode: 'HTML',
    });
  }

  private async notifyDeviceLimitExceeded(input: {
    userId: number;
    externalId: string | null;
    hwid: string;
    currentCount: number;
    deviceLimit: number;
  }): Promise<void> {
    const chatId = this.resolveTelegramChatId(input.externalId);
    if (!chatId) {
      return;
    }

    const message = [
      '🚫 <b>Попытка подключения сверх лимита</b>',
      `• <b>HWID:</b> <code>${this.escapeHtml(input.hwid)}</code>`,
      `• <b>Устройства:</b> ${input.currentCount}/${input.deviceLimit}`,
      `• <b>User ID:</b> ${input.userId}`,
    ].join('\n');

    await this.telegramNotifierService.sendToChat(chatId, message, {
      parseMode: 'HTML',
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private resolveTelegramChatId(externalId: string | null): string | undefined {
    if (!externalId) {
      return undefined;
    }

    const trimmed = externalId.trim();
    if (!trimmed) {
      return undefined;
    }

    return trimmed;
  }

  private async buildDeviceLimitExceededPayload(
    expiresAt: Date,
    remark = 'Превышен лимит устройств',
  ): Promise<{
    subscriptionText: string;
    plainSubscriptionText: string;
    userInfo: string;
    profileTitleBase64: string;
    profileUpdateIntervalHours: number;
    supportUrl: string;
    profileUrl: string;
    announce: string;
  }> {
    const subscriptionConfig = await this.subscriptionConfigService.get();
    const title = subscriptionConfig.title;
    const profileTitleBase64 = Buffer.from(title, 'utf8').toString('base64');
    const profileUpdateIntervalHours = Math.max(
      1,
      Number(subscriptionConfig.updateIntervalHours),
    );

    const supportUrl = subscriptionConfig.supportUrl ?? '';
    const profileUrl = subscriptionConfig.profileUrl ?? '';
    const announce = subscriptionConfig.announce;
    const totalBytes = Math.max(
      0,
      Number(
        this.configService.get<number>('app.subscription.totalBytes') ?? 0,
      ),
    );
    const expireTs = Math.floor(expiresAt.getTime() / 1000);
    const userInfo = `upload=0; download=0; total=${totalBytes}; expire=${expireTs}`;
    const fakeConfig = `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:443?encryption=none&type=tcp&security=tls#${encodeURIComponent(remark)}`;

    const metaLines = [
      `#profile-title: ${title}`,
      `#profile-update-interval: ${profileUpdateIntervalHours}`,
      `#subscription-userinfo: ${userInfo}`,
      ...(supportUrl ? [`#support-url: ${supportUrl}`] : []),
      ...(profileUrl ? [`#profile-web-page-url: ${profileUrl}`] : []),
      ...(announce ? [`#announce: ${announce}`] : []),
    ];

    const plainSubscriptionText = `${metaLines.join('\n')}\n${fakeConfig}`;
    const subscriptionText = this.subscriptionService.encodeBase64Subscription(
      plainSubscriptionText,
    );

    return {
      subscriptionText,
      plainSubscriptionText,
      userInfo,
      profileTitleBase64,
      profileUpdateIntervalHours,
      supportUrl,
      profileUrl,
      announce,
    };
  }

  private buildSubscriptionUrl(token: string): string {
    const publicBaseUrl = this.configService.get<string>('app.publicBaseUrl');
    return `${publicBaseUrl}/sub/${token}`;
  }
}
