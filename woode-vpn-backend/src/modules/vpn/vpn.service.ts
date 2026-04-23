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
import { SubscriptionService } from '../../services/subscription.service';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly xuiService: XuiService,
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
  ) { }

  async provisionForUser(userId: number, country?: string): Promise<{
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

    const deviceLimit = this.resolveDeviceLimitFromSubscription(activeSubscription);

    const servers = this.xuiService.getServers();
    if (!servers.length) {
      throw new BadRequestException('No x-ui servers configured');
    }

    this.logger.log(`provisionForUser servers selected: userId=${userId}, servers=${servers.length}`);

    const token = generateSubscriptionToken();
    const subscriptions: string[] = [];
    const mappings: ClientMapping[] = [];

    for (const server of servers) {
      const serverStartedAt = Date.now();
      const serverConfigs: string[] = [];
      const inbounds = await this.xuiService.getInbounds(server);
      const allowedInboundIds = server.inboundIds ?? [];
      const selectedInbounds = inbounds
        .filter((item) => allowedInboundIds.length === 0 || allowedInboundIds.includes(item.id))
        .filter((item) => item.protocol === 'vless');

      this.logger.log(
        `server inbounds prepared: userId=${userId}, server=${server.id}, total=${inbounds.length}, selectedVless=${selectedInbounds.length}`,
      );

      if (!selectedInbounds.length) {
        continue;
      }

      for (const inbound of selectedInbounds) {
        const uuid = randomUUID();
        const email = `${xuiEmailPrefix}-${server.id}-${inbound.id}`;

        await this.xuiService.addClient(server, inbound.id, {
          id: uuid,
          email,
          subId: token,
          enable: true,
          limitIp: deviceLimit,
        });

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
        const encodedSubscription = await this.xuiService.getSubscription(server, token);
        const decodedSubscription = this.subscriptionService.decodeBase64Subscription(
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

    const subscriptionText = this.subscriptionService.mergeEncodedSubscriptions(subscriptions);
    const subscriptionUrl = this.buildSubscriptionUrl(profile.subscriptionToken);

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

  async getSubscriptionPayloadByToken(token: string, hwid?: string): Promise<{
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

    const deviceLimit = this.resolveDeviceLimitFromSubscription(activeSubscription);
    const normalizedHwid = this.normalizeHwid(hwid);

    if (!normalizedHwid) {
      return this.buildDeviceLimitExceededPayload(
        activeSubscription.endsAt,
        'Включить передачу HWID',
      );
    }

    const isLimitExceeded = await this.bindDeviceOrCheckLimit(
      profile.id,
      normalizedHwid,
      deviceLimit,
    );

    if (isLimitExceeded) {
      return this.buildDeviceLimitExceededPayload(activeSubscription.endsAt);
    }

    const currentMappings = this.parseClientMappings(profile.clientMappings);
    const syncResult = await this.syncProfileInbounds({
      token,
      userId: profile.userId,
      user: profile.user,
      currentMappings,
      deviceLimit,
    });

    const subscriptions = Array.isArray(profile.configs)
      ? (profile.configs as string[])
      : [];

    const refreshFromXui =
      this.configService.get<boolean>('app.subscription.refreshFromXui') ?? true;

    let effectiveSubscriptions = subscriptions;
    const profileUpdateData: Prisma.VpnProfileUpdateInput = {};

    if (syncResult.changed) {
      profileUpdateData.clientMappings =
        syncResult.mappings as unknown as Prisma.InputJsonValue;
    }

    if (refreshFromXui) {
      const liveSubscriptions = await this.fetchLiveSubscriptions(token);

      if (liveSubscriptions.length) {
        effectiveSubscriptions = liveSubscriptions;
        profileUpdateData.configs =
          liveSubscriptions as unknown as Prisma.InputJsonValue;
      }
    }

    if ((syncResult.changed || !effectiveSubscriptions.length) && !refreshFromXui) {
      const rebuiltSubscriptions = await this.buildSubscriptionsFromMappings(
        syncResult.mappings,
      );

      if (rebuiltSubscriptions.length) {
        effectiveSubscriptions = rebuiltSubscriptions;
        profileUpdateData.configs =
          rebuiltSubscriptions as unknown as Prisma.InputJsonValue;
      }
    }

    if (
      refreshFromXui &&
      syncResult.changed &&
      !profileUpdateData.configs
    ) {
      const rebuiltSubscriptions = await this.buildSubscriptionsFromMappings(
        syncResult.mappings,
      );

      if (rebuiltSubscriptions.length) {
        effectiveSubscriptions = rebuiltSubscriptions;
        profileUpdateData.configs =
          rebuiltSubscriptions as unknown as Prisma.InputJsonValue;
      }
    }

    if (Object.keys(profileUpdateData).length) {
      await this.prisma.vpnProfile.update({
        where: { id: profile.id },
        data: profileUpdateData,
      });
    }

    const mergedPlainText = this.subscriptionService.mergePlainSubscriptions(
      effectiveSubscriptions,
    );

    if (!mergedPlainText.trim()) {
      throw new BadRequestException('Subscription has no active nodes');
    }

    const totalBytes = Math.max(
      0,
      Number(this.configService.get<number>('app.subscription.totalBytes') ?? 0),
    );
    const expireTs = Math.floor(activeSubscription.endsAt.getTime() / 1000);
    const usage = await this.fetchUsageTotals(token);
    const userInfo = `upload=${usage.upload}; download=${usage.download}; total=${totalBytes}; expire=${expireTs}`;

    const title = this.configService.get<string>('app.subscription.title') ?? 'Woode VPN';
    const profileTitleBase64 = Buffer.from(title, 'utf8').toString('base64');
    const profileUpdateIntervalHours = Math.max(
      1,
      Number(
        this.configService.get<number>('app.subscription.updateIntervalHours') ??
        12,
      ),
    );

    const supportUrl =
      this.configService.get<string>('app.subscription.supportUrl') ?? '';
    const profileUrl =
      this.configService.get<string>('app.subscription.profileUrl') ?? '';
    const announce = this.configService.get<string>('app.subscription.announce') ?? '';

    const metaLines = [
      `#profile-title: ${title}`,
      `#profile-update-interval: ${profileUpdateIntervalHours}`,
      `#subscription-userinfo: ${userInfo}`,
      ...(supportUrl ? [`#support-url: ${supportUrl}`] : []),
      ...(profileUrl ? [`#profile-web-page-url: ${profileUrl}`] : []),
      ...(announce ? [`#announce: ${announce}`] : []),
    ];

    const plainSubscriptionText = `${metaLines.join('\n')}\n${mergedPlainText}`;
    const subscriptionText =
      this.subscriptionService.encodeBase64Subscription(plainSubscriptionText);

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

  private async fetchLiveSubscriptions(token: string): Promise<string[]> {
    const servers = this.xuiService
      .getServers()
      .filter((server) => Boolean(server.subscriptionUrl));

    if (!servers.length) {
      return [];
    }

    const liveSubscriptions: string[] = [];

    for (const server of servers) {
      try {
        const encodedSubscription = await this.xuiService.getSubscription(
          server,
          token,
        );
        const decodedSubscription =
          this.subscriptionService.decodeBase64Subscription(encodedSubscription);

        if (decodedSubscription.trim()) {
          liveSubscriptions.push(decodedSubscription);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(
          `live subscription refresh failed: server=${server.id}, token=${token}, error=${message}`,
        );
      }
    }

    return liveSubscriptions;
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
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(
          `sync inbounds skipped: userId=${input.userId}, server=${server.id}, error=${message}`,
        );
        continue;
      }

      const allowedInboundIds = server.inboundIds ?? [];
      const selectedInbounds = inbounds
        .filter((item) => allowedInboundIds.length === 0 || allowedInboundIds.includes(item.id))
        .filter((item) => item.protocol === 'vless');

      for (const inbound of selectedInbounds) {
        const mappingKey = `${server.id}:${inbound.id}`;
        if (mappingMap.has(mappingKey)) {
          continue;
        }

        const email = `${emailPrefix}-${server.id}-${inbound.id}`;
        const existingClient = this.parseInboundClients(inbound.settings).find(
          (client) => client.subId === input.token || client.email === email,
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
    const serverById = new Map(servers.map((server) => [server.id, server]));
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
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(
          `build subscription skipped: server=${server.id}, error=${message}`,
        );
        continue;
      }

      const inboundById = new Map<number, XuiInboundItem>(
        inbounds.map((inbound) => [inbound.id, inbound]),
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
      servers.map(async (server) => {
        try {
          return await this.xuiService.getUsageBySubId(server, token);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown error';
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
  }> {
    const profile = await this.prisma.vpnProfile.findUnique({
      where: { userId },
    });

    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endsAt: {
          gt: new Date(),
        },
      },
    });

    if (!profile || !activeSubscription) {
      return { hasActiveSubscription: false };
    }

    return {
      hasActiveSubscription: true,
      subscriptionUrl: this.buildSubscriptionUrl(profile.subscriptionToken),
      endsAt: activeSubscription.endsAt.toISOString(),
    };
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

    const days = this.resolvePlanDays(subscription.startsAt, subscription.endsAt);
    const dayPrices = PLAN_PRICE_CENTS[days];
    if (!dayPrices) {
      return 5;
    }

    const matched = Object.entries(dayPrices).find(([, price]) => price === amountCents);
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
  ): Promise<boolean> {
    if (!hwid) {
      return false;
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
      return false;
    }

    const currentCount = await this.prisma.vpnHwidBinding.count({
      where: { profileId },
    });

    if (currentCount >= deviceLimit) {
      return true;
    }

    await this.prisma.vpnHwidBinding.create({
      data: {
        profileId,
        hwid,
      },
    });

    return false;
  }

  private buildDeviceLimitExceededPayload(
    expiresAt: Date,
    remark = 'Превышен лимит устройств',
  ): {
    subscriptionText: string;
    plainSubscriptionText: string;
    userInfo: string;
    profileTitleBase64: string;
    profileUpdateIntervalHours: number;
    supportUrl: string;
    profileUrl: string;
    announce: string;
  } {
    const title = this.configService.get<string>('app.subscription.title') ?? 'Woode VPN';
    const profileTitleBase64 = Buffer.from(title, 'utf8').toString('base64');
    const profileUpdateIntervalHours = Math.max(
      1,
      Number(
        this.configService.get<number>('app.subscription.updateIntervalHours') ??
        12,
      ),
    );

    const supportUrl =
      this.configService.get<string>('app.subscription.supportUrl') ?? '';
    const profileUrl =
      this.configService.get<string>('app.subscription.profileUrl') ?? '';
    const announce = this.configService.get<string>('app.subscription.announce') ?? '';
    const totalBytes = Math.max(
      0,
      Number(this.configService.get<number>('app.subscription.totalBytes') ?? 0),
    );
    const expireTs = Math.floor(expiresAt.getTime() / 1000);
    const userInfo = `upload=0; download=0; total=${totalBytes}; expire=${expireTs}`;
    const fakeConfig =
      `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:443?encryption=none&type=tcp&security=tls#${encodeURIComponent(remark)}`;

    const metaLines = [
      `#profile-title: ${title}`,
      `#profile-update-interval: ${profileUpdateIntervalHours}`,
      `#subscription-userinfo: ${userInfo}`,
      ...(supportUrl ? [`#support-url: ${supportUrl}`] : []),
      ...(profileUrl ? [`#profile-web-page-url: ${profileUrl}`] : []),
      ...(announce ? [`#announce: ${announce}`] : []),
    ];

    const plainSubscriptionText = `${metaLines.join('\n')}\n${fakeConfig}`;
    const subscriptionText =
      this.subscriptionService.encodeBase64Subscription(plainSubscriptionText);

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
