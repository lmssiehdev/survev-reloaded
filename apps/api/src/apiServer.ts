import { Config } from "@survev/config/serverConfig.ts";
import { GIT_VERSION } from "@survev/config/utils/gitRevision.ts";
import { defaultLogger, ServerLogger } from "@survev/config/utils/logger.ts";
import type { FindGamePrivateBody, FindGamePrivateRes } from "@survev/contracts";
import type { SiteInfoRes } from "@survev/shared/types/api.ts";
import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { TeamMenu } from "./teamMenu.ts";

class Region {
    data: (typeof Config)["regions"][string];
    playerCount = 0;

    lastUpdateTime = Date.now();

    constructor(readonly id: string) {
        this.data = Config.regions[this.id];
    }

    async fetch<Data extends object>(endPoint: string, body: object) {
        const url = `http${this.data.https ? "s" : ""}://${this.data.address}/${endPoint}`;

        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "survev-api-key": Config.secrets.SURVEV_API_KEY,
                },
                body: JSON.stringify(body),
            });

            if (res.ok) {
                return (await res.json()) as Data;
            }

            defaultLogger.warn(`Region ${this.id} returned status ${res.statusText}`);
        } catch (err) {
            defaultLogger.error(`Error fetching region ${this.id}`, err);
        }
    }

    async findGame(body: FindGamePrivateBody): Promise<FindGamePrivateRes> {
        const data = await this.fetch<FindGamePrivateRes>("api/find_game", body);
        if (!data) {
            return { error: "find_game_failed" };
        }
        return data;
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
