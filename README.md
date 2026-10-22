<div align="center">
    <img src="./apps/client/public/img/survev_logo_full.png" alt="Survev logo" style="height: 200px;">
</div>
<hr />
<div align="center">
    <img src="https://img.shields.io/badge/node.js%20-%235FA04E.svg?style=for-the-badge&logo=nodedotjs&logoColor=white">
    <img src="https://img.shields.io/badge/typescript-%233178C6?style=for-the-badge&logo=typescript&logoColor=white">
    <img src="https://img.shields.io/badge/hono-%23E36002.svg?style=for-the-badge&logo=hono&logoColor=white">
    <img src="https://img.shields.io/badge/jquery-%230769AD.svg?style=for-the-badge&logo=jquery&logoColor=white">
    <img src="https://img.shields.io/badge/drizzle-%23C5F74F?style=for-the-badge&logo=drizzle&logoColor=black">
    <img src="https://img.shields.io/badge/vite-%23646CFF.svg?style=for-the-badge&logo=vite&logoColor=white">
</div>
<br />
<div align="center">
    Open-source recreation of 2D top-down battle royale surviv.io.
</div>
<br />

## Development
Run `bun dev` at the repo root to start the API server, game server and client dev server together.
Use `bun dev:client`, `bun dev:api`, `bun dev:game` (or `bun dev:server` for API + game) to start them separately,
or run `bun dev` inside an app directory.

The repo is a Bun workspace:
- `apps/api`: API server (accounts, stats, matchmaking, team menu)
- `apps/server`: game server
- `apps/client`: Vite client
- `apps/bot`: Discord bot
- `packages/shared`: game code shared by the client and servers (`@survev/shared`)
- `packages/contracts`: zod schemas and types exchanged between apps (`@survev/contracts`)
- `packages/config`: `survev-config.hjson` loader and shared server utils (`@survev/config`)

Apps may import packages, but not each other (except the type-only `@survev/api/types`).

### Database and accounts
Accounts are optional, they are stored in a SQLite database (Bun's built-in `bun:sqlite`, nothing to install).
To disable them add `database: { enabled: false }` to `survev-config.hjson`.

The database is a single file, `data/survev.db` next to `survev-config.hjson` by default
(change it with `database: { file: "path/to/file.db" }`). Create it and apply the schema with:
```sh
# Run db:generate everytime you make changes to schema.ts.
bun run db:generate
bun run db:migrate

# Start the server
bun run dev
# or
# bun run dev:api
# bun run dev:game
```

To interact with the database through an interface:
```sh
bun run db:studio 
```

To wipe the database (deletes the file) and start over:
```sh
bun run db:wipe
bun run db:migrate
```

**NOTE:** Do not run this in production!

### Caching
Caching is disabled by default. Set `cachingEnabled` to `true` in `config.ts` to use it.

Install [Redis](https://redis.io):
```sh
sudo apt install redis-server
```

Ensure Redis starts on boot and is running:
```sh
systemctl enable --now redis-server
```

## Production
See [HOSTING.md](./HOSTING.md)
