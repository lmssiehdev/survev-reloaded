import { type MapDefKey, MapDefs } from "@survev/shared/defs/mapDefs.ts";
import { GameConfig, TeamMode } from "@survev/shared/gameConfig.ts";
import type { SiteInfoRes } from "@survev/shared/types/api.ts";
import { reconcile } from "solid-js";
import { api, client } from "./api.ts";
import type { ConfigManager } from "./config.ts";
import { device } from "./device.ts";
import { helpers } from "./helpers.ts";
import { locale as currentLocale } from "./ui/i18n.ts";
import { setStartMenu } from "./ui/startMenu.ts";

export class SiteInfo {
    info = {} as SiteInfoRes;
    loaded = false;

    constructor(public config: ConfigManager) {}

    /** resolves once site_info is in, or failed to load */
    async load() {
        const { data, error } = await client.site_info.get({ query: { language: currentLocale() } });
        if (!data) {
            console.error("Failed to load site info", error);
            return;
        }

        this.info = data;
        this.loaded = true;
        api.logins = data.logins;
        helpers.turnstileSiteKey = data.turnstileSiteKey;
        if (data.captchaEnabled && data.turnstileSiteKey) helpers.loadTurnstile();

        this.updatePageFromInfo();
    }

    getGameModeStyles() {
        const availableModes = [];
        const modes = this.info.modes || [];
        for (let i = 0; i < modes.length; i++) {
            const mode = modes[i];
            const mapDef = (MapDefs[mode.mapName as MapDefKey] || MapDefs.main)
                .desc;
            const buttonText = mapDef.buttonText
                ? mapDef.buttonText
                : GameConfig.TeamModeToString[mode.teamMode];
            availableModes.push({
                icon: mapDef.icon ?? "",
                buttonCss: mapDef.buttonCss ?? "",
                buttonText,
                enabled: mode.enabled,
            });
        }
        return availableModes;
    }

    /** the start menu's play buttons, regions, streamers and theme */
    updatePageFromInfo() {
        if (!this.loaded) return;
        const info = this.info;
        setStartMenu((m) => {
            reconcile(this.getGameModeStyles())(m.modes);
            m.supportsTeam = info.modes.some((mode) => mode.enabled && mode.teamMode != TeamMode.Solo);
            reconcile(
                Object.entries(info.regions).map(([id, { l10n, playerCount }]) => ({ id, l10n, playerCount })),
                "id",
            )(m.regions);
            reconcile(device.mobile ? [] : (info.twitch ?? []), "name")(m.streamers);
            m.youtube = info.youtube ? { ...info.youtube } : null;
        });

        const mapDef = MapDefs[info.clientTheme];
        if (mapDef) {
            this.config.set("clientTheme", info.clientTheme);
            this.config.set("cachedBgImg", mapDef.desc.backgroundImg);
        }
    }
}
