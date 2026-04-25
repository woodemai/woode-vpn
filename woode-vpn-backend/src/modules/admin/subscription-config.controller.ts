import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiBody,
    ApiOkResponse,
    ApiOperation,
    ApiSecurity,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SubscriptionConfigService } from '../../services/subscription-config.service';
import { UpdateSubscriptionConfigDto } from './dto/update-subscription-config.dto';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';

@ApiTags('Admin')
@ApiSecurity('x-api-key')
@UseGuards(AdminApiKeyGuard)
@Controller('admin/subscription-config')
export class SubscriptionConfigController {
    constructor(
        private readonly subscriptionConfigService: SubscriptionConfigService,
    ) { }

    @Get()
    @ApiOperation({ summary: 'Get current subscription configuration' })
    @ApiOkResponse({ description: 'Subscription config returned successfully' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid API key' })
    async getConfig() {
        return this.subscriptionConfigService.get();
    }

    @Put()
    @ApiOperation({ summary: 'Update subscription configuration' })
    @ApiBody({ type: UpdateSubscriptionConfigDto })
    @ApiOkResponse({ description: 'Subscription config updated successfully' })
    @ApiBadRequestResponse({ description: 'Validation error in request body' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid API key' })
    async updateConfig(@Body() dto: UpdateSubscriptionConfigDto) {
        return this.subscriptionConfigService.update(dto);
    }
}
