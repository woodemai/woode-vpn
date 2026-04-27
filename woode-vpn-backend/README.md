# Woode VPN Backend

NestJS backend for Telegram bot or web frontend where user:

- creates profile,
- pays subscription,
- receives one combined VLESS subscription URL built from multiple 3x-ui servers.

## Stack

- Node.js
- NestJS + TypeScript
- PostgreSQL
- Prisma ORM
- 3x-ui API integration (`/login`, `/inbounds/list`, `/inbounds/addClient`)

## Architecture

```text
src/
  config/
  db/
  modules/
    users/
    vpn/
    payments/
  services/
    xui.service.ts
    subscription.service.ts
```

## Environment

Copy `.env.example` to `.env` and set:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/woode_vpn?schema=public"
PORT=3000
APP_PUBLIC_BASE_URL="http://localhost:3000"
YOOKASSA_SHOP_ID="123456"
YOOKASSA_SECRET_KEY="live_xxx_or_test_xxx"
```

## Install and Run

```bash
pnpm install
pnpm prisma:generate
pnpm prisma:migrate:dev
pnpm start:dev
```

API base URL: `http://localhost:3000/api`

## Docker (Recommended for VPS)

This project can run fully through Docker Compose:

- PostgreSQL in a container
- NestJS app in a container
- Prisma migrations run automatically on app startup

There are 2 compose modes:

- `docker-compose.yml` - app + postgres, port `3000` exposed (good for local/dev server)
- `docker-compose.vps.yml` - app + postgres + Caddy with automatic HTTPS on `80/443` (recommended for VPS)

### 1. Prepare env file

```bash
cp .env.docker.example .env.docker
```

Fill real values in `.env.docker` (`YOOKASSA_*`, passwords).

### 2. Start services

```bash
docker compose up -d --build
```

or via npm scripts:

```bash
npm run docker:up
```

For VPS mode with automatic HTTPS:

```bash
npm run docker:vps:up
```

### 3. Check logs

```bash
docker compose logs -f app
```

For VPS mode:

```bash
npm run docker:vps:logs
```

### 4. Stop services

```bash
docker compose down
```

For VPS mode:

```bash
npm run docker:vps:down
```

### Notes for VPS

- In `docker-compose.vps.yml`, Caddy is already included and serves TLS automatically.
- Set `APP_DOMAIN` in `.env.docker` and point domain A-record to your VPS IP.
- Ensure firewall allows only `22`, `80`, `443` from outside.
- For local mode (`docker-compose.yml`), app is exposed on `3000` directly.
- Keep `.env.docker` only on VPS, never commit it.
- If you move to external managed PostgreSQL later, set `DATABASE_URL` directly and remove `postgres` service from compose.

## Frontend/Bot Flow

1. Register user

```http
POST /api/users/register
Content-Type: application/json

{
  "externalId": "tg_123456",
  "email": "user@example.com"
}
```

2. Confirm payment (webhook or bot callback)

```http
POST /api/payments/confirm
Content-Type: application/json

{
  "userId": 1,
  "months": 1,
  "paymentId": "inv_001",
  "amountCents": 990,
  "country": "DE"
}
```

Response includes:

- `subscriptionUrl` (single URL to give user)
- `subscriptionText` (raw merged VLESS lines)

  2.1 Real YooKassa webhook

Configure YooKassa notification URL:

```text
https://your-domain.com/api/payments/webhooks/yookassa
```

Backend verifies payment directly via YooKassa API (`/v3/payments/{id}`) using `YOOKASSA_SHOP_ID` and `YOOKASSA_SECRET_KEY`, then issues subscription.

Webhook expects `metadata` in payment object:

- `userId` (required)
- `months` (optional, default `1`)
- `country` (optional)

If YooKassa retries the same event, backend handles it idempotently by `paymentId` and does not create duplicate subscriptions.

3. Client app pulls merged subscription

```http
GET /api/vpn/subscriptions/:token
```

This endpoint returns plain text with multiple VLESS configs, one per provisioned node.

## Notes

- Payment module currently models successful payment confirmation endpoint. Integrate your payment provider webhook here.
- `country` in payment payload can be used to filter nodes. If omitted, backend can provision across all configured nodes.
- For load balancing, extend server selection in `VpnService` by custom strategy: random, by load, by country.
