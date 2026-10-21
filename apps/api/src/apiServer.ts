import { Config } from "@survev/config/serverConfig.ts";
import { GIT_VERSION } from "@survev/config/utils/gitRevision.ts";
import { ServerLogger } from "@survev/config/utils/logger.ts";
import type { FindGamePrivateBody, FindGamePrivateRes } from "@survev/contracts";
import type { SiteInfoRes } from "@survev/shared/types/api.ts";
import { Result } from "better-result";
import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { fetchResult, readJson } from "./errors.ts";
import { TeamMenu } from "./teamMenu.ts";

class Region {
    data: (typeof Config)["regions"][string];
    playerCount = 0;

    lastUpdateTime = Date.now();

    constructor(readonly id: string) {
        this.data = Config.regions[this.id];
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

    async findGame(body: FindGamePrivateBody): Promise<FindGamePrivateRes> {
        // can wait for a new game process to start
        const res = await this.fetch<FindGamePrivateRes>("api/find_game", body, 20_000);
        return res.unwrapOr({ error: "find_game_failed" as const });
    }
}

interface RegionData {
    playerCount: number;
}

export class ApiServer {
    readonly logger = new ServerLogger("Server");

    teamMenu = new TeamMenu(this);

    regions: Record<string, Region> = {};

    modes = [...Config.modes];
    clientTheme = Config.clientTheme;

    captchaEnabled = Config.captchaEnabled;

    constructor() {
        for (const region in Config.regions) {
            this.regions[region] = new Region(region);
        }
    }

    init(app: Hono, upgradeWebSocket: UpgradeWebSocket) {
        this.teamMenu.init(app, upgradeWebSocket);
    }

    getSiteInfo(): SiteInfoRes {
        const data: SiteInfoRes = {
            modes: this.modes,
            pops: {},
            youtube: { name: "", link: "" },
            twitch: [],
            country: "US",
            gitRevision: GIT_VERSION,
            captchaEnabled: this.captchaEnabled,
            clientTheme: this.clientTheme,
        };

        for (const region in this.regions) {
            data.pops[region] = {
                playerCount: this.regions[region].playerCount,
                l10n: Config.regions[region].l10n,
            };
        }
        return data;
    }

    updateRegion(regionId: string, regionData: RegionData) {
        const region = this.regions[regionId];
        if (!region) {
            this.logger.warn("updateRegion: Invalid region", regionId);
            return;
        }
        region.playerCount = regionData.playerCount;
        region.lastUpdateTime = Date.now();
    }

    async findGame(body: FindGamePrivateBody): Promise<FindGamePrivateRes> {
        if (body.region in this.regions) {
            return await this.regions[body.region].findGame(body);
        }
        return { error: "invalid_region" };
    }
}

export const server = new ApiServer();
