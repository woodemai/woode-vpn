import 'dotenv/config';
import { Context, Input, Markup, Telegraf } from 'telegraf';
import QRCode from 'qrcode';
import { BackendClient, CreatePaymentResponse, UserProfileResponse } from './backend.js';


const botToken = process.env.TELEGRAM_BOT_TOKEN;
const backendBaseUrl = process.env.BACKEND_BASE_URL;

if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

if (!backendBaseUrl) {
  throw new Error('BACKEND_BASE_URL is required');
}

const backendRequestTimeoutMs = 3000;
const handlerTimeoutMs = 30000;

const backend = new BackendClient({
  baseUrl: backendBaseUrl,
  requestTimeoutMs: Number.isFinite(backendRequestTimeoutMs) ? backendRequestTimeoutMs : 10000,
});
const bot = new Telegraf(botToken, {
  handlerTimeout: Number.isFinite(handlerTimeoutMs) ? handlerTimeoutMs : 30000,
});

const DAY_PLANS = [30, 90, 180, 365] as const;
const DEVICE_PLANS = [5, 10, 15] as const;

const PRICE_BY_PLAN: Record<(typeof DAY_PLANS)[number], Record<(typeof DEVICE_PLANS)[number], number>> = {
  30: { 5: 100, 10: 150, 15: 200 },
  90: { 5: 270, 10: 400, 15: 540 },
  180: { 5: 510, 10: 760, 15: 1000 },
  365: { 5: 1000, 10: 1450, 15: 2000 },
};

const defaultCaption = [
  '<b>WoodeVPN ✨</b> — быстрый и надежный доступ в интернет! ✅',
  '',
  'Возможности:',
  '<blockquote>🚀 Высокая скорость',
  '🔄 Надежность',
  '💬 Быстрая поддержка',
  '📱💻 Доступно на всех устройствах</blockquote>'].join('\n');

type CallbackData =
  | 'MENU_MAIN'
  | 'MENU_BUY'
  | 'TRIAL'
  | 'ACTION_CONFIG'
  | `BUY_DAYS_${(typeof DAY_PLANS)[number]}`
  | `BUY_DEVICES_${(typeof DAY_PLANS)[number]}_${(typeof DEVICE_PLANS)[number]}`;

function buildHappAddUrl(subscriptionUrl: string): string {
  return `happ://add/${encodeURIComponent(subscriptionUrl)}`;
}

function formatMoscowDate(endsAt: string | Date): string {
  const date = endsAt instanceof Date ? endsAt : new Date(endsAt);
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);

  return `${formatted.replace(',', '')} (МСК)`;
}

