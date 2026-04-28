import { Body, Controller, Post } from '@nestjs/common';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { YooKassaWebhookDto } from './dto/yookassa-webhook.dto';
import { PaymentsService } from './payments.service';
import { ApiBadRequestResponse, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) { }

  @Post('create')
  @ApiOperation({
    summary: 'Create YooKassa payment and return confirmation URL',
    description:
      'Initiate a new payment through YooKassa payment provider. Returns confirmation URL for user to complete payment. Supports configurable subscription days, device limits, and amounts.',
  })
  @ApiBody({ type: CreatePaymentDto })
  @ApiOkResponse({
    description: 'Payment created successfully with confirmation URL',
    example: {
      paymentId: '317d715c-000f-5001-8000-1cabdbba208c',
      confirmationUrl: 'https://yookassa.ru/checkout/...',
      expiresAt: '2026-04-28T14:35:10.000Z',
    },
  })
  @ApiBadRequestResponse({
    description:
      'Invalid payment request (missing userId, invalid days/limits)',
  })
  async create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.createYooKassaPayment(dto);
  }

  @Post('confirm')
  @ApiOperation({
    summary: 'Confirm payment and activate subscription',
    description:
      'Confirm successful payment from YooKassa and activate subscription for user. Returns subscription details with expiration date. Idempotent by paymentId.',
  })
  @ApiBody({ type: ConfirmPaymentDto })
  @ApiOkResponse({
    description: 'Payment confirmed and subscription activated',
    example: {
      subscriptionId: 42,
      userId: 1,
      status: 'ACTIVE',
      startsAt: '2026-04-28T11:35:10.000Z',
      endsAt: '2026-05-28T11:35:10.000Z',
      deviceLimit: 5,
      alreadyProcessed: false,
    },
  })
  @ApiBadRequestResponse({
    description:
      'Confirmation failed - invalid userId, missing paymentId, or inconsistent data',
  })
  async confirm(@Body() dto: ConfirmPaymentDto) {
    return this.paymentsService.confirmPayment(dto);
  }

  @Post('webhooks/yookassa')
  @ApiOperation({
    summary: 'Handle YooKassa webhook callback',
    description:
      'Webhook endpoint for receiving payment status updates from YooKassa. Validates signature and processes payment confirmation automatically.',
  })
  @ApiBody({ type: YooKassaWebhookDto })
  @ApiOkResponse({
    description: 'Webhook processed successfully',
    example: {
      status: 'processed',
      paymentId: '317d715c-000f-5001-8000-1cabdbba208c',
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid webhook payload or signature verification failed',
  })
  async yookassaWebhook(@Body() dto: YooKassaWebhookDto) {
    return this.paymentsService.handleYooKassaWebhook(dto);
  }
}
