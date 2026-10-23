import { type MapDefKey, MapDefs } from "@survev/shared/defs/mapDefs.ts";
import { GameConfig } from "@survev/shared/gameConfig.ts";
import type { SiteInfoRes } from "@survev/shared/types/api.ts";
import $ from "jquery";
import { api } from "./api.ts";
import type { ConfigManager } from "./config.ts";
import { device } from "./device.ts";
import { helpers } from "./helpers.ts";
import type { Localization } from "./ui/localization.ts";

export class SiteInfo {
    info = {} as SiteInfoRes;
    loaded = false;

    constructor(
        public config: ConfigManager,
        public localization: Localization,
    ) {
    }

    /** resolves once site_info is in, or failed to load */
    async load() {
        const locale = this.localization.getLocale();
        const siteInfoUrl = api.resolveUrl(`/api/site_info?language=${locale}`);
        const data = await fetch(siteInfoUrl)
            .then((res) => res.json() as Promise<SiteInfoRes>)
            .catch((err) => void console.error("Failed to load site info", err));
        if (!data) return;

        this.info = data;
        this.loaded = true;
        api.logins = data.logins;
        helpers.turnstileSiteKey = data.turnstileSiteKey;
        if (data.captchaEnabled && data.turnstileSiteKey) helpers.loadTurnstile();

        const mainSelector = $("#server-opts");
        const teamSelector = $("#team-server-opts");
        for (const [region, { l10n }] of Object.entries(data.regions)) {
            const name = this.localization.translate(l10n);
            for (const selector of [mainSelector, teamSelector]) {
                $("<option>", { value: region, text: name, "data-l10n": l10n, "data-label": name }).appendTo(selector);
            }
        }

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
                icon: mapDef.icon,
                buttonCss: mapDef.buttonCss,
                buttonText,
                enabled: mode.enabled,
            });
        }
        return availableModes;
    }

    updatePageFromInfo() {
        if (this.loaded) {
            const getGameModeStyles = this.getGameModeStyles();
            for (let i = 0; i < getGameModeStyles.length; i++) {
                const style = getGameModeStyles[i];
                const selector = `index-play-${style.buttonText}`;
                const btn = $(`#btn-start-mode-${i}`);
                btn.data("l10n", selector);
                btn.html(this.localization.translate(selector));
                if (style.icon || style.buttonCss) {
                    if (i == 0) {
                        btn.addClass("btn-custom-mode-no-indent");
                    } else {
                        btn.addClass("btn-custom-mode-main");
                    }
                    btn.addClass(style.buttonCss);
                    btn.css({
                        "background-image": `url(${style.icon})`,
                    });
                }
                const l = $(`#btn-team-queue-mode-${i}`);
                if (l.length) {
                    const c = `index-${style.buttonText}`;
                    l.data("l10n", c);
                    l.html(this.localization.translate(c));
                    if (style.icon) {
                        l.addClass("btn-custom-mode-select");
                        l.css({
                            "background-image": `url(${style.icon})`,
                        });
                    }
                }

                btn.toggle(style.enabled);
            }
            const supportsTeam = this.info.modes.some((s) => s.enabled && s.teamMode > 1);
            $("#btn-join-team, #btn-create-team").toggle(supportsTeam);

            const players = this.localization.translate("index-players");
            for (const [region, { playerCount }] of Object.entries(this.info.regions)) {
                const sel = $("#server-opts").children(`option[value="${region}"]`);
                sel.text(`${sel.data("label")} [${playerCount} ${players}]`);
            }
            let hasTwitchStreamers = false;
            const featuredStreamersElem = $("#featured-streamers");
            const streamerList = $(".streamer-list");
            if (!device.mobile && this.info.twitch) {
                streamerList.empty();
                for (let i = 0; i < this.info.twitch.length; i++) {
                    const streamer = this.info.twitch[i];
                    const template = $("#featured-streamer-template").clone();
                    template
                        .attr("class", "featured-streamer streamer-tooltip")
                        .attr("id", "");
                    const link = template.find("a");
                    const text = this.localization.translate(
                        streamer.viewers == 1 ? "index-viewer" : "index-viewers",
                    );
                    link.html(
                        `${streamer.name} <span>${streamer.viewers} ${text}</span>`,
                    );
                    link.css("background-image", `url(${streamer.img})`);
                    link.attr("href", streamer.url);
                    streamerList.append(template);
                    hasTwitchStreamers = true;
                }
            }
            featuredStreamersElem.css(
                "visibility",
                hasTwitchStreamers ? "visible" : "hidden",
            );

            const featuredYoutuberElem = $("#featured-youtuber");
            const displayYoutuber = this.info.youtube;
            if (displayYoutuber) {
                $(".btn-youtuber")
                    .attr("href", this.info.youtube.link)
                    .html(this.info.youtube.name);
            }
            featuredYoutuberElem.css("display", displayYoutuber ? "block" : "none");

            const mapDef = MapDefs[this.info.clientTheme];
            if (mapDef) {
                this.config.set("clientTheme", this.info.clientTheme);
                this.config.set("cachedBgImg", mapDef.desc.backgroundImg);
                const bg = document.getElementById("background");
                if (bg) {
                    bg.style.backgroundImage = `url(${mapDef.desc.backgroundImg})`;
                }
            }
        }
    }
}
