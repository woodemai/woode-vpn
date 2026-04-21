import {
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { VpnService } from './vpn.service';

@Controller('vpn')
export class VpnController {
  constructor(private readonly vpnService: VpnService) {}

  @Get('users/:userId/profile')
  async getUserProfile(@Param('userId', ParseIntPipe) userId: number) {
    return this.vpnService.getUserProfile(userId);
  }

  @Get('subscriptions/:token')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async getSubscription(@Param('token') token: string) {
    return this.vpnService.getSubscriptionByToken(token);
  }
}
