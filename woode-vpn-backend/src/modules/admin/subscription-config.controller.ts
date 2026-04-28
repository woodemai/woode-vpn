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
  @ApiOperation({
    summary: 'Get current subscription configuration',
    description:
      'Retrieve global subscription configuration including default device limits, supported plan durations, pricing tiers, and feature flags. Returns configuration object used by payment and subscription services.',
  })
  @ApiOkResponse({
    description: 'Subscription config returned successfully',
    example: {
      defaultDeviceLimit: 5,
      maxDeviceLimit: 20,
      minSubscriptionDays: 1,
      maxSubscriptionDays: 3650,
      supportedDurations: [7, 30, 90, 180, 365],
      pricingTiers: [
        { days: 30, deviceLimit: 5, priceRub: 150 },
        { days: 90, deviceLimit: 10, priceRub: 350 },
      ],
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid X-API-Key header',
  })
  async getConfig() {
    return this.subscriptionConfigService.get();
  }

  @Put()
  @ApiOperation({
    summary: 'Update subscription configuration',
    description:
      'Update global subscription configuration settings. Changes apply immediately to all new subscription requests and payment calculations. Requires admin API key.',
  })
  @ApiBody({ type: UpdateSubscriptionConfigDto })
  @ApiOkResponse({
    description: 'Subscription config updated successfully',
    example: {
      defaultDeviceLimit: 5,
      maxDeviceLimit: 20,
      minSubscriptionDays: 1,
      maxSubscriptionDays: 3650,
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation error in request body (invalid limits or pricing)',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid X-API-Key header',
  })
  async updateConfig(@Body() dto: UpdateSubscriptionConfigDto) {
    return this.subscriptionConfigService.update(dto);
  }
}
