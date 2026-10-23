import type { AppName } from "@survev/logger/index.ts";
import type { ServerLoggingOptions } from "@survev/logger/node.ts";
import { z } from "zod";
import { GIT_VERSION } from "./utils/gitRevision.ts";

/**
 * Settings come from environment variables. In dev the app scripts load the repo root .env
 * (see .env.example), docker compose passes them to the containers.
 * Each app declares the variables it reads with `parseEnv`, this file has the shared ones.
 */

// dot access so the production build inlines it (scripts/buildApp.ts defines process.env.NODE_ENV)
export const isProd = process.env.NODE_ENV === "production";

/** "true" / "false", unset uses the default */
export const bool = (fallback: boolean) =>
    z.enum(["true", "false"]).optional().transform((v) => (v ? v === "true" : fallback));

export const int = (fallback: number) => z.coerce.number().int().default(fallback);

/** required in production; dev falls back to a fixed value so a fresh checkout runs without a .env */
export const secret = (devValue: string) => isProd ? z.string().min(1) : z.string().min(1).default(devValue);

/**
 * parses the variables in `shape` from process.env, exits listing every missing or invalid one.
 * an empty variable (`KEY=` in .env) counts as unset
 */
export function parseEnv<T extends z.ZodRawShape>(shape: T): z.infer<z.ZodObject<T>> {
    const vars = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
    const res = z.object(shape).safeParse(vars);
    if (!res.success) {
        const issues = res.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
        console.error(`Invalid environment variables (see .env.example):\n${issues}`);
        process.exit(1);
    }
    return res.data;
}

/** read by every server app: logging, rate limits and the key the servers use to talk to each other */
export const sharedEnv = parseEnv({
    LOG_LEVEL: z.enum(["debug", "info", "warning", "error"]).default(isProd ? "info" : "debug"),
    /** json: one object per line on stdout */
    LOG_FORMAT: z.enum(["pretty", "json"]).default(isProd ? "json" : "pretty"),
    /** logs are shipped to Axiom only when both are set */
    AXIOM_TOKEN: z.string().optional(),
    AXIOM_DATASET: z.string().optional(),
    /** Axiom ingest endpoint, override to point at a regional edge or a test server */
    AXIOM_URL: z.string().url().default("https://api.axiom.co"),
    SURVEV_ENV: z.enum(["production", "staging", "dev"]).default(isProd ? "production" : "dev"),
    RATE_LIMITS: bool(isProd),
    /** shared by the API, game servers and bot to call each other's private routes */
    SURVEV_API_KEY: secret("dev-api-key"),
    /** this game server's region id */
    REGION: z.string().min(1).default("local"),
    /** interval of the process.stats log line in ms, lower it to see them sooner in dev */
    PROCESS_STATS_MS: int(60000),
});

/** the options every app passes to `setupServerLogging` */
export function loggingOptions(app: AppName, region?: string): ServerLoggingOptions {
    const { AXIOM_TOKEN, AXIOM_DATASET, AXIOM_URL } = sharedEnv;
    return {
        app,
        level: sharedEnv.LOG_LEVEL,
        format: sharedEnv.LOG_FORMAT,
        env: sharedEnv.SURVEV_ENV,
        git: GIT_VERSION,
        region,
        axiom: AXIOM_TOKEN && AXIOM_DATASET
            ? { token: AXIOM_TOKEN, dataset: AXIOM_DATASET, baseUrl: AXIOM_URL }
            : undefined,
    };
}
