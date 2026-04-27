import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SubscriptionStatus, User, VpnProfile } from '@prisma/client';
import { randomUUID } from 'crypto';
import { customAlphabet } from 'nanoid';
import { slugify } from 'transliteration';
import { PrismaService } from '../../db/prisma.service';
import { SubscriptionConfigService } from '../../services/subscription-config.service';
import { SubscriptionService } from '../../services/subscription.service';
import { TelegramNotifierService } from '../../services/telegram-notifier.service';
import { XuiInbound, XuiService } from '../../services/xui.service';

interface CachedSubscription {
  configs: string[];
  expiresAt: number;
}

type DeviceBindResult =
  | { status: 'existing' }
  | { status: 'created'; currentCount: number }
  | { status: 'limit_exceeded'; currentCount: number };

function toNonNegativeBigInt(value: number): bigint {
  if (!Number.isFinite(value)) {
    return 0n;
  }

  return BigInt(Math.max(0, Math.trunc(value)));
}

function bigIntToSafeNumber(value: bigint | number | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  }

  if (typeof value !== 'bigint') {
    return 0;
  }

  if (value <= 0n) {
    return 0;
  }

  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > maxSafe ? maxSafe : value);
}

const PLAN_PRICE_CENTS: Record<number, Record<number, number>> = {
  30: { 5: 10000, 10: 15000, 15: 20000 },
  90: { 5: 27000, 10: 40000, 15: 54000 },
  180: { 5: 51000, 10: 76000, 15: 100000 },
  365: { 5: 100000, 10: 145000, 15: 200000 },
};

