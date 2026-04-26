import { Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
import { AdminConfirmPaymentDto } from './dto/admin-confirm-payment.dto';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';

@UseGuards(AdminApiKeyGuard)
@Controller('admin/payments')
export class PaymentsAdminController {
  private readonly logger = new Logger(PaymentsAdminController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('confirm')
  async confirmPayment(@Body() dto: AdminConfirmPaymentDto) {
    const userId = Number(dto.userId);
    this.logger.log(
      `manual payment confirm requested: userId=${userId}, paymentId=${dto.paymentId}`,
    );

    const result = await this.paymentsService.confirmPayment({
      userId: Number(dto.userId),
      days: dto.days,
      months: dto.months,
      deviceLimit: dto.deviceLimit,
      paymentId: dto.paymentId,
      amountCents: dto.amountCents,
    });

    this.logger.log(
      `manual payment confirm finished: userId=${userId}, paymentId=${dto.paymentId}, result=${result.alreadyProcessed ? 'alreadyProcessed' : 'created'}`,
    );

    return result;
  }
}
