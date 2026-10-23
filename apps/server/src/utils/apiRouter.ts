import type { PrivateRouteApp } from "@survev/api/types";
import { sharedEnv } from "@survev/config/env.ts";
import { getLogger } from "@survev/logger/node.ts";
import { hc } from "hono/client";
import { env } from "../env.ts";

const logger = getLogger(["api-client"]);

export const apiPrivateRouter = hc<PrivateRouteApp>(
    `${env.API_URL}/private`,
    {
        // no retries: quest_progress isn't idempotent,
        // a failed save_game is kept in a lost game file and sent again on startup
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
        headers: {
            "survev-api-key": sharedEnv.SURVEV_API_KEY,
        },
    },
);

export async function checkIp(ip: string) {
    try {
        const apiRes = await apiPrivateRouter.check_ip.$post({
            json: {
                ip,
            },
        });

        if (apiRes.ok) {
            const body = await apiRes.json();
            return body;
        }
    } catch (err) {
        logger.error("api.check_ip_failed", { err });
    }

    return undefined;
}
