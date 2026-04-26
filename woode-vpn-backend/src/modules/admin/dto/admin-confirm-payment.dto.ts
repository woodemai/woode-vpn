import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class AdminConfirmPaymentDto {
  @ApiProperty({
    description: 'User id as string (digits only)',
    example: '123',
  })
  @IsString()
  @Matches(/^\d+$/, { message: 'userId must contain only digits' })
  userId!: string;

  @ApiPropertyOptional({ description: 'Subscription duration in days', example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;

  @ApiPropertyOptional({ description: 'Subscription duration in months', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;

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
