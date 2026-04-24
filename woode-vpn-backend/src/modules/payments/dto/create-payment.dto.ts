import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreatePaymentDto {
    @IsInt()
    @Min(1)
    userId!: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(24)
    months?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(3650)
    days?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(100)
    deviceLimit?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    amountCents?: number;

    @IsOptional()
    @IsString()
    returnUrl?: string;
}