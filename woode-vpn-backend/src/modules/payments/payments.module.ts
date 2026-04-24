import { Module } from '@nestjs/common';
import { ServicesModule } from '../../services/services.module';
import { VpnModule } from '../vpn/vpn.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [VpnModule, ServicesModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule { }
