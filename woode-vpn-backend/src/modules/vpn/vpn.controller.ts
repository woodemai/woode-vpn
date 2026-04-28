import { Controller, Get, Header, Param, ParseIntPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { VpnService } from './vpn.service';

@ApiTags('VPN')
@Controller('vpn')
export class VpnController {
  constructor(private readonly vpnService: VpnService) { }

  @Get('users/:userId/profile')
  @ApiOperation({
    summary: 'Get user VPN profile and subscription status',
    description:
      'Retrieve VPN profile information for user including subscription status, device limits, traffic usage, and expiration date.',
  })
  @ApiParam({
    name: 'userId',
    type: Number,
    description: 'User ID',
    example: 1,
  })
  @ApiOkResponse({
    description: 'Profile returned successfully',
    schema: {
      example: {
        hasActiveSubscription: true,
        subscriptionUrl: 'token123...',
        endsAt: '2026-05-28T11:00:00Z',
        profileName: 'john_doe',
        devicesConnected: 2,
        devicesMax: 5,
        trafficUsedBytes: 1073741824,
        trafficTotalBytes: 107374182400,
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid user ID' })
  async getUserProfile(@Param('userId', ParseIntPipe) userId: number) {
    return this.vpnService.getUserProfile(userId);
  }

  @Get('subscriptions/:token')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({
    summary: 'Get encoded subscription configuration (internal)',
    description:
      'Retrieve base64-encoded subscription configuration for legacy clients. Returns plain text encoded in base64 format.',
  })
  @ApiParam({
    name: 'token',
    type: String,
    description: 'Subscription token',
    example: 'abc123def456',
  })
  @ApiOkResponse({
    description: 'Subscription configuration returned (base64 encoded)',
  })
  @ApiBadRequestResponse({
    description: 'Subscription token is invalid or expired',
  })
  async getSubscription(@Param('token') token: string) {
    return this.vpnService.getSubscriptionByToken(token);
  }
}
