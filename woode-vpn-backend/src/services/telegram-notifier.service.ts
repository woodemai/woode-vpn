import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { basename } from 'path';

@Injectable()
export class TelegramNotifierService {
  private readonly logger = new Logger(TelegramNotifierService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendToChat(
    chatId: string,
    text: string,
    options?: { parseMode?: 'HTML'; disableWebPagePreview?: boolean, replyMarkup?: Record<string, unknown>   },
  ): Promise<boolean> {
    const notificationsEnabled =
      this.configService.get<boolean>('app.telegram.notificationsEnabled') ??
      false;
    if (!notificationsEnabled) {
      return false;
    }

    const botToken =
      this.configService.get<string>('app.telegram.botToken') ?? '';
    if (!botToken) {
      this.logger.warn(
        'Telegram notification skipped: TELEGRAM_BOT_TOKEN is not set',
      );
      return false;
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: options?.parseMode,
            disable_web_page_preview: options?.disableWebPagePreview ?? true,
            reply_markup: options?.replyMarkup,
          }),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.warn(
          `Telegram notification failed: status=${response.status}, chatId=${chatId}, body=${errorBody}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `Telegram notification request failed: chatId=${chatId}, error=${message}`,
      );
      return false;
    }
  }

  async sendPhotoToChat(
    chatId: string,
    photoPath: string,
    caption: string,
    options?: {
      parseMode?: 'HTML';
      replyMarkup?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const notificationsEnabled =
      this.configService.get<boolean>('app.telegram.notificationsEnabled') ??
      false;
    if (!notificationsEnabled) {
      return false;
    }

    const botToken =
      this.configService.get<string>('app.telegram.botToken') ?? '';
    if (!botToken) {
      this.logger.warn(
        'Telegram notification skipped: TELEGRAM_BOT_TOKEN is not set',
      );
      return false;
    }

    try {
      const fileBuffer = await readFile(photoPath);
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('caption', caption);
      formData.append('parse_mode', options?.parseMode ?? 'HTML');
      if (options?.replyMarkup) {
        formData.append('reply_markup', JSON.stringify(options.replyMarkup));
      }
      formData.append(
        'photo',
        new Blob([fileBuffer], { type: 'image/jpeg' }),
        basename(photoPath),
      );

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendPhoto`,
        {
          method: 'POST',
          body: formData,
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.warn(
          `Telegram photo notification failed: status=${response.status}, chatId=${chatId}, body=${errorBody}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `Telegram photo notification request failed: chatId=${chatId}, error=${message}`,
      );
      return false;
    }
  }
}
