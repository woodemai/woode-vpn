import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
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
    summary: 'Get subscription profile (public endpoint)',
    description:
      'Retrieve subscription profile with user info and node list. Supports HWID-based device limiting. Returns plain text with subscription metadata headers and V2Ray/Clash nodes. Cache-control headers ensure no caching.',
  })
  @ApiParam({
    name: 'token',
    type: String,
    description: 'Subscription token (from subscription URL)',
    example: 'token_abc123_def456',
  })
  @ApiQuery({
    name: 'hwid',
    required: false,
    description:
      'Client hardware ID for device limiting. Can also be provided via X-HWID or X-Device-ID headers.',
    example: 'device_id_1234567890',
  })
  @ApiOkResponse({
    description: 'Subscription profile returned with metadata headers',
  })
  @ApiBadRequestResponse({
    description:
      'Subscription cannot be served - token invalid, expired, or device limit exceeded',
  })
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

    return payload.plainSubscriptionText;
  }
}
