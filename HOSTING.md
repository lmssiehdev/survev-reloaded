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
cp .env.example .env    # set the domains and POSTGRES_PASSWORD
```

Create `survev-config.hjson` next to it (all fields are documented in `packages/config/configType.ts`,
`bun survev-setup` can generate the secrets). The Docker-specific parts:

```hjson
{
    // Caddy sets X-Forwarded-For to the client IP. Only the compose network can reach the servers directly.
    apiServer: { proxyIPHeader: "X-Forwarded-For" }
    gameServer: {
        apiServerUrl: "http://api:8000"
        thisRegion: "main"
        proxyIPHeader: "X-Forwarded-For"
        // firstGamePort / maxGames must match SURVEV_GAME_PORTS in .env (defaults: 9000 / 64)
    }
    regions: {
        // address = SURVEV_GAME_DOMAIN, no port
        main: { https: true, address: "game.survev.example.com", l10n: "index-north-america" }
    }
    oauthRedirectURI: "https://survev.example.com"
    // leaderboards are cached in the redis container
    cachingEnabled: true
    database: { host: "postgres", password: "<POSTGRES_PASSWORD from .env>" }
    secrets: {
        SURVEV_API_KEY: "<random>"
        SURVEV_IP_SECRET: "<random>"
        BETTER_AUTH_SECRET: "<random>"
    }
}
```

The file is mounted read-only into the containers (it must be readable by uid 1000), and the client build bakes
`regions`, `proxies` and some `secrets` in, so rebuild after changing it (`docker compose up -d --build`).
For Discord login also set `DISCORD_CLIENT_ID` / `DISCORD_SECRET_ID` (redirect URL `https://<domain>/api/auth/callback/discord`).

`/private/*` is only reachable inside the compose network (`api:8000`), Caddy answers 404 for it.

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

The Discord bot is optional: set its config fields, then `docker compose --profile bot up -d`.

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
resolves to the machine, then use `https: false` and `address: "<game domain>:8080"` in the region.

## Dev mode

Runs the Vite dev server (hot reload), the API and the game server in watch mode with the source mounted, plus
Postgres and Redis, using `survev-config.hjson` with its local defaults:

```sh
docker compose -f docker-compose.dev.yml up --build
```

The client is at http://127.0.0.1:3000 (`SURVEV_DEV_VITE_PORT` changes the host port), and the game server
uses ports 8001 and 9000-9063 on 127.0.0.1. `docker compose -f docker-compose.dev.yml down -v` resets the database.
