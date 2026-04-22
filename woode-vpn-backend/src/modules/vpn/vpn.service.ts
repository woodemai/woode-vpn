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

@Injectable()
export class VpnService {
  private readonly logger = new Logger(VpnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xuiService: XuiService,
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
  ) {}

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

    const configs: string[] = [];
    const mappings: ClientMapping[] = [];

    for (const server of servers) {
      const serverStartedAt = Date.now();
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
        const email = `u${userId}-${server.id}-${inbound.id}`;

        await this.xuiService.addClient(server, inbound.id, {
          id: uuid,
          email,
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

        configs.push(config);
        mappings.push({
          serverId: server.id,
          country: server.country,
          inboundId: inbound.id,
          uuid,
        });
      }

      this.logger.log(
        `server provisioning done: userId=${userId}, server=${server.id}, durationMs=${Date.now() - serverStartedAt}`,
      );
    }

    if (!configs.length) {
      throw new BadRequestException('No inbounds available for provisioning');
    }

    const token = randomUUID();
    const profile = await this.prisma.vpnProfile.upsert({
      where: { userId },
      create: {
        userId,
        subscriptionToken: token,
        configs: configs as unknown as Prisma.InputJsonValue,
        clientMappings: mappings as unknown as Prisma.InputJsonValue,
        active: true,
      },
      update: {
        configs: configs as unknown as Prisma.InputJsonValue,
        clientMappings: mappings as unknown as Prisma.InputJsonValue,
        active: true,
      },
    });

    const subscriptionText = this.subscriptionService.merge(configs);
    const subscriptionUrl = this.buildSubscriptionUrl(profile.subscriptionToken);

    this.logger.log(
      `provisionForUser finished: userId=${userId}, configs=${configs.length}, durationMs=${Date.now() - startedAt}`,
    );

    return {
      profile,
      subscriptionText,
      subscriptionUrl,
    };
  }

  async getSubscriptionByToken(token: string): Promise<string> {
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

    const configs = Array.isArray(profile.configs)
      ? (profile.configs as string[])
      : [];

    return this.subscriptionService.merge(configs);
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
    return `${publicBaseUrl}/api/vpn/subscriptions/${token}`;
  }
}
