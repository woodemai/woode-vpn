import {
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
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
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';

@ApiTags('Admin')
@ApiSecurity('x-api-key')
@UseGuards(AdminApiKeyGuard)
@Controller('admin/subscriptions')
export class SubscriptionsAdminController {
  constructor(
    private readonly adminSubscriptionsService: AdminSubscriptionsService,
  ) { }

  @Delete(':id')
  @ApiOperation({
    summary: 'Cancel subscription',
    description:
      'Cancel only the latest active subscription for a user. Cannot cancel subscriptions from the middle of the subscription list if later subscriptions exist. Automatically disables VPN access if no active subscriptions remain and sends Telegram notification.',
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'Subscription ID to cancel',
    example: 101,
  })
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
      'Cannot cancel subscription - either not the latest one or already inactive',
  })
  @ApiNotFoundResponse({ description: 'Subscription not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid ADMIN_API_KEY' })
  async cancelSubscription(@Param('id', ParseIntPipe) id: number) {
    return this.adminSubscriptionsService.cancelLastSubscription(id);
  }
}
