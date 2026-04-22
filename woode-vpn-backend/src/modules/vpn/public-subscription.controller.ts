import { Controller, Get, Param, Res } from '@nestjs/common';
import { VpnService } from './vpn.service';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Controller()
export class PublicSubscriptionController {
  constructor(
    private readonly vpnService: VpnService,
    private readonly configService: ConfigService,
  ) {}

  @Get('sub/:token')
  async getSubscription(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const payload = await this.vpnService.getSubscriptionPayloadByToken(token);

    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    );
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    response.setHeader('Surrogate-Control', 'no-store');
    response.setHeader('Subscription-Userinfo', payload.userInfo);
    response.setHeader('Profile-Title', payload.profileTitleBase64);
    response.setHeader(
      'Profile-Update-Interval',
      String(payload.profileUpdateIntervalHours),
    );

    if (payload.supportUrl) {
      response.setHeader('Support-URL', payload.supportUrl);
    }
    if (payload.profileUrl) {
      response.setHeader('Profile-Web-Page-URL', payload.profileUrl);
    }

    const plainResponse =
      this.configService.get<boolean>('app.subscription.plainResponse') ?? true;

    return plainResponse
      ? payload.plainSubscriptionText
      : payload.subscriptionText;
  }
}