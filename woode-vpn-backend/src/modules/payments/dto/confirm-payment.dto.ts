import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ConfirmPaymentDto {
  @ApiProperty({ description: 'Internal user id', example: 1 })
  @IsInt()
  @Min(1)
  userId!: number;

  @ApiPropertyOptional({ description: 'Subscription months', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;

  @ApiPropertyOptional({ description: 'Subscription days', example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;

  @ApiPropertyOptional({ description: 'Payment provider id', example: '317d715c-000f-5001-8000-1cabdbba208c' })
  @IsOptional()
  @IsString()
  paymentId?: string;

  @ApiPropertyOptional({ description: 'Amount in cents', example: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @ApiPropertyOptional({ description: 'Device limit', example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  deviceLimit?: number;

  @ApiPropertyOptional({ description: 'Preferred country code', example: 'NL' })
  @IsOptional()
  @IsString()
  country?: string;
}
