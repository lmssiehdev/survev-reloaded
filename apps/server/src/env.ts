import { bool, isProd, parseEnv, sharedEnv } from "@survev/config/env.ts";
import type { DefaultItems } from "@survev/game/gameOptions.ts";
import { z } from "zod";

/** the game server's environment variables, documented in .env.example */
const raw = parseEnv({
    GAME_HOST: z.string().default("0.0.0.0"),
    GAME_PORT: z.coerce.number().int().default(8001),
    API_URL: z.url().default("http://127.0.0.1:8000"),
    /** public URL of this server, players connect to it and the API calls it. Defaults to 127.0.0.1:GAME_PORT */
    REGION_URL: z.url().optional(),
    /** translation key of the region name shown to players, defaults to index-<REGION> */
    REGION_L10N: z.string().optional(),
    /** every game runs on its own port from this range, keep it in sync with the firewall */
    GAME_PORTS: z.string().regex(/^\d+-\d+$/).default("9000-9063"),
    SSL_KEY_FILE: z.string().optional(),
    SSL_CERT_FILE: z.string().optional(),
    /** header with the client IP set by a reverse proxy (X-Forwarded-For, CF-Connecting-IP) */
    PROXY_IP_HEADER: z.string().optional(),
    UNIQUE_IN_GAME_NAMES: bool(true),
    ALLOW_BOTS: bool(!isProd),
    ALLOW_EDIT_MSG: bool(!isProd),
    /** "x,y": every player spawns there */
    SPAWN_POS: z.string().regex(/^-?[\d.]+,-?[\d.]+$/).optional(),
    /** JSON object of items every player spawns with, eg {"backpack":"backpack03"} */
    DEFAULT_ITEMS: z.string().optional().transform((v) => (v ? JSON.parse(v) as DefaultItems : {})),
});

const [firstGamePort, lastGamePort] = raw.GAME_PORTS.split("-").map(Number);
const spawnPos = raw.SPAWN_POS?.split(",").map(Number);

export const env = {
    ...raw,
    REGION: sharedEnv.REGION,
    REGION_URL: raw.REGION_URL ?? `http://127.0.0.1:${raw.GAME_PORT}`,
    REGION_L10N: raw.REGION_L10N ?? `index-${sharedEnv.REGION}`,
    firstGamePort,
    maxGames: lastGamePort - firstGamePort + 1,
    ssl: raw.SSL_KEY_FILE && raw.SSL_CERT_FILE
        ? { key: Bun.file(raw.SSL_KEY_FILE), cert: Bun.file(raw.SSL_CERT_FILE) }
        : undefined,
    spawnPos: spawnPos && { x: spawnPos[0], y: spawnPos[1] },
};