function formatRemainingTime(endsAt: string | Date): string {
  const endTs = endsAt instanceof Date ? endsAt.getTime() : new Date(endsAt).getTime();
  const nowTs = Date.now();
  const diffMs = Math.max(0, endTs - nowTs);

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  return `${days} дн ${hours} ч ${minutes} мин`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatBytes(bytes: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let value = Math.max(0, bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 100 || unitIndex === 0
    ? Math.round(value).toString()
    : value.toFixed(1);

  return `${rounded} ${units[unitIndex]}`;
}

function buildSubscriptionInfoBlock(profile?: UserProfileResponse): string {
  const profileName = profile?.profileName?.trim() || 'не указано';

  const devicesConnected =
    typeof profile?.devicesConnected === 'number' ? profile.devicesConnected : 0;
  const devicesMax =
    typeof profile?.devicesMax === 'number' ? profile.devicesMax : 0;

  const trafficUsedBytes =
    typeof profile?.trafficUsedBytes === 'number' ? profile.trafficUsedBytes : 0;

  const trafficLine =
    typeof profile?.trafficTotalBytes === 'number' && profile.trafficTotalBytes > 0
      ? `${formatBytes(trafficUsedBytes)}/${formatBytes(profile.trafficTotalBytes)}`
      : `${formatBytes(trafficUsedBytes)}/∞`;

  const infoLines = [
    `👤 <b>Профиль:</b> ${escapeHtml(profileName)}`,
    profile?.endsAt
      ? `📅 <b>Дата окончания:</b> ${formatMoscowDate(profile.endsAt)}`
      : '📅 <b>Дата окончания:</b> —',
    profile?.endsAt
      ? `⏳ <b>Осталось времени:</b> ${formatRemainingTime(profile.endsAt)}`
      : '⏳ <b>Осталось времени:</b> —',
    `📱 <b>Устройства:</b> ${devicesConnected}/${devicesMax}`,
    `📊 <b>Трафик:</b> ${trafficLine}`,
  ];

  return `<blockquote>${infoLines.join('\n')}</blockquote>`;
}

async function renderMediaMessage(
  ctx: Context,
  caption: string,
  options: {
    subscriptionUrl?: string;
    keyboard: ReturnType<typeof Markup.inlineKeyboard>;
  },
): Promise<void> {
  const media = options.subscriptionUrl
    ? Input.fromBuffer(
      await QRCode.toBuffer(buildHappAddUrl(options.subscriptionUrl), {
        type: 'png',
        margin: 2,
        width: 700,
        errorCorrectionLevel: 'M',
      }),
      'subscription-qr.png',
    )
    : Input.fromLocalFile('./logo.jpg');

  if ('callbackQuery' in ctx.update) {
    try {
      await ctx.editMessageMedia(
        {
          type: 'photo',
          media,
          caption,
          parse_mode: 'HTML',
        },
        options.keyboard,
      );
      return;
    } catch {
      await ctx.deleteMessage().catch(() => undefined);
    }
  }

  await ctx.replyWithPhoto(media, {
    caption,
    parse_mode: 'HTML',
    reply_markup: options.keyboard.reply_markup,
  });
}

function postActionKeyboard() {
  const rows = [] as ReturnType<typeof Markup.inlineKeyboard>['reply_markup']['inline_keyboard'];

  rows.push([Markup.button.callback('🔄 Продлить подписку', 'MENU_BUY')]);
  rows.push([
    Markup.button.url('📰 Новости', 'https://t.me/woodenews'),
    Markup.button.url('🛟 Поддержка', 'https://t.me/woodemai'),
  ]);

  return Markup.inlineKeyboard(rows);
}

function mainMenuKeyboard(hasSubscription: boolean) {
  const subscriptionButton = hasSubscription
    ? Markup.button.callback('💳 Купить/Продлить подписку', 'MENU_BUY')
    : Markup.button.callback('🎁 Пробная подписка на 2 дня', 'TRIAL');

  return Markup.inlineKeyboard([
    [subscriptionButton],
    [Markup.button.callback('⚙️ Моя подписка', 'ACTION_CONFIG')],
    [
      Markup.button.url('📰 Новости', 'https://t.me/woodenews'),
      Markup.button.url('🛟 Поддержка', 'https://t.me/woodemai'),
    ],
  ]);
}

async function buildSubscriptionCaption(
  subscriptionUrl: string,
  profile?: UserProfileResponse,
): Promise<string> {
  return [
    '<b>WoodeVPN ✨</b>',
    '',
    buildSubscriptionInfoBlock(profile),
    '',
    '✅ У вас активна подписка!',
    '',
    '<b>📲 Как подключить подписку в Happ</b>',
    '',
    '1️⃣ Откройте приложение Happ',
    '2️⃣ Нажмите «Добавить подписку»',
    '3️⃣ Выберите «Добавить по QR коду» (выше на экране)',
    '',
    '<b>🔗 Ссылка подписки:</b>',
    `<code>${subscriptionUrl}</code>`,
  ].join('\n');
}

function buildBuyCaption(): string {
  return [
    '<b>Выберите продолжительность подписки:</b>',
    '',
    '30, 90, 180 или 365 дней.',
  ].join('\n');
}

function buildPaymentCaption(plan: CreatePaymentResponse): string {
  const priceRub = (plan.amountCents / 100).toFixed(0);

  return [
    '<b>WoodeVPN ✨</b>',
    '',
    `Вы выбрали пополнение на ${priceRub} ₽`,
    '',
    `Период: ${plan.days} дней`,
    `Устройств: ${plan.deviceLimit}`,
  ].join('\n');
}

function buyMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('30 дней', 'BUY_DAYS_30')],
    [Markup.button.callback('90 дней', 'BUY_DAYS_90')],
    [Markup.button.callback('180 дней', 'BUY_DAYS_180')],
    [Markup.button.callback('365 дней', 'BUY_DAYS_365')],
    [Markup.button.callback('Назад к меню', 'MENU_MAIN')],
  ]);
}

