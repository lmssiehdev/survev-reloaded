# Hosting your own survev server

The production setup is Docker Compose: [Caddy](https://caddyserver.com) serves the client and gets HTTPS
certificates automatically, and proxies to the API, the game server, PostgreSQL and Redis.

## Prerequisites

- A Linux server (VPS) with [Docker Engine and the compose plugin](https://docs.docker.com/engine/install/).
- A domain with two DNS `A` (and `AAAA`) records pointing at the server, e.g. `survev.example.com` (website + API)
  and `game.survev.example.com` (game server).
- Open firewall ports: `80/tcp`, `443/tcp`, `443/udp` and the game ports (`9000-9063/tcp` by default).
  Every game runs on its own port and clients connect to `wss://<game domain>:<port>/play`, Caddy terminates TLS on each.

## Configuration

```sh
git clone https://github.com/leia-uwu/survev.git && cd survev
bun survev-setup    # or: cp .env.example .env and fill in the secrets yourself
```

Everything is an environment variable in `.env`, documented in [`.env.example`](.env.example). For this setup set:

- `SURVEV_DOMAIN`, `SURVEV_GAME_DOMAIN`, `POSTGRES_PASSWORD` and the three secrets (`bun survev-setup` fills these in).
- `REGION` and `REGION_L10N` for the game server, eg `REGION=na` and `REGION_L10N=index-north-america`.
  The game server registers its region with the API, the region list players see comes from those.

`docker-compose.yml` derives the rest from the domains: the database URL, the public URLs, the API address and
`GAME_PORTS` (= `SURVEV_GAME_PORTS`). The client only bakes in the public `VITE_*` variables, it gets regions,
login methods and the captcha key from the API at runtime. Game modes, the client theme and the captcha toggle are
stored in the database and changed through the API's `/private` routes, without a restart.
For Discord login also set `DISCORD_CLIENT_ID` / `DISCORD_SECRET_ID` (redirect URL `https://<domain>/api/auth/callback/discord`).

`/private/*` is only reachable inside the compose network (`api:8000`), Caddy answers 404 for it.

### Coming from survev-config.hjson

| survev-config.hjson | .env |
| --- | --- |
| `secrets.*` | same names (`SURVEV_API_KEY`, `DISCORD_CLIENT_ID`, ...) |
| `secrets.AD_PREFIX`, `GAMEMONETIZE_ID`, `SPELLSYNC_*` | `VITE_AD_PREFIX`, `VITE_GAMEMONETIZE_ID`, `VITE_SPELLSYNC_*` |
| `database` | `DATABASE_URL` (set by compose) |
| `oauthRedirectURI` / `oauthBasePath` | `PUBLIC_URL` (set by compose) / `CLIENT_URL` |
| `gameServer.thisRegion`, `regions.<id>` | `REGION`, `REGION_L10N`, `REGION_URL` on each game server |
| `gameServer.firstGamePort` / `maxGames` | `GAME_PORTS` |
| `apiServer` / `gameServer` `proxyIPHeader` | `PROXY_IP_HEADER` (set by compose) |
| `proxies.<host>.apiUrl` | `VITE_API_URL`, logins come from the API |
| `cachingEnabled` | `REDIS_URL` (set by compose) |
| `rateLimitsEnabled`, `logging`, `errorLoggingWebhook` | `RATE_LIMITS`, `LOG_LEVEL` / `LOG_DATE`, `ERROR_WEBHOOK_URL` |
| `discordGuildId` / `discordRoleId` | `DISCORD_GUILD_ID` / `DISCORD_ROLE_ID` |
| `modes`, `clientTheme`, `captchaEnabled` | the database (`/private`), changes made there before are kept |

## First start, logs, updates

```sh
docker compose up -d --build     # builds the images, migrations run when the api container starts
docker compose ps                # everything should become healthy
docker compose logs -f api game  # or web, postgres, redis
```

Update:

```sh
git pull && docker compose up -d --build && docker image prune -f
```

The Discord bot is optional: set its `DISCORD_*` variables, then `docker compose --profile bot up -d`.

## Backups

The database lives in the `postgres-data` volume. Dump it with `pg_dump` (a plain copy of the volume while
Postgres runs is not a safe backup):

```sh
docker compose exec -T postgres pg_dump -U survev -Fc survev > survev-$(date +%F).dump
# restore into an empty database
docker compose exec -T postgres pg_restore -U survev -d survev --clean --if-exists < survev-2026-01-01.dump
```

Nightly at 4:00 with cron (`crontab -e`), keeping 14 days:

```sh
0 4 * * * cd /opt/survev && docker compose exec -T postgres pg_dump -U survev -Fc survev > backups/survev-$(date +\%F).dump && find backups -name '*.dump' -mtime +14 -delete
```

## Local testing without certificates

Set `SURVEV_SCHEME=http`, `SURVEV_HTTP_PORT=8080`, `SURVEV_DOMAIN=localhost` and a `SURVEV_GAME_DOMAIN` that
resolves to the machine, then `REGION_URL=http://<game domain>:8080`.

## Dev mode

Runs the Vite dev server (hot reload), the API and the game server in watch mode with the source mounted, plus
Postgres and Redis, with the local defaults (and the root `.env` if there is one):

```sh
docker compose -f docker-compose.dev.yml up --build
```

The client is at http://127.0.0.1:3000 (`SURVEV_DEV_VITE_PORT` changes the host port), and the game server
uses ports 8001 and 9000-9063 on 127.0.0.1. `docker compose -f docker-compose.dev.yml down -v` resets the database.
