import { Transform } from 'class-transformer';
import {
    IsInt,
    IsOptional,
    IsString,
    IsUrl,
    Max,
    MaxLength,
    Min,
} from 'class-validator';

export class UpdateSubscriptionConfigDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2048)
    @IsUrl({ require_tld: true }, { message: 'supportUrl must be a valid URL' })
    @Transform(({ value }) => {
        if (value === null || value === '') {
            return null;
        }

        return typeof value === 'string' ? value.trim() : value;
    })
    supportUrl?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(2048)
    @IsUrl({ require_tld: true }, { message: 'profileUrl must be a valid URL' })
    @Transform(({ value }) => {
        if (value === null || value === '') {
            return null;
        }

        return typeof value === 'string' ? value.trim() : value;
    })
    profileUrl?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    announce?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(168)
    updateIntervalHours?: number;
}
