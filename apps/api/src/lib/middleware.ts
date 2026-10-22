import { zValidator } from "@hono/zod-validator";
import { Config } from "@survev/config/serverConfig.ts";
import { HTTPRateLimit } from "@survev/config/utils/rateLimit.ts";
import type { Context, Next } from "hono";
import type { z } from "zod";
import { errorResponse, Forbidden, InvalidParams, RateLimited } from "./errors.ts";
import { getHonoIp } from "./ip.ts";

/**
 * middleware for validating JSON request parameters against a Zod schema.
 */
export function validateParams<Schema extends z.ZodSchema>(
    schema: Schema,
    response?: object,
) {
    return zValidator("json", schema, (result, c) => {
        if (!result.success) {
            // plain Response: keep the error out of the typed client's route outputs
            const res: Response = response
                ? c.json(response, 400)
                : errorResponse(c, new InvalidParams({ message: "Invalid params", issues: result.error.issues }));
            return res;
        }
    });
}

export async function databaseEnabledMiddleware(c: Context, next: Next) {
    if (!Config.database.enabled) {
        return errorResponse(c, new Forbidden({ message: "Database is disabled" }));
    }
    await next();
}

export async function privateMiddleware(c: Context, next: Next) {
    if (c.req.header("survev-api-key") !== Config.secrets.SURVEV_API_KEY) {
        return errorResponse(c, new Forbidden({ message: "Invalid API key" }));
    }
    await next();
}

export function rateLimitMiddleware(limit: number, interval: number) {
    const rateLimit = new HTTPRateLimit(limit, interval);

    return async function(c: Context, next: Next) {
        const ip = getHonoIp(c, Config.apiServer.proxyIPHeader);

        if (!ip) {
            return errorResponse(c, new InvalidParams({ message: "Invalid IP" }));
        }

        if (rateLimit.isRateLimited(ip)) {
            return errorResponse(c, new RateLimited({ message: "Rate limited" }));
        }

        await next();
    };
}