function deviceMenuKeyboard(days: (typeof DAY_PLANS)[number]) {
  const dayPrices = PRICE_BY_PLAN[days];

  return Markup.inlineKeyboard([
    [Markup.button.callback(`5 устройств - ${dayPrices[5]} ₽`, `BUY_DEVICES_${days}_5`)],
    [Markup.button.callback(`10 устройств - ${dayPrices[10]} ₽`, `BUY_DEVICES_${days}_10`)],
    [Markup.button.callback(`15 устройств - ${dayPrices[15]} ₽`, `BUY_DEVICES_${days}_15`)],
    [Markup.button.callback('Назад к периодам', 'MENU_BUY')],
    [Markup.button.callback('Назад к меню', 'MENU_MAIN')],
  ]);
}

function paymentKeyboard(days: (typeof DAY_PLANS)[number], paymentUrl: string) {
  return Markup.inlineKeyboard([
    [Markup.button.url('💳 Пополнить', paymentUrl)],
    [Markup.button.callback('⬅️ Назад', `BUY_DAYS_${days}`)],
  ]);
}

function buildDeviceCaption(days: (typeof DAY_PLANS)[number]): string {
  const dayPrices = PRICE_BY_PLAN[days];

  return [
    `<b>Выберите количество устройств на ${days} дней:</b>`,
    '',
    `5 устройств - ${dayPrices[5]} ₽`,
    `10 устройств - ${dayPrices[10]} ₽`,
    `15 устройств - ${dayPrices[15]} ₽`,
  ].join('\n');
}

function resolvePlanPrice(
  days: (typeof DAY_PLANS)[number],
  devices: (typeof DEVICE_PLANS)[number],
): number {
  return PRICE_BY_PLAN[days][devices];
}



async function renderMainMenu(
  ctx: Context,
  profile?: UserProfileResponse,
): Promise<void> {
  const subscriptionUrl = profile?.subscriptionUrl;

  if (!subscriptionUrl) {
    await renderMediaMessage(ctx, defaultCaption, {
      keyboard: mainMenuKeyboard(false),
    });
    return;
  }

  const subscriptionCaption = await buildSubscriptionCaption(subscriptionUrl, profile);
  await renderMediaMessage(ctx, subscriptionCaption, {
    subscriptionUrl,
    keyboard: postActionKeyboard(),
  });
}


async function renderGotDemoSubscriptionMenu(ctx: Context, endsAt: Date, subscriptionUrl: string) {
  const caption = await buildSubscriptionCaption(subscriptionUrl, {
    hasActiveSubscription: true,
    subscriptionUrl,
    endsAt: endsAt.toISOString(),
  });
  const captionWithExpiry = [
    `Активна до: ${endsAt.toLocaleString('ru-RU')}`,
    '',
    caption,
  ].join('\n');

  await renderMediaMessage(ctx, captionWithExpiry, {
    subscriptionUrl,
    keyboard: postActionKeyboard(),
  });
}

async function renderBuyMenu(ctx: Context, subscriptionUrl?: string): Promise<void> {
  await renderMediaMessage(ctx, buildBuyCaption(), {
    subscriptionUrl,
    keyboard: buyMenuKeyboard(),
  });
}

async function renderDeviceMenu(
  ctx: Context,
  days: (typeof DAY_PLANS)[number],
  subscriptionUrl?: string,
): Promise<void> {
  await renderMediaMessage(ctx, buildDeviceCaption(days), {
    subscriptionUrl,
    keyboard: deviceMenuKeyboard(days),
  });
}

