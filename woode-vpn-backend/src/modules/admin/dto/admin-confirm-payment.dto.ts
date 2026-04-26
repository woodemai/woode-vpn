import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class AdminConfirmPaymentDto {
  @ApiProperty({
    description: 'Internal user id',
    example: 123,
  })
  @IsInt()
  @Min(1)
  userId!: number;

  @ApiPropertyOptional({
    description: 'Subscription duration in days',
    example: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;

  @ApiPropertyOptional({ description: 'Device limit for plan', example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  deviceLimit?: number;

  @ApiProperty({
    description: 'Payment id for idempotent confirmation',
    example: '317d715c-000f-5001-8000-1cabdbba208c',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  paymentId!: string;

  @ApiPropertyOptional({ description: 'Amount in cents', example: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;
}
