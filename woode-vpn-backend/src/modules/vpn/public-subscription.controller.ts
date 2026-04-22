import { Controller, Get, Header, Param } from '@nestjs/common';
import { VpnService } from './vpn.service';

@Controller()
export class PublicSubscriptionController {
  constructor(private readonly vpnService: VpnService) {}

  @Get('sub/:token')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async getSubscription(@Param('token') token: string) {
    return this.vpnService.getSubscriptionByToken(token);
  }
}