import { Body, Controller, Post } from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { YooKassaWebhookDto } from './dto/yookassa-webhook.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) { }

  @Post('create')
  async create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.createYooKassaPayment(dto);
  }

  @Post('confirm')
  async confirm(@Body() dto: ConfirmPaymentDto) {
    return this.paymentsService.confirmPayment(dto);
  }

  @Post('webhooks/yookassa')
  async yookassaWebhook(@Body() dto: YooKassaWebhookDto) {
    return this.paymentsService.handleYooKassaWebhook(dto);
  }
}
