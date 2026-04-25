import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SubscriptionConfigService } from '../../services/subscription-config.service';
import { UpdateSubscriptionConfigDto } from './dto/update-subscription-config.dto';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';

@UseGuards(AdminApiKeyGuard)
@Controller('admin/subscription-config')
export class SubscriptionConfigController {
    constructor(
        private readonly subscriptionConfigService: SubscriptionConfigService,
    ) { }

    @Get()
    async getConfig() {
        return this.subscriptionConfigService.get();
    }

    @Put()
    async updateConfig(@Body() dto: UpdateSubscriptionConfigDto) {
        return this.subscriptionConfigService.update(dto);
    }
}
