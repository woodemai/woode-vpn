import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
import { AdminConfirmPaymentDto } from './dto/admin-confirm-payment.dto';
import { AdminApiKeyGuard } from './guards/admin-api-key.guard';

@UseGuards(AdminApiKeyGuard)
@Controller('admin/payments')
export class PaymentsAdminController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('confirm')
  async confirmPayment(@Body() dto: AdminConfirmPaymentDto) {
    return this.paymentsService.confirmPayment({
      userId: Number(dto.userId),
      days: dto.days,
      months: dto.months,
      deviceLimit: dto.deviceLimit,
      paymentId: dto.paymentId,
      amountCents: dto.amountCents,
    });
  }
}
