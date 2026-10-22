import { Config } from "@survev/config/serverConfig.ts";
import { ServerLogger } from "@survev/config/utils/logger.ts";
import type { FindGamePrivateBody, FindGamePrivateRes } from "@survev/contracts";
import type { SiteInfoRes } from "@survev/shared/types/api.ts";
import { Result } from "better-result";
import { fetchResult, readJson } from "./errors.ts";

const logger = new ServerLogger("Regions");

/** a game server; it reports its player count through /private/update_region */
class Region {
    readonly data: (typeof Config)["regions"][string];
    playerCount = 0;
    lastUpdateTime = Date.now();

    constructor(readonly id: string) {
        this.data = Config.regions[id];
    }

    /** POST to the region's game server; the result is logged on failure */
    fetch<Data extends object>(endPoint: string, body: object, timeoutMs = 10_000) {
        const url = `http${this.data.https ? "s" : ""}://${this.data.address}/${endPoint}`;
        const name = `Region ${this.id} ${endPoint}`;
        return fetchResult(name, url, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "survev-api-key": Config.secrets.SURVEV_API_KEY,
            },
            body: JSON.stringify(body),
            timeoutMs,
        }).then(Result.andThenAsync((res: Response) => readJson<Data>(name, res)));
    }
}

export const regions: Readonly<Record<string, Region>> = Object.fromEntries(
    Object.keys(Config.regions).map((id) => [id, new Region(id)]),
);

export function updateRegion(regionId: string, data: { playerCount: number }) {
    const region = regions[regionId];
    if (!region) {
        logger.warn("updateRegion: Invalid region", regionId);
        return;
    }
    region.playerCount = data.playerCount;
    region.lastUpdateTime = Date.now();
}

export async function findGame(body: FindGamePrivateBody): Promise<FindGamePrivateRes> {
    const region = regions[body.region];
    if (!region) return { error: "invalid_region" };
    // can wait for a new game process to start
    const res = await region.fetch<FindGamePrivateRes>("api/find_game", body, 20_000);
    return res.unwrapOr({ error: "find_game_failed" as const });
}

export function regionPops(): SiteInfoRes["pops"] {
    return Object.fromEntries(
        Object.values(regions).map((region) => [
            region.id,
            { playerCount: region.playerCount, l10n: region.data.l10n },
        ]),
    );
}

/** zeroes the player count of regions that stopped reporting, they are likely down */
export function watchRegions() {
    setInterval(() => {
        for (const region of Object.values(regions)) {
            if (Date.now() - region.lastUpdateTime > 60000) {
                logger.warn(`Region ${region.id} has not sent player count in more than 60 seconds`);
                region.playerCount = 0;
            }
        }
    }, 60000);
}
