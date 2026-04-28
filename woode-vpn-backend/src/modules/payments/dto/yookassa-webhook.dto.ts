import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString } from 'class-validator';

export class YooKassaWebhookDto {
  @ApiProperty({ example: 'notification' })
  @IsString()
  type!: string;

  @ApiProperty({ example: 'payment.succeeded' })
  @IsString()
  event!: string;

  @ApiProperty({ description: 'Raw YooKassa payment object payload' })
  @IsObject()
  object!: Record<string, unknown>;
}
