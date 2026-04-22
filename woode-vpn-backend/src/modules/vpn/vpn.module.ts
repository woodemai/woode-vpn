import { Module } from '@nestjs/common';
import { ServicesModule } from '../../services/services.module';
import { PublicSubscriptionController } from './public-subscription.controller';
import { VpnController } from './vpn.controller';
import { VpnService } from './vpn.service';

@Module({
  imports: [ServicesModule],
  controllers: [VpnController, PublicSubscriptionController],
  providers: [VpnService],
  exports: [VpnService],
})
export class VpnModule {}
