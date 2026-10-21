import type { PrivateRouteApp } from "@survev/api/types";
import { Config } from "@survev/config/serverConfig.ts";
import { fetchWithRetry } from "@survev/config/utils/fetchWithRetry.ts";
import { defaultLogger } from "@survev/config/utils/logger.ts";
import { hc } from "hono/client";

export const apiPrivateRouter = hc<PrivateRouteApp>(
    `${Config.gameServer.apiServerUrl}/private`,
    {
        fetch: fetchWithRetry,
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
