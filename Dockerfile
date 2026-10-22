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
RUN bun run build:api
RUN bun run build:game
RUN bun run build:bot

# The client bakes regions, proxies and some secrets from the config in at build time.
# The config is bind-mounted (never stored in a layer), the build re-runs when it changes.
FROM deps AS client-build
ARG SURVEV_CONFIG=survev-config.hjson
COPY . .
RUN --mount=type=bind,source=${SURVEV_CONFIG},target=/app/survev-config.hjson \
    --mount=type=cache,target=/app/apps/client/node_modules/.atlas-cache \
    bun run build:client

# survev-config.hjson is mounted at /app/survev-config.hjson (the bundles look 3 levels up from apps/<app>/dist)
FROM base AS api
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist /app/apps/api/dist
WORKDIR /app/apps/api
USER bun
EXPOSE 8000
CMD ["sh", "-c", "bun dist/migrate.js && exec bun dist/index.js"]

FROM base AS game
ENV NODE_ENV=production
COPY --from=build /app/apps/server/dist /app/apps/server/dist
# games that couldn't be saved to the API are kept here and retried (a volume in compose)
RUN mkdir -p /app/apps/server/lost_game_data && chown bun:bun /app/apps/server/lost_game_data
# forks dist/gameProcess.js relative to the working directory
WORKDIR /app/apps/server
USER bun
EXPOSE 8001
CMD ["bun", "dist/gameServer.js"]

FROM base AS bot
ENV NODE_ENV=production
COPY --from=build /app/apps/bot/dist /app/apps/bot/dist
WORKDIR /app/apps/bot
USER bun
CMD ["bun", "dist/index.js"]

FROM ${CADDY_IMAGE} AS web
COPY docker/caddy-run.sh /usr/local/bin/caddy-run.sh
COPY --from=client-build /app/apps/client/dist /srv
CMD ["/usr/local/bin/caddy-run.sh"]