function createShortUniqueLabel(
  value: string,
  suffix: string,
  suffix2: string,
): string {
  const slug = slugify(value, {
    lowercase: true,
    separator: '.',
  }).slice(0, 12);

  const hash = Buffer.from(value, 'utf8').toString('hex').slice(0, 4);
  const compactSlug = slug || 'user';

  return `${compactSlug}-${hash}-${suffix}-${suffix2}`;
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
      this.configService.get<number>(
        'app.subscription.refreshThrottleMinutes',
      ) ?? 10,
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

  async provisionForUser(userId: number): Promise<{
    profile: VpnProfile;
    subscriptionText: string;
    subscriptionUrl: string;
  }> {
    const startedAt = Date.now();
    this.logger.log(`provisionForUser started: userId=${userId}`);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const telegramNameSource =
      (user as typeof user & { telegramName?: string | null }).telegramName ??
      user.externalId ??
      `user-${userId}`;

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

    const servers = await this.prisma.xuiServer.findMany({
      where: {
        enabled: true,
      },
    });
    if (!servers.length) {
      throw new BadRequestException('No x-ui servers configured');
    }

    this.logger.log(
      `provisionForUser servers selected: userId=${userId}, servers=${servers.length}`,
    );

    const token =
      existingProfile?.subscriptionToken ?? generateSubscriptionToken();
    const subscriptions: string[] = [];

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
      const selectedInbounds = inbounds.filter(
        item => item.protocol === 'vless',
      );

      this.logger.log(
        `server inbounds prepared: userId=${userId}, server=${server.id}, total=${inbounds.length}, selectedVless=${selectedInbounds.length}`,
      );

      if (!selectedInbounds.length) {
        continue;
      }

      for (const inbound of selectedInbounds) {
        const existingClient = inbound.clientStats.find(
          client => client.subId === token,
        );
        const inboundNetwork = this.subscriptionService.parseStreamSettings(
          inbound.streamSettings,
        ).network;
        const flow =
          (inboundNetwork ?? 'tcp') === 'tcp' ? 'xtls-rprx-vision' : '';

        const uuid = existingClient?.uuid ?? randomUUID();
        const email = createShortUniqueLabel(
          telegramNameSource,
          server.id.toString(),
          inbound.id.toString(),
        );

        if (!existingClient) {
          await this.xuiService.addClient(server, inbound.id, {
            id: uuid,
            flow,
            email,
            subId: token,
            enable: true,
            limitIp: deviceLimit,
          });
        }

        const config = this.buildConfig(inbound, uuid, server.host);

        serverConfigs.push(config);
      }

      subscriptions.push(...serverConfigs);

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
        active: true,
      },
      update: {
        configs: subscriptions as unknown as Prisma.InputJsonValue,
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
    updateIntervalHours: number;
    supportUrl: string | null;
    profileUrl: string | null;
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
    const effectiveSubscriptions = cachedSubscriptions ?? storedSubscriptions;

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
    const upload = bigIntToSafeNumber(profile.usageUploadBytes);
    const download = bigIntToSafeNumber(profile.usageDownloadBytes);
    const userInfo = `upload=${upload}; download=${download}; total=${totalBytes}; expire=${expireTs}`;

    const {
      title = '',
      announce = '',
      profileUrl = '',
      supportUrl = '',
      updateIntervalHours = 6,
    } = await this.subscriptionConfigService.get();
    const profileTitleBase64 = Buffer.from(title, 'utf8').toString('base64');

    const metaLines = [
      `#profile-title: ${title}`,
      `#profile-update-interval: ${updateIntervalHours}`,
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
      updateIntervalHours,
      supportUrl,
      profileUrl,
      announce,
    };
  }

  async refreshProfileConfigs(
    profile: VpnProfile & { user: User },
  ): Promise<
    | 'updated'
    | 'skipped-throttled'
    | 'skipped-no-token'
    | 'skipped-no-active-subscription'
  > {
    if (!profile.active || !profile.subscriptionToken) {
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
    const servers = await this.prisma.xuiServer.findMany({
      where: { enabled: true },
    });

    const subscriptions: string[] = [];
    let usageDownloadBytes = 0;
    let usageUploadBytes = 0;

    for (const server of servers) {
      let inbounds: XuiInbound[];

      try {
        inbounds = await this.xuiService.getInbounds(server);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(
          `refresh inbounds failed: profileId=${profile.id}, server=${server.id}, error=${message}`,
        );
        continue;
      }

      const selectedInbounds = inbounds.filter(
        inbound => inbound.protocol === 'vless',
      );

      for (const inbound of selectedInbounds) {
        const existingClient = inbound.clientStats.find(
          stat => stat.subId === profile.subscriptionToken,
        );
        const inboundNetwork = this.subscriptionService.parseStreamSettings(
          inbound.streamSettings,
        ).network;
        const flow =
          (inboundNetwork ?? 'tcp') === 'tcp' ? 'xtls-rprx-vision' : '';

        let uuid = existingClient?.uuid;

        if (!uuid) {
          const email = createShortUniqueLabel(
            profile.user.telegramName,
            server.id.toString(),
            inbound.id.toString(),
          );
          uuid = randomUUID();

          try {
            await this.xuiService.addClient(server, inbound.id, {
              id: uuid,
              flow,
              email,
              subId: profile.subscriptionToken,
              enable: true,
              limitIp: deviceLimit,
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'unknown error';
            this.logger.warn(
              `refresh addClient failed: profileId=${profile.id}, server=${server.id}, inboundId=${inbound.id}, error=${message}`,
            );
            continue;
          }
        } else if (existingClient) {
          usageDownloadBytes += Number(existingClient.down ?? 0);
          usageUploadBytes += Number(existingClient.up ?? 0);
        }

        subscriptions.push(this.buildConfig(inbound, uuid, server.host));
      }
    }

    const fallbackConfigs = Array.isArray(profile.configs)
      ? (profile.configs as string[])
      : [];
    const configsToStore = subscriptions.length
      ? subscriptions
      : fallbackConfigs;

    await this.prisma.vpnProfile.update({
      where: { id: profile.id },
      data: {
        ...(configsToStore.length
          ? {
            configs: configsToStore as unknown as Prisma.InputJsonValue,
          }
          : {}),
        usageDownloadBytes: toNonNegativeBigInt(usageDownloadBytes),
        usageUploadBytes: toNonNegativeBigInt(usageUploadBytes),
        lastRefreshedAt: new Date(),
      },
    });

    if (configsToStore.length) {
      this.setCachedSubscriptions(profile.subscriptionToken, configsToStore);
    }

    return 'updated';
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

  private buildConfig(inbound: XuiInbound, uuid: string, host: string): string {
    const streamSettings = this.subscriptionService.parseStreamSettings(
      inbound.streamSettings,
    );
    const settings = this.subscriptionService.parseSettings(inbound.settings);
    const params = new URLSearchParams();

    const clientFlow = settings.clients?.find(
      client => client.id === uuid,
    )?.flow;
    const network = streamSettings.network ?? 'tcp';
    const realitySettings = streamSettings.realitySettings;
    const randomShortId = realitySettings?.shortIds?.length
      ? realitySettings.shortIds[
      Math.floor(Math.random() * realitySettings.shortIds.length)
      ]
      : '';
    const xhttpSettings = (
      streamSettings as unknown as {
        xhttpSettings?: {
          host?: string;
          mode?: string;
          path?: string;
        };
      }
    ).xhttpSettings;

    params.set('encryption', settings.encryption ?? 'none');

    if (network !== 'xhttp' && clientFlow) {
      params.set('flow', clientFlow);
    }

    params.set('fp', realitySettings?.settings?.fingerprint ?? '');
    params.set('pbk', realitySettings?.settings?.publicKey ?? '');
    params.set('security', streamSettings.security ?? '');
    params.set('sid', randomShortId);
    params.set('sni', realitySettings?.serverNames?.[0] ?? '');
    params.set('spx', realitySettings?.settings?.spiderX ?? '');
    params.set('type', network);

    if (network === 'xhttp') {
      params.set('host', xhttpSettings?.host ?? '');
      params.set('mode', xhttpSettings?.mode ?? 'auto');
      params.set('path', xhttpSettings?.path ?? '/');
    }

    return `${inbound.protocol}://${uuid}@${host}:${inbound.port}?${params}#${inbound.remark}`;
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
    const trafficUsedBytes =
      bigIntToSafeNumber(profile.usageUploadBytes) +
      bigIntToSafeNumber(profile.usageDownloadBytes);
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

    const servers = await this.prisma.xuiServer.findMany({
      where: { enabled: true },
    });
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
    updateIntervalHours: number;
    supportUrl: string | null;
    profileUrl: string | null;
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
      updateIntervalHours: profileUpdateIntervalHours,
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
