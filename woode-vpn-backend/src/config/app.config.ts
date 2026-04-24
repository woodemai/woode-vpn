import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: Number(process.env.PORT ?? 3000),
  publicBaseUrl: process.env.APP_PUBLIC_BASE_URL ?? 'http://localhost:3000',
  telegram: {
    notificationsEnabled:
      String(process.env.TELEGRAM_NOTIFICATIONS_ENABLED ?? 'false').toLowerCase() ===
      'true',
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  },
  subscription: {
    title: process.env.SUBSCRIPTION_TITLE ?? 'Woode VPN',
    supportUrl: process.env.SUBSCRIPTION_SUPPORT_URL ?? '',
    profileUrl: process.env.SUBSCRIPTION_PROFILE_URL ?? '',
    announce: process.env.SUBSCRIPTION_ANNOUNCE ?? '',
    updateIntervalHours: Number(process.env.SUBSCRIPTION_UPDATE_INTERVAL_HOURS ?? 12),
    totalBytes: Number(process.env.SUBSCRIPTION_TOTAL_BYTES ?? 0),
    plainResponse:
      String(process.env.SUBSCRIPTION_PLAIN_RESPONSE ?? 'true').toLowerCase() ===
      'true',
    refreshFromXui:
      String(process.env.SUBSCRIPTION_REFRESH_FROM_XUI ?? 'true').toLowerCase() ===
      'true',
  },
}));
