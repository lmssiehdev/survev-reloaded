import type { PrivateRouteApp } from "@survev/api/types";
import { Config } from "@survev/config/serverConfig.ts";
import { defaultLogger } from "@survev/config/utils/logger.ts";
import { hc } from "hono/client";

export const apiPrivateRouter = hc<PrivateRouteApp>(
    `${Config.gameServer.apiServerUrl}/private`,
    {
        // no retries: quest_progress isn't idempotent,
        // a failed save_game is kept in a lost game file and sent again on startup
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
        headers: {
            "survev-api-key": Config.secrets.SURVEV_API_KEY,
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
        defaultLogger.error(`Failed request API fetch_ip: `, err);
    }

    return undefined;
}
