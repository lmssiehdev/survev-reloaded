import { bool, int, isProd, parseEnv, secret } from "@survev/config/env.ts";
import { z } from "zod";

/** the API's environment variables, documented in .env.example */
export const env = parseEnv({
    DATABASE_URL: isProd
        ? z.url()
        : z.url().default("postgres://survev:survev@127.0.0.1:5432/survev"),
    API_HOST: z.string().default("0.0.0.0"),
    API_PORT: int(8000),
    /** header with the client IP set by a reverse proxy (X-Forwarded-For, CF-Connecting-IP) */
    PROXY_IP_HEADER: z.string().optional(),
    /** the website's public URL, OAuth redirects come back to it */
    PUBLIC_URL: z.url().default("http://127.0.0.1:3000"),
    /** where login flows end, an absolute URL when the client is on another subdomain than the API */
    CLIENT_URL: z.string().default("/"),
    /** leaderboards and stats are cached in redis when set */
    REDIS_URL: z.string().optional(),
    SURVEV_IP_SECRET: secret("dev-ip-secret"),
    BETTER_AUTH_SECRET: secret("dev-better-auth-secret-at-least-32-characters"),
    DISCORD_CLIENT_ID: z.string().optional(),
    DISCORD_SECRET_ID: z.string().optional(),
    /** proxycheck.io, blocks VPNs and proxies when set */
    PROXYCHECK_KEY: z.string().optional(),
    /** cloudflare turnstile captcha, the site key is sent to the client */
    TURNSTILE_SITE_KEY: z.string().optional(),
    TURNSTILE_SECRET_KEY: z.string().optional(),
    /** a "Mock login" button that creates test accounts */
    ALLOW_MOCK_ACCOUNT: bool(!isProd),
});
