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

  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('confirm')
  @ApiOperation({
    summary: 'Manual payment confirmation (webhook recovery)',
    description:
      'Use this endpoint to recover payment processing when payment provider webhook was not delivered. Reuses existing confirmPayment logic with idempotency by paymentId.',
  })
  @ApiBody({ type: AdminConfirmPaymentDto })
  @ApiOkResponse({ description: 'Payment confirmed or already processed' })
  @ApiBadRequestResponse({
    description: 'Validation error or inconsistent payment data',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid ADMIN_API_KEY' })
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
