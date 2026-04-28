FROM node:20-bullseye-slim AS base
WORKDIR /app
RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile

FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN pnpm prisma:generate
RUN pnpm build

FROM base AS runner
WORKDIR /app

RUN groupadd --system appgroup && useradd --system --gid appgroup --create-home appuser

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appgroup /app/dist ./dist
COPY --from=build --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=build --chown=appuser:appgroup /app/src/logo.jpg ./logo.jpg
COPY --chown=appuser:appgroup package.json pnpm-lock.yaml ./
COPY --chown=appuser:appgroup docker/entrypoint.sh ./docker/entrypoint.sh

RUN chmod +x /app/docker/entrypoint.sh

USER appuser

EXPOSE 3000

ENTRYPOINT ["/app/docker/entrypoint.sh"]
