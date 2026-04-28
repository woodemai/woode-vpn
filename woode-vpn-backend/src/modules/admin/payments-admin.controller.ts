import { Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PaymentsService } from '../payments/payments.service';
import { AdminConfirmPaymentDto } from './dto/admin-confirm-payment.dto';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';

@ApiTags('Admin')
@ApiSecurity('x-api-key')
@UseGuards(AdminApiKeyGuard)
@Controller('admin/payments')
export class PaymentsAdminController {
  private readonly logger = new Logger(PaymentsAdminController.name);

  constructor(private readonly paymentsService: PaymentsService) { }

  @Post('confirm')
  @ApiOperation({
    summary: 'Manual payment confirmation (webhook recovery)',
    description:
      'Admin endpoint to manually confirm payment when YooKassa webhook was not delivered. Idempotent by paymentId. Same result as webhook confirmation - activates subscription. Requires valid admin API key in X-API-Key header.',
  })
  @ApiBody({ type: AdminConfirmPaymentDto })
  @ApiOkResponse({
    description: 'Payment confirmed or already processed',
    example: {
      subscriptionId: 42,
      userId: 123,
      status: 'ACTIVE',
      startsAt: '2026-04-28T11:35:10.000Z',
      endsAt: '2026-05-28T11:35:10.000Z',
      deviceLimit: 5,
      alreadyProcessed: false,
    },
  })
  @ApiBadRequestResponse({
    description:
      'Validation error or inconsistent payment data (invalid userId, missing paymentId)',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid X-API-Key header',
  })
  async confirmPayment(@Body() dto: AdminConfirmPaymentDto) {
    this.logger.log(
      `manual payment confirm requested: userId=${dto.userId}, paymentId=${dto.paymentId}`,
    );

    const result = await this.paymentsService.confirmPayment({
      userId: dto.userId,
      days: dto.days,
      deviceLimit: dto.deviceLimit,
      paymentId: dto.paymentId,
      amountCents: dto.amountCents,
    });

    this.logger.log(
      `manual payment confirm finished: userId=${dto.userId}, paymentId=${dto.paymentId}, result=${result.alreadyProcessed ? 'alreadyProcessed' : 'created'}`,
    );

    return result;
  }
}
