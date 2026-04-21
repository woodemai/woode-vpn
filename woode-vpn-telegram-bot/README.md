# woode-vpn-telegram-bot

Telegram bot on Node.js and Telegraf for woode-vpn-backend.

## Commands

- /start

After `/start`, bot shows inline menu buttons and main flow works through button clicks:

- Buy or extend subscription (30 / 90 / 180 / 365 days)
- Get config

The bot updates the same message for button actions.

## Backend endpoints used

- POST /api/users/register
- POST /api/payments/confirm
- GET /api/vpn/users/:userId/profile

## Quick start

1. Install dependencies:

pnpm install

2. Configure environment:

cp .env.example .env

3. Fill env values:

- TELEGRAM_BOT_TOKEN from BotFather
- BACKEND_BASE_URL such as http://localhost:3000 or your public backend URL

4. Run in development mode:

pnpm dev

5. Build production bundle:

pnpm build
