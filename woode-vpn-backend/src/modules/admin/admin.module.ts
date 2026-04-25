import { Module } from '@nestjs/common';
import { ServicesModule } from '../../services/services.module';
import { SubscriptionConfigController } from './subscription-config.controller';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';

@Module({
    imports: [ServicesModule],
    controllers: [SubscriptionConfigController],
    providers: [AdminApiKeyGuard],
})
export class AdminModule { }
