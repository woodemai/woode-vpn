import { Body, Controller, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { YooKassaWebhookDto } from './dto/yookassa-webhook.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) { }

  @Post('create')
  @ApiOperation({ summary: 'Create YooKassa payment and return confirmation URL' })
  @ApiBody({ type: CreatePaymentDto })
  @ApiOkResponse({ description: 'Payment created successfully' })
  @ApiBadRequestResponse({ description: 'Invalid payment request' })
  async create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.createYooKassaPayment(dto);
  }

  @Post('confirm')
  @ApiOperation({ summary: 'Confirm payment and activate subscription' })
  @ApiBody({ type: ConfirmPaymentDto })
  @ApiOkResponse({ description: 'Payment confirmed successfully' })
  @ApiBadRequestResponse({ description: 'Invalid confirmation request' })
  async confirm(@Body() dto: ConfirmPaymentDto) {
    return this.paymentsService.confirmPayment(dto);
  }

  @Post('webhooks/yookassa')
  @ApiOperation({ summary: 'Handle YooKassa webhook callback' })
  @ApiBody({ type: YooKassaWebhookDto })
  @ApiOkResponse({ description: 'Webhook processed successfully' })
  @ApiBadRequestResponse({ description: 'Invalid webhook payload' })
  async yookassaWebhook(@Body() dto: YooKassaWebhookDto) {
    return this.paymentsService.handleYooKassaWebhook(dto);
  }
}
