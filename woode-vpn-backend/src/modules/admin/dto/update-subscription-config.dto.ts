import { ApiPropertyOptional } from '@nestjs/swagger';
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
    @ApiPropertyOptional({ description: 'Subscription title', example: 'Woode VPN' })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    title?: string;

    @ApiPropertyOptional({
        description: 'Support URL',
        example: 'https://t.me/woodemai',
        nullable: true,
    })
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

    @ApiPropertyOptional({
        description: 'Profile page URL',
        example: 'https://example.com/profile',
        nullable: true,
    })
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

    @ApiPropertyOptional({ description: 'Announcement text', example: 'Maintenance at night' })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    announce?: string;

    @ApiPropertyOptional({ description: 'Profile update interval in hours', example: 12 })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(168)
    updateIntervalHours?: number;
}
