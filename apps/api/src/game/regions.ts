import { Config } from "@survev/config/serverConfig.ts";
import { ServerLogger } from "@survev/config/utils/logger.ts";
import type { FindGamePrivateBody, FindGamePrivateRes } from "@survev/contracts";
import type { SiteInfoRes } from "@survev/shared/types/api.ts";
import { fetchJson } from "../lib/errors.ts";

const logger = new ServerLogger("Regions");

/** what each game server last reported through /private/update_region */
const reports = new Map<string, { playerCount: number; at: number }>();

export function isRegion(regionId: string) {
    return Object.hasOwn(Config.regions, regionId);
}

export function updateRegion(regionId: string, playerCount: number) {
    if (!isRegion(regionId)) {
        logger.warn("updateRegion: Invalid region", regionId);
        return;
    }
    reports.set(regionId, { playerCount, at: Date.now() });
}

/** a region that hasn't reported in a minute is likely down, it shows 0 players */
export function regionPops(): SiteInfoRes["pops"] {
    return Object.fromEntries(
        Object.entries(Config.regions).map(([id, region]) => {
            const report = reports.get(id);
            const live = report && Date.now() - report.at < 60_000;
            return [id, { playerCount: live ? report.playerCount : 0, l10n: region.l10n }];
        }),
    );
}

/** POST to a region's game server */
export function regionFetch<T>(regionId: string, endPoint: string, body: object, timeoutMs?: number) {
    const { https, address } = Config.regions[regionId];
    return fetchJson<T>(`Region ${regionId} ${endPoint}`, `http${https ? "s" : ""}://${address}/${endPoint}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "survev-api-key": Config.secrets.SURVEV_API_KEY,
        },
        body: JSON.stringify(body),
        timeoutMs,
    });
}

export async function findGame(body: FindGamePrivateBody): Promise<FindGamePrivateRes> {
    if (!isRegion(body.region)) return { error: "invalid_region" };
    // can wait for a new game process to start
    const res = await regionFetch<FindGamePrivateRes>(body.region, "api/find_game", body, 20_000);
    return res.unwrapOr({ error: "find_game_failed" as const });
}