async function registerAndGetUserId(ctx: Context): Promise<number> {
  const tgUserId = ctx.from?.id;
  if (!tgUserId) {
    throw new Error('Не удалось определить ваш ID пользователя Telegram.');
  }

  const telegramName = [ctx.from?.first_name, ctx.from?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim() || ctx.from?.username || `user-${tgUserId}`;

  const user = await backend.registerUser({
    telegramUserId: tgUserId,
    telegramName,
  });
  return user.userId;
}

async function renderConfig(ctx: Context): Promise<void> {
  const userId = await registerAndGetUserId(ctx);
  const profile = await backend.getProfile(userId);

  if (!profile.hasActiveSubscription || !profile.subscriptionUrl) {
    await renderMediaMessage(ctx, 'Активная подписка не найдена. Сначала выберите план.', {
      keyboard: mainMenuKeyboard(false),
    });
    return;
  }

  await renderMediaMessage(ctx, await buildSubscriptionCaption(profile.subscriptionUrl, profile), {
    subscriptionUrl: profile.subscriptionUrl,
    keyboard: postActionKeyboard(),
  });
}



async function processBuyByPlan(
  ctx: Context,
  days: (typeof DAY_PLANS)[number],
  devices: (typeof DEVICE_PLANS)[number],
): Promise<void> {
  const userId = await registerAndGetUserId(ctx);
  const priceRub = resolvePlanPrice(days, devices);
  const result = await backend.createPayment({
    userId,
    days,
    deviceLimit: devices,
    amountCents: priceRub * 100,
  });

  await renderMediaMessage(ctx, buildPaymentCaption(result), {
    keyboard: paymentKeyboard(days, result.paymentUrl),
  });
}

async function safeHandleCallback(ctx: Context, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Bot handler error:', message);

    const fallbackText = '⚠️ Что-то пошло не так. Попробуйте еще раз.';

    if ('callbackQuery' in ctx.update) {
      let hasSubscription = false;
      let subscriptionUrl: string | undefined;

      try {
        const userId = await registerAndGetUserId(ctx);
        const profile = await backend.getProfile(userId);
        hasSubscription = profile.hasActiveSubscription;
        subscriptionUrl = profile.subscriptionUrl;
      } catch {
        hasSubscription = false;
      }

      await renderMediaMessage(
        ctx,
        `${fallbackText}\n\n${defaultCaption}`,
        {
          subscriptionUrl,
          keyboard: mainMenuKeyboard(hasSubscription),
        },
      );
      return;
    }

    await renderMediaMessage(ctx, `${fallbackText}\n\n${defaultCaption}`, {
      keyboard: mainMenuKeyboard(false),
    });
  }
}

bot.start(async (ctx) => {
  await safeHandleCallback(ctx, async () => {
    const userId = await registerAndGetUserId(ctx);
    const profile = await backend.getProfile(userId);
    await renderMainMenu(ctx, profile);
  });
});

bot.on('callback_query', async (ctx) => {
  const data = 'data' in ctx.callbackQuery ? (ctx.callbackQuery.data as CallbackData) : undefined;

  if (!data) {
    await ctx.answerCbQuery();
    return;
  }

  await ctx.answerCbQuery();

  await safeHandleCallback(ctx, async () => {
    if (data === 'MENU_MAIN') {
      const userId = await registerAndGetUserId(ctx);
      const profile = await backend.getProfile(userId);
      await renderMainMenu(ctx, profile);
      return;
    }

    if (data === 'MENU_BUY') {
      const userId = await registerAndGetUserId(ctx);
      const profile = await backend.getProfile(userId);
      await renderBuyMenu(ctx, profile.subscriptionUrl);
      return;
    }

    if (data === 'TRIAL') {
      const userId = await registerAndGetUserId(ctx);
      const result = await backend.confirmPayment({
        userId,
        days: 2,
        deviceLimit: 5,
        amountCents: 0,
      });
      await renderGotDemoSubscriptionMenu(ctx, new Date(result.endsAt), result.subscriptionUrl);
      return;
    }

    if (data === 'ACTION_CONFIG') {
      await renderConfig(ctx);
      return;
    }

    if (data.startsWith('BUY_DAYS_')) {
      const days = Number(data.replace('BUY_DAYS_', ''));
      if (!DAY_PLANS.includes(days as (typeof DAY_PLANS)[number])) {
        throw new Error('Выбран неправильный план');
      }

      const userId = await registerAndGetUserId(ctx);
      const profile = await backend.getProfile(userId);
      await renderDeviceMenu(ctx, days as (typeof DAY_PLANS)[number], profile.subscriptionUrl);
      return;
    }

    if (data.startsWith('BUY_DEVICES_')) {
      const match = data.match(/^BUY_DEVICES_(\d+)_(\d+)$/);
      if (!match) {
        throw new Error('Выбран неправильный план устройств');
      }

      const days = Number(match[1]);
      const devices = Number(match[2]);
      if (!DAY_PLANS.includes(days as (typeof DAY_PLANS)[number])) {
        throw new Error('Выбран неправильный период');
      }
      if (!DEVICE_PLANS.includes(devices as (typeof DEVICE_PLANS)[number])) {
        throw new Error('Выбрано неправильное количество устройств');
      }

      await processBuyByPlan(
        ctx,
        days as (typeof DAY_PLANS)[number],
        devices as (typeof DEVICE_PLANS)[number],
      );
      return;
    }

    const userId = await registerAndGetUserId(ctx);
    const profile = await backend.getProfile(userId);
    await renderMainMenu(ctx, profile);
  });
});


bot.catch((err, ctx) => {
  const updateType = ctx.updateType || 'unknown';
  console.error(`Telegraf error on ${updateType}:`, err);
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('Telegram bot started');
