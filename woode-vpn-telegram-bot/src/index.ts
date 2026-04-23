import 'dotenv/config';
import { Context, Input, Markup, Telegraf } from 'telegraf';
import QRCode from 'qrcode';
import { BackendClient } from './backend.js';


const botToken = process.env.TELEGRAM_BOT_TOKEN;
const backendBaseUrl = process.env.BACKEND_BASE_URL;

if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

if (!backendBaseUrl) {
  throw new Error('BACKEND_BASE_URL is required');
}

const backendRequestTimeoutMs = Number(process.env.BACKEND_REQUEST_TIMEOUT_MS ?? '10000');
const handlerTimeoutMs = Number(process.env.TELEGRAM_HANDLER_TIMEOUT_MS ?? '30000');

const backend = new BackendClient({
  baseUrl: backendBaseUrl,
  requestTimeoutMs: Number.isFinite(backendRequestTimeoutMs) ? backendRequestTimeoutMs : 10000,
});
const bot = new Telegraf(botToken, {
  handlerTimeout: Number.isFinite(handlerTimeoutMs) ? handlerTimeoutMs : 30000,
});

const DAY_PLANS = [30, 90, 180, 365] as const;

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
  | `BUY_DAYS_${(typeof DAY_PLANS)[number]}`;

function buildHappAddUrl(subscriptionUrl: string): string {
  return `happ://add/${encodeURIComponent(subscriptionUrl)}`;
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

  rows.push([
    Markup.button.url('📰 Новости', 'https://t.me/woodenews'),
    Markup.button.url('🛟 Поддержка', 'https://t.me/woodemai'),
  ]);

  rows.push([Markup.button.callback('🔙 Назад к меню', 'MENU_MAIN')]);

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

async function buildSubscriptionCaption(subscriptionUrl: string): Promise<string> {
  return [
    '<b>WoodeVPN ✨</b>',
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

function buyMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('30 дней', 'BUY_DAYS_30')],
    [Markup.button.callback('90 дней', 'BUY_DAYS_90')],
    [Markup.button.callback('180 дней', 'BUY_DAYS_180')],
    [Markup.button.callback('365 дней', 'BUY_DAYS_365')],
    [Markup.button.callback('Назад к меню', 'MENU_MAIN')],
  ]);
}



async function renderMainMenu(ctx: Context, subscriptionUrl?: string): Promise<void> {
  if (!subscriptionUrl) {
    await renderMediaMessage(ctx, defaultCaption, {
      keyboard: mainMenuKeyboard(false),
    });
    return;
  }

  const subscriptionCaption = await buildSubscriptionCaption(subscriptionUrl);
  await renderMediaMessage(ctx, subscriptionCaption, {
    subscriptionUrl,
    keyboard: postActionKeyboard(),
  });
}


async function renderGotDemoSubscriptionMenu(ctx: Context, endsAt: Date, subscriptionUrl: string) {
  const caption = await buildSubscriptionCaption(subscriptionUrl);
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

  await renderMediaMessage(ctx, await buildSubscriptionCaption(profile.subscriptionUrl), {
    subscriptionUrl: profile.subscriptionUrl,
    keyboard: postActionKeyboard(),
  });
}



async function processBuyByDays(ctx: Context, days: number): Promise<void> {
  const userId = await registerAndGetUserId(ctx);
  const result = await backend.confirmPayment({
    userId,
    days,
  });

  const subscriptionCaption = await buildSubscriptionCaption(result.subscriptionUrl);
  const caption = [
    `Подписка активирована на ${days} дней.`,
    `Активна до: ${new Date(result.endsAt).toLocaleString('ru-RU')}`,
    '',
    subscriptionCaption,
  ].join('\n');

  await renderMediaMessage(ctx, caption, {
    subscriptionUrl: result.subscriptionUrl,
    keyboard: postActionKeyboard(),
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
    await renderMainMenu(ctx, profile.subscriptionUrl);
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
      await renderMainMenu(ctx, profile.subscriptionUrl);
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
      const result = await backend.confirmPayment({ userId, days: 90 });
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

      await processBuyByDays(ctx, days);
      return;
    }

    const userId = await registerAndGetUserId(ctx);
    const profile = await backend.getProfile(userId);
    await renderMainMenu(ctx, profile.subscriptionUrl);
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
