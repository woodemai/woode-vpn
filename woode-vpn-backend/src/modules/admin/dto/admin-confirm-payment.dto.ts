import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class AdminConfirmPaymentDto {
  @IsString()
  @Matches(/^\d+$/, { message: 'userId must contain only digits' })
  userId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  deviceLimit?: number;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  paymentId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;
}
