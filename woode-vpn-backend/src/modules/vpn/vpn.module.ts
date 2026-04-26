import { Module } from '@nestjs/common';
import { PrismaModule } from '../../db/prisma.module';
import { ServicesModule } from '../../services/services.module';
import { PublicSubscriptionController } from './public-subscription.controller';
import { SubscriptionRefreshService } from './subscription-refresh.service';
import { VpnController } from './vpn.controller';
import { VpnService } from './vpn.service';

@Module({
  imports: [ServicesModule, PrismaModule],
  controllers: [VpnController, PublicSubscriptionController],
  providers: [VpnService, SubscriptionRefreshService],
  exports: [VpnService],
})
export class VpnModule {}
