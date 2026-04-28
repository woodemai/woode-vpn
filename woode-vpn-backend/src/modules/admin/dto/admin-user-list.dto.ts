import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AdminUserListDto {
    @ApiPropertyOptional({
        description: 'Page number for pagination (1-based)',
        example: 1,
        minimum: 1,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @ApiPropertyOptional({
        description: 'Number of items per page',
        example: 25,
        minimum: 1,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    perPage?: number;

    @ApiPropertyOptional({
        description:
            'Search query by telegram name or external ID (case-insensitive)',
        example: 'user123',
    })
    @IsOptional()
    @IsString()
    q?: string;
}
