import {
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VpnService } from './vpn.service';

@ApiTags('VPN')
@Controller('vpn')
export class VpnController {
  constructor(private readonly vpnService: VpnService) { }

  @Get('users/:userId/profile')
  @ApiOperation({ summary: 'Get VPN profile information for user' })
  @ApiOkResponse({ description: 'Profile returned successfully' })
  @ApiBadRequestResponse({ description: 'Invalid user id' })
  async getUserProfile(@Param('userId', ParseIntPipe) userId: number) {
    return this.vpnService.getUserProfile(userId);
  }

  @Get('subscriptions/:token')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({ summary: 'Get encoded subscription by token' })
  @ApiOkResponse({ description: 'Subscription returned successfully' })
  @ApiBadRequestResponse({ description: 'Subscription token is invalid or expired' })
  async getSubscription(@Param('token') token: string) {
    return this.vpnService.getSubscriptionByToken(token);
  }
}
