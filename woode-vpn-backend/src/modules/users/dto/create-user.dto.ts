import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateUserDto {
  @ApiPropertyOptional({
    description: 'External user identifier from Telegram',
    example: '123456789',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalId?: string;

  @ApiPropertyOptional({
    description: 'Telegram display name',
    example: 'woodemai',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  telegramName?: string;
}
