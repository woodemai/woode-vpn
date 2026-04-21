import { Module } from '@nestjs/common';
import { ServicesModule } from '../../services/services.module';
import { VpnController } from './vpn.controller';
import { VpnService } from './vpn.service';

@Module({
  imports: [ServicesModule],
  controllers: [VpnController],
  providers: [VpnService],
  exports: [VpnService],
})
export class VpnModule {}
