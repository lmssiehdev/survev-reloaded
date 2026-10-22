# syntax=docker/dockerfile:1
#
# Images for docker-compose.yml (see HOSTING.md), one target each:
#   api   - API server (runs the database migrations, then the server)
#   game  - game server (forks one process per game)
#   web   - Caddy with the built client
#   bot   - Discord bot (optional)
#   base  - bun only, docker-compose.dev.yml mounts the source into it

# The repo targets Bun canary (package.json engines), which has no versioned image tag: pin the digest.
# Update: docker pull oven/bun:canary-slim && docker image inspect oven/bun:canary-slim --format '{{index .RepoDigests 0}}'
ARG BUN_IMAGE=oven/bun:canary-slim@sha256:3efab1f24f84fb4ea4c5ee0b6497d1663199204bccbfdb100a3e0725e6426fd3
ARG CADDY_IMAGE=caddy:2.11-alpine

FROM ${BUN_IMAGE} AS base
WORKDIR /app

# workspace manifests only, so dependency layers are cached until they change
FROM base AS manifests
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/game/package.json packages/game/
COPY packages/shared/package.json packages/shared/

FROM manifests AS deps
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM deps AS build
COPY . .
# docker/migrate.ts is bundled next to the server and reads the migrations from dist/drizzle
RUN cd apps/api \
    && bun ../../scripts/buildApp.ts src/index.ts ../../docker/migrate.ts \
    && cp -r src/db/drizzle dist/drizzle
RUN bun run build:game

# The client bakes regions, proxies and some secrets from the config in at build time.
# The config is bind-mounted (never stored in a layer), the build re-runs when it changes.
FROM deps AS client-build
ARG SURVEV_CONFIG=survev-config.hjson
COPY . .
RUN --mount=type=bind,source=${SURVEV_CONFIG},target=/app/survev-config.hjson \
    --mount=type=cache,target=/app/apps/client/node_modules/.atlas-cache \
    bun run build:client

# production dependencies of one app (isolated install: root node_modules/.bun + the app's links)
FROM manifests AS api-deps
# drizzle-kit (and its esbuild) come in as optional peers of better-auth, the bundle never loads them
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --filter @survev/api \
    && rm -rf node_modules/.bun/drizzle-kit@* node_modules/.bun/esbuild@* node_modules/.bun/@esbuild+*

FROM manifests AS game-deps
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --filter @survev/server

FROM manifests AS bot-deps
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --filter @survev/bot

# survev-config.hjson is mounted at /app/survev-config.hjson (the bundles look 3 levels up from apps/<app>/dist)
FROM base AS api
ENV NODE_ENV=production
COPY --from=api-deps /app/node_modules /app/node_modules
COPY --from=api-deps /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /app/apps/api/dist /app/apps/api/dist
WORKDIR /app/apps/api
USER bun
EXPOSE 8000
CMD ["sh", "-c", "bun dist/migrate.js && exec bun dist/index.js"]

FROM base AS game
ENV NODE_ENV=production
COPY --from=game-deps /app/node_modules /app/node_modules
COPY --from=game-deps /app/apps/server/node_modules /app/apps/server/node_modules
COPY --from=build /app/apps/server/dist /app/apps/server/dist
# games that couldn't be saved to the API are kept here and retried (a volume in compose)
RUN mkdir -p /app/apps/server/lost_game_data && chown bun:bun /app/apps/server/lost_game_data
# forks dist/gameProcess.js relative to the working directory
WORKDIR /app/apps/server
USER bun
EXPOSE 8001
CMD ["bun", "dist/gameServer.js"]

# runs from source; NODE_ENV stays unset so it finds the config at /app/survev-config.hjson
FROM base AS bot
COPY --from=bot-deps /app/node_modules /app/node_modules
COPY --from=bot-deps /app/apps/bot/node_modules /app/apps/bot/node_modules
COPY --from=bot-deps /app/packages /app/packages
COPY package.json /app/
COPY packages /app/packages
COPY apps/bot /app/apps/bot
COPY apps/api/package.json /app/apps/api/
WORKDIR /app/apps/bot
USER bun
CMD ["bun", "src/index.ts"]

FROM ${CADDY_IMAGE} AS web
COPY docker/caddy-run.sh /usr/local/bin/caddy-run.sh
COPY --from=client-build /app/apps/client/dist /srv
CMD ["/usr/local/bin/caddy-run.sh"]
