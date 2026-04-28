FROM node:20-bullseye-slim AS base
WORKDIR /app

RUN corepack enable

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# =========================
FROM base AS deps

COPY package.json pnpm-lock.yaml ./

RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile

# =========================
FROM deps AS build

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src

RUN pnpm prisma:generate
RUN pnpm build

# =========================
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json pnpm-lock.yaml ./

# install ONLY prod deps here (без prune вообще)
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY src/logo.jpg ./logo.jpg
COPY docker/entrypoint.sh ./docker/entrypoint.sh

RUN chmod +x ./docker/entrypoint.sh

USER node

EXPOSE 3000

ENTRYPOINT ["./docker/entrypoint.sh"]