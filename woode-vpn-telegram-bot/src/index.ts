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

type CallbackData =
  | 'MENU_MAIN'
  | 'MENU_BUY'
  | 'TRIAL'
  | 'ACTION_CONFIG'
  | 'ACTION_HAPP'
  | 'ACTION_HAPP_HELP'
  | 'ACTION_QR'
  | `BUY_DAYS_${(typeof DAY_PLANS)[number]}`;

function buildHappAddUrl(subscriptionUrl: string): string {
  return `happ://add/${encodeURIComponent(subscriptionUrl)}`;
}

function buildSubscriptionLinkText(subscriptionUrl: string): string {
  return `Ваша ссылка на подписку:\n<code>${subscriptionUrl}</code>`;
}

function buildHappLinkText(subscriptionUrl: string): string {
  return `Ссылка для Happ:\n<code>${buildHappAddUrl(subscriptionUrl)}</code>`;
}

function buildHappInstructionsText(subscriptionUrl: string): string {
  return [
    '<b>📲 Как подключить подписку в Happ</b>',
    '',
    '1️⃣ Скопируйте ссылку ниже',
    '2️⃣ Вставьте в Happ вручную через',
    '   • Добавить подписку',
    '   • Вставить из буфера обмена',
    '3️⃣ Для быстрого входа можно использовать кнопку <b>QR Код</b>.',
    '',
    '<b>🔗 Ссылка подписки:</b>',
    `<code>${subscriptionUrl}</code>`,
  ].join('\n');
}

async function editCurrentMessage(
  ctx: Context,
  text: string,
  options?: {
    subscriptionUrl?: string;
    parseMode?: 'HTML' | 'MarkdownV2';
    keyboard?: ReturnType<typeof Markup.inlineKeyboard>;
  },
): Promise<void> {
  const parseMode = options?.parseMode ?? 'HTML';
  const replyMarkup = options?.keyboard ?? postActionKeyboard(options?.subscriptionUrl);

  try {
    await ctx.editMessageText(text, { parse_mode: parseMode, ...replyMarkup });
    return;
  } catch {
    // If the current message is media, fallback to caption edit.
    await ctx.editMessageCaption(text, { parse_mode: parseMode, ...replyMarkup });
  }
}

function postActionKeyboard(subscriptionUrl?: string) {
  const rows = [] as ReturnType<typeof Markup.inlineKeyboard>['reply_markup']['inline_keyboard'];

  if (subscriptionUrl) {
    rows.push([Markup.button.callback('❔ подключить в Happ', 'ACTION_HAPP_HELP')]);
    rows.push([Markup.button.callback('🔲 QR Код', 'ACTION_QR')]);
  }

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
  ]);
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



async function renderMainMenu(ctx: Context, hasSubscription: boolean = false): Promise<void> {
  const message =

    ['<b>WoodeVPN ✨</b> — быстрый и надежный доступ в интернет! ✅',
      '',
      'Возможности:',

      '<blockquote>🚀 Высокая скорость',
      '🔄 Надежность',
      '💬 Быстрая поддержка',
      '📱💻 Доступно на всех устройствах</blockquote>'].join('\n')


  await editCurrentMessage(ctx, message, { parseMode: 'HTML', keyboard: mainMenuKeyboard(hasSubscription) });
}


async function renderGotDemoSubscriptionMenu(ctx: Context, endsAt: Date, subscriptionUrl: string) {
  const message = [
    '<b>WoodeVPN ✨</b> - быстрый и надеждный доступ в интернет! ✅',
    '',
    'Вам выдана пробная подписка!',
    `Активна до: ${endsAt.toLocaleString()}`,
    'Ваша ссылка на подписку',
    `<code>${subscriptionUrl}</code>`,
    '',
    'Возможности:',
    '<blockquote>🚀 Высокая скорость',
    '🔄 Надежность',
    '💬 Быстрая поддержка',
    '📱💻 Доступно на всех устройствах</blockquote>'
  ].join('\n');

  if ('callbackQuery' in ctx.update) {
    await editCurrentMessage(ctx, message, {
      subscriptionUrl,
      parseMode: 'HTML',
      keyboard: postActionKeyboard(subscriptionUrl),
    });
    return;
  }

  await ctx.reply(message, { parse_mode: 'HTML', ...postActionKeyboard(subscriptionUrl) });
}

async function renderBuyMenu(ctx: Context): Promise<void> {
  const message = [
    'Выберите продолжительность подписки:',
    '30, 90, 180 или 365 дней.',
  ].join('\n');

  await ctx.editMessageText(message, buyMenuKeyboard());
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
    await editCurrentMessage(
      ctx,
      'Активная подписка не найдена. Сначала выберите план.',
    );
    return;
  }

  await editCurrentMessage(
    ctx,
    buildSubscriptionLinkText(profile.subscriptionUrl),
    { subscriptionUrl: profile.subscriptionUrl },
  );
}

async function renderSubscriptionQrCode(ctx: Context): Promise<void> {
  const userId = await registerAndGetUserId(ctx);
  const profile = await backend.getProfile(userId);

  if (!profile.hasActiveSubscription || !profile.subscriptionUrl) {
    await editCurrentMessage(ctx, 'Активная подписка не найдена. Сначала выберите план.', {
      keyboard: postActionKeyboard(),
    });
    return;
  }

  const happUrl = buildHappAddUrl(profile.subscriptionUrl);
  const qrBuffer = await QRCode.toBuffer(happUrl, {
    type: 'png',
    margin: 2,
    width: 700,
    errorCorrectionLevel: 'M',
  });

  const caption = [
    'QR для добавления подписки в клиент.',
    '',
    'Ваша ссылка на подписку:',
    `<code>${profile.subscriptionUrl}</code>`,
  ].join('\n');

  try {
    await ctx.editMessageMedia(
      {
        type: 'photo',
        media: Input.fromBuffer(qrBuffer, 'subscription-qr.png'),
        caption,
        parse_mode: 'HTML',
      },
      postActionKeyboard(profile.subscriptionUrl),
    );
  } catch {
    // Some Telegram messages cannot be converted to media; replace visually with one photo message.
    await ctx.deleteMessage().catch(() => undefined);
    await ctx.replyWithPhoto(Input.fromBuffer(qrBuffer, 'subscription-qr.png'), {
      caption,
      ...postActionKeyboard(profile.subscriptionUrl),
    });
  }
}

