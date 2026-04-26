import { Module } from '@nestjs/common';
import { PrismaModule } from '../../db/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { ServicesModule } from '../../services/services.module';
import { VpnModule } from '../vpn/vpn.module';
import { SubscriptionConfigController } from './subscription-config.controller';
import { PaymentsAdminController } from './payments-admin.controller';
import { SubscriptionsAdminController } from './subscriptions-admin.controller';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';

@Module({
  imports: [ServicesModule, PaymentsModule, VpnModule, PrismaModule],
  controllers: [
    SubscriptionConfigController,
    PaymentsAdminController,
    SubscriptionsAdminController,
  ],
  providers: [AdminApiKeyGuard, AdminSubscriptionsService],
})
export class AdminModule {}
