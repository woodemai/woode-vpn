import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({ description: 'Internal user id', example: 1 })
  @IsInt()
  @Min(1)
  userId!: number;

  @ApiPropertyOptional({ description: 'Subscription days', example: 30 })
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

  @ApiPropertyOptional({ description: 'Amount in cents', example: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @ApiPropertyOptional({
    description: 'Return URL after payment',
    example: 'https://t.me/woodevpn_bot',
  })
  @IsOptional()
  @IsString()
  returnUrl?: string;
}
