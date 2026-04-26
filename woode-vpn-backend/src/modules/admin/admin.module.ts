import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { ServicesModule } from '../../services/services.module';
import { SubscriptionConfigController } from './subscription-config.controller';
import { PaymentsAdminController } from './payments-admin.controller';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';

@Module({
    imports: [ServicesModule, PaymentsModule],
    controllers: [SubscriptionConfigController, PaymentsAdminController],
    providers: [AdminApiKeyGuard],
})
export class AdminModule { }
