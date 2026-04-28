import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
    @ApiPropertyOptional({
        description: 'Telegram display name for the user',
        example: 'john_doe_updated',
        maxLength: 128,
    })
    @IsOptional()
    @IsString()
    telegramName?: string;
}
