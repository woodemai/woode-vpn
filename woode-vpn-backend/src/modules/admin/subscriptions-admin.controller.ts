import { Controller, Delete, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';
import { AdminSubscriptionsService } from './admin-subscriptions.service';

@ApiTags('Admin')
@ApiSecurity('x-api-key')
@UseGuards(AdminApiKeyGuard)
@Controller('admin/subscriptions')
export class SubscriptionsAdminController {
  constructor(
    private readonly adminSubscriptionsService: AdminSubscriptionsService,
  ) {}

  @Delete(':id')
  @ApiOperation({
    summary: 'Cancel last subscription for user',
    description:
      'Cancels only the latest user subscription (by endsAt), synchronizes VPN access and sends Telegram notification.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'Subscription id' })
  @ApiOkResponse({
    description: 'Subscription canceled successfully',
    schema: {
      example: {
        success: true,
        subscriptionId: 101,
        userId: 42,
        status: 'CANCELED',
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'ONLY_LAST_SUBSCRIPTION_ALLOWED | SUBSCRIPTION_NOT_ACTIVE',
  })
  @ApiNotFoundResponse({ description: 'NOT_FOUND' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid ADMIN_API_KEY' })
  async cancelSubscription(@Param('id', ParseIntPipe) id: number) {
    return this.adminSubscriptionsService.cancelLastSubscription(id);
  }
}
