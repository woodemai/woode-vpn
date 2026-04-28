FROM node:20-bullseye-slim AS base
WORKDIR /app

RUN corepack enable

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build

COPY package.json pnpm-lock.yaml ./

RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src

RUN pnpm prisma:generate
RUN pnpm build

RUN pnpm prune --prod

FROM node:20-bullseye-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN corepack enable

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

COPY src/logo.jpg ./logo.jpg
COPY docker/entrypoint.sh ./docker/entrypoint.sh

RUN chmod +x ./docker/entrypoint.sh

USER node

EXPOSE 3000

ENTRYPOINT ["./docker/entrypoint.sh"]