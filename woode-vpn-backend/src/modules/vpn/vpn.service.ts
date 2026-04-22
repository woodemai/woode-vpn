import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SubscriptionStatus, VpnProfile } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../db/prisma.service';
import { SubscriptionService } from '../../services/subscription.service';
import { XuiService } from '../../services/xui.service';

interface ClientMapping {
  serverId: string;
  country: string;
  inboundId: number;
  uuid: string;
}

function createShortUniqueLabel(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '')
    .slice(0, 12);

  const hash = Buffer.from(value, 'utf8').toString('hex').slice(0, 4);
  const compactSlug = slug || 'user';

  return `${compactSlug}-${hash}`;
}

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

    const servers = this.xuiService.getServers();
    if (!servers.length) {
      throw new BadRequestException('No x-ui servers configured');
    }

    this.logger.log(`provisionForUser servers selected: userId=${userId}, servers=${servers.length}`);

    const token = randomUUID();
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

  async getSubscriptionByToken(token: string): Promise<string> {
    const payload = await this.getSubscriptionPayloadByToken(token);
    return payload.subscriptionText;
  }

  async getSubscriptionPayloadByToken(token: string): Promise<{
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

    const subscriptions = Array.isArray(profile.configs)
      ? (profile.configs as string[])
      : [];

    const refreshFromXui =
      this.configService.get<boolean>('app.subscription.refreshFromXui') ?? true;

    let effectiveSubscriptions = subscriptions;
    if (refreshFromXui) {
      const liveSubscriptions = await this.fetchLiveSubscriptions(token);

      if (liveSubscriptions.length) {
        effectiveSubscriptions = liveSubscriptions;
        await this.prisma.vpnProfile.update({
          where: { id: profile.id },
          data: {
            configs: liveSubscriptions as unknown as Prisma.InputJsonValue,
          },
        });
      }
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
    const userInfo = `upload=0; download=0; total=${totalBytes}; expire=${expireTs}`;

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

  async getUserProfile(userId: number): Promise<{
    hasActiveSubscription: boolean;
    subscriptionUrl?: string;
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
    };
  }

  private buildSubscriptionUrl(token: string): string {
    const publicBaseUrl = this.configService.get<string>('app.publicBaseUrl');
    return `${publicBaseUrl}/sub/${token}`;
  }
}
