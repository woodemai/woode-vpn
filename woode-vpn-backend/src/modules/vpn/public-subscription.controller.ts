import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { VpnService } from './vpn.service';

@ApiTags('Public Subscription')
@Controller()
export class PublicSubscriptionController {
  constructor(
    private readonly vpnService: VpnService,
    private readonly configService: ConfigService,
  ) { }

  @Get('sub/:token')
  @ApiOperation({
    summary: 'Get plain or encoded subscription by public token',
  })
  @ApiQuery({
    name: 'hwid',
    required: false,
    description: 'Client hardware id',
  })
  @ApiOkResponse({ description: 'Subscription payload returned' })
  @ApiBadRequestResponse({ description: 'Subscription cannot be served' })
  async getSubscription(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
    @Query('hwid') hwidFromQuery?: string,
  ) {
    const hwidHeader =
      request?.headers['x-hwid'] ?? request?.headers['x-device-id'];
    const hwidFromHeader = Array.isArray(hwidHeader)
      ? hwidHeader[0]
      : hwidHeader;
    const hwid = hwidFromQuery ?? hwidFromHeader;

    const payload = await this.vpnService.getSubscriptionPayloadByToken(
      token,
      hwid,
    );

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
      String(payload.updateIntervalHours),
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
