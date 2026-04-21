import 'dotenv/config';
import { Context, Markup, Telegraf } from 'telegraf';
import { BackendClient } from './backend.js';

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const backendBaseUrl = process.env.BACKEND_BASE_URL;

if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

if (!backendBaseUrl) {
  throw new Error('BACKEND_BASE_URL is required');
}

const backend = new BackendClient({ baseUrl: backendBaseUrl });
const bot = new Telegraf(botToken);

const DAY_PLANS = [30, 90, 180, 365] as const;

type CallbackData =
  | 'MENU_MAIN'
  | 'MENU_BUY'
  | 'ACTION_CONFIG'
  | `BUY_DAYS_${(typeof DAY_PLANS)[number]}`;

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Buy or extend', 'MENU_BUY')],
    [Markup.button.callback('Get config', 'ACTION_CONFIG')],
  ]);
}

function buyMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('30 days', 'BUY_DAYS_30')],
    [Markup.button.callback('90 days', 'BUY_DAYS_90')],
    [Markup.button.callback('180 days', 'BUY_DAYS_180')],
    [Markup.button.callback('365 days', 'BUY_DAYS_365')],
    [Markup.button.callback('Back', 'MENU_MAIN')],
  ]);
}

function postActionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Get config', 'ACTION_CONFIG')],
    [Markup.button.callback('Buy more', 'MENU_BUY')],
    [Markup.button.callback('Main menu', 'MENU_MAIN')],
  ]);
}

async function renderMainMenu(ctx: Context): Promise<void> {
  const message = [
    'VPN bot menu',
    '',
    '- Buy subscription for 30/90/180/365 days',
    '- Subscription includes all configured countries and available inbounds',
    '- Get subscription URL',
  ].join('\n');

  if ('callbackQuery' in ctx.update) {
    await ctx.editMessageText(message, mainMenuKeyboard());
    return;
  }

  await ctx.reply(message, mainMenuKeyboard());
}

async function renderBuyMenu(ctx: Context): Promise<void> {
  const message = [
    'Choose subscription duration:',
    '30, 90, 180 or 365 days.',
  ].join('\n');

  await ctx.editMessageText(message, buyMenuKeyboard());
}

async function registerAndGetUserId(ctx: Context): Promise<number> {
  const tgUserId = ctx.from?.id;
  if (!tgUserId) {
    throw new Error('Cannot detect your Telegram user id.');
  }

  const user = await backend.registerUser(tgUserId);
  return user.userId;
}

async function renderConfig(ctx: Context): Promise<void> {
  const userId = await registerAndGetUserId(ctx);
  const profile = await backend.getProfile(userId);

  if (!profile.hasActiveSubscription || !profile.subscriptionUrl) {
    await ctx.editMessageText('No active subscription found. Choose a plan first.', postActionKeyboard());
    return;
  }

  await ctx.editMessageText(`Your subscription URL:\n${profile.subscriptionUrl}`, postActionKeyboard());
}

async function processBuyByDays(ctx: Context, days: number): Promise<void> {
  const userId = await registerAndGetUserId(ctx);
  const result = await backend.confirmPayment({
    userId,
    days,
  });

  await ctx.editMessageText(
    [
      `Subscription activated for ${days} days.`,
      `Active until: ${new Date(result.endsAt).toLocaleString()}`,
      `Subscription URL: ${result.subscriptionUrl}`,
      '',
      'Includes all configured countries and available inbounds.',
    ].join('\n'),
    postActionKeyboard(),
  );
}

async function safeHandleCallback(ctx: Context, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if ('callbackQuery' in ctx.update) {
      await ctx.editMessageText(`Error: ${message}`, postActionKeyboard());
      return;
    }
    await ctx.reply(`Error: ${message}`);
  }
}

bot.start(async (ctx) => {
  await safeHandleCallback(ctx, async () => {
    await registerAndGetUserId(ctx);
    await renderMainMenu(ctx);
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
      await renderMainMenu(ctx);
      return;
    }

    if (data === 'MENU_BUY') {
      await renderBuyMenu(ctx);
      return;
    }

    if (data === 'ACTION_CONFIG') {
      await renderConfig(ctx);
      return;
    }

    if (data.startsWith('BUY_DAYS_')) {
      const days = Number(data.replace('BUY_DAYS_', ''));
      if (!DAY_PLANS.includes(days as (typeof DAY_PLANS)[number])) {
        throw new Error('Invalid plan selected');
      }

      await processBuyByDays(ctx, days);
      return;
    }

    await renderMainMenu(ctx);
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
      await ctx.reply('No active subscription found. Use /start and choose a plan.');
      return;
    }
    await ctx.reply(`Your subscription URL:\n${profile.subscriptionUrl}`);
  });
});

bot.command('config', async (ctx) => {
  await safeHandleCallback(ctx, async () => {
    const userId = await registerAndGetUserId(ctx);
    const profile = await backend.getProfile(userId);
    if (!profile.hasActiveSubscription || !profile.subscriptionUrl) {
      await ctx.reply('No active subscription found. Use /start and choose a plan.');
      return;
    }
    await ctx.reply(`Your subscription URL:\n${profile.subscriptionUrl}`);
  });
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('Telegram bot is running');
