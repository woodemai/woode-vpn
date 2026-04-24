import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramNotifierService {
    private readonly logger = new Logger(TelegramNotifierService.name);

    constructor(private readonly configService: ConfigService) { }

    async sendToChat(
        chatId: string,
        text: string,
        options?: { parseMode?: 'HTML'; disableWebPagePreview?: boolean },
    ): Promise<void> {
        const notificationsEnabled =
            this.configService.get<boolean>('app.telegram.notificationsEnabled') ?? false;
        if (!notificationsEnabled) {
            return;
        }

        const botToken = this.configService.get<string>('app.telegram.botToken') ?? '';
        if (!botToken) {
            this.logger.warn('Telegram notification skipped: TELEGRAM_BOT_TOKEN is not set');
            return;
        }

        try {
            const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    text,
                    parse_mode: options?.parseMode,
                    disable_web_page_preview: options?.disableWebPagePreview ?? true,
                }),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                this.logger.warn(
                    `Telegram notification failed: status=${response.status}, chatId=${chatId}, body=${errorBody}`,
                );
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            this.logger.warn(`Telegram notification request failed: chatId=${chatId}, error=${message}`);
        }
    }
}
