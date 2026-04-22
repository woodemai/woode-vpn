import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  telegramName?: string;
}
