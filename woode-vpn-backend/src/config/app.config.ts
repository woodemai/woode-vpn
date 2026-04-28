import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: Number(process.env.PORT ?? 3000),
  publicBaseUrl: process.env.APP_PUBLIC_BASE_URL ?? 'http://localhost:3000',
  admin: {
    apiKey: process.env.ADMIN_API_KEY ?? '',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    logoPath: process.env.TELEGRAM_LOGO_PATH ?? '/app/logo.jpg',
  },
  subscription: {
    totalBytes: Number(process.env.SUBSCRIPTION_TOTAL_BYTES ?? 0),
    cacheTtlMinutes: Number(
      process.env.SUBSCRIPTION_CONFIG_CACHE_TTL_MINUTES ?? 10,
    ),
    refreshThrottleMinutes: Number(
      process.env.SUBSCRIPTION_REFRESH_THROTTLE_MINUTES ?? 10,
    ),
  },
}));
