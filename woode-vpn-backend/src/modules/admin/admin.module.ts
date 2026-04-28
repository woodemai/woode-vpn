import { Module } from '@nestjs/common';
import { PrismaModule } from '../../db/prisma.module';
import { ServicesModule } from '../../services/services.module';
import { PaymentsModule } from '../payments/payments.module';
import { VpnModule } from '../vpn/vpn.module';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';
import { PaymentsAdminController } from './payments-admin.controller';
import { SubscriptionConfigController } from './subscription-config.controller';
import { SubscriptionsAdminController } from './subscriptions-admin.controller';
import { UsersAdminController } from './users-admin.controller';
import { AdminUsersService } from './users-admin.service';

@Module({
  imports: [ServicesModule, PaymentsModule, VpnModule, PrismaModule],
  controllers: [
    SubscriptionConfigController,
    PaymentsAdminController,
    SubscriptionsAdminController,
    UsersAdminController,
  ],
  providers: [AdminApiKeyGuard, AdminSubscriptionsService, AdminUsersService],
})
export class AdminModule { }