async function sendHappDeepLink(ctx: Context): Promise<void> {
  const userId = await registerAndGetUserId(ctx);
  const profile = await backend.getProfile(userId);

  if (!profile.hasActiveSubscription || !profile.subscriptionUrl) {
    await editCurrentMessage(ctx, 'Активная подписка не найдена. Сначала выберите план.', {
      keyboard: postActionKeyboard(),
    });
    return;
  }

  const happUrl = buildHappAddUrl(profile.subscriptionUrl);
  await editCurrentMessage(
    ctx,
    [buildSubscriptionLinkText(profile.subscriptionUrl), buildHappLinkText(profile.subscriptionUrl)].join('\n\n'),
    { subscriptionUrl: profile.subscriptionUrl },
  );
}

async function renderHappInstructions(ctx: Context): Promise<void> {
  const userId = await registerAndGetUserId(ctx);
  const profile = await backend.getProfile(userId);

  if (!profile.hasActiveSubscription || !profile.subscriptionUrl) {
    await editCurrentMessage(ctx, 'Активная подписка не найдена. Сначала выберите план.', {
      keyboard: postActionKeyboard(),
    });
    return;
  }

  await editCurrentMessage(ctx, buildHappInstructionsText(profile.subscriptionUrl), {
    subscriptionUrl: profile.subscriptionUrl,
    parseMode: 'HTML',
  });
}

async function processBuyByDays(ctx: Context, days: number): Promise<void> {
  const userId = await registerAndGetUserId(ctx);
  const result = await backend.confirmPayment({
    userId,
    days,
  });

  await ctx.editMessageText(
    [
      `Подписка активирована на ${days} дней.`,
      `Активна до: ${new Date(result.endsAt).toLocaleString('ru-RU')}`,
      `Ваша ссылка на подписку: <code>${result.subscriptionUrl}</code>`,
      '',
      'Включает все настроенные страны и доступные соединения.',
    ].join('\n'),
    { parse_mode: 'HTML', ...postActionKeyboard(result.subscriptionUrl) },
  );
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

      try {
        const userId = await registerAndGetUserId(ctx);
        const profile = await backend.getProfile(userId);
        hasSubscription = profile.hasActiveSubscription;
      } catch {
        hasSubscription = false;
      }

      await editCurrentMessage(
        ctx,
        `${fallbackText}\n\n<b>WoodeVPN ✨</b> — быстрый и надежный доступ в интернет! ✅`,
        { keyboard: mainMenuKeyboard(hasSubscription), parseMode: 'HTML' },
      );
      return;
    }

    await ctx.reply(fallbackText, mainMenuKeyboard(false));
  }
}

bot.start(async (ctx) => {
  await safeHandleCallback(ctx, async () => {
    const userId = await registerAndGetUserId(ctx);
    const profile = await backend.getProfile(userId);
    await renderMainMenu(ctx, profile.hasActiveSubscription);
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
      await renderMainMenu(ctx, profile.hasActiveSubscription);
      return;
    }

    if (data === 'MENU_BUY') {
      await renderBuyMenu(ctx);
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

    if (data === 'ACTION_HAPP') {
      await sendHappDeepLink(ctx);
      return;
    }

    if (data === 'ACTION_HAPP_HELP') {
      await renderHappInstructions(ctx);
      return;
    }

    if (data === 'ACTION_QR') {
      await renderSubscriptionQrCode(ctx);
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
    await renderMainMenu(ctx, profile.hasActiveSubscription);
  });
});

bot.command('buy', async (ctx) => {
  await safeHandleCallback(ctx, async () => {
    await registerAndGetUserId(ctx);
    await renderMainMenu(ctx);
  });
});

bot.command('get_config', async (ctx) => {
  await safeHandleCallback(ctx, async () => {
    const userId = await registerAndGetUserId(ctx);
    const profile = await backend.getProfile(userId);
    if (!profile.hasActiveSubscription || !profile.subscriptionUrl) {
      await ctx.reply('Активная подписка не найдена. Используйте /start и выберите план.');
      return;
    }
    await ctx.reply(
      `Ваша ссылка на подписку:\n<code>${profile.subscriptionUrl}</code>`,
      { parse_mode: 'HTML', ...postActionKeyboard(profile.subscriptionUrl) },
    );
  });
});

bot.command('config', async (ctx) => {
  await safeHandleCallback(ctx, async () => {
    const userId = await registerAndGetUserId(ctx);
    const profile = await backend.getProfile(userId);
    if (!profile.hasActiveSubscription || !profile.subscriptionUrl) {
      await ctx.reply('Активная подписка не найдена. Используйте /start и выберите план.');
      return;
    }
    await ctx.reply(
      `Ваша ссылка на подписку:\n<code>${profile.subscriptionUrl}</code>`,
      { parse_mode: 'HTML', ...postActionKeyboard(profile.subscriptionUrl) },
    );
  });
});

bot.catch((err, ctx) => {
  const updateType = ctx.updateType || 'unknown';
  console.error(`Telegraf error on ${updateType}:`, err);
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('Telegram bot is running');
