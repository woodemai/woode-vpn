import { IsObject, IsString } from 'class-validator';

export class YooKassaWebhookDto {
  @IsString()
  type!: string;

  @IsString()
  event!: string;

  @IsObject()
  object!: Record<string, unknown>;
}
