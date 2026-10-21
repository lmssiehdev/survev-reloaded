import { EmotesDefs } from "@survev/shared/defs/gameObjects/emoteDefs.ts";
import { TeamMode } from "@survev/shared/gameConfig.ts";
import type { UserStatsResponse } from "@survev/shared/types/stats.ts";
import { helpers } from "../helpers.ts";
import type { StatsKey } from "./i18n.ts";

export const gameModes = helpers.getGameModes();
export const formatTime = helpers.formatTime;

export const teamModeNames = {
    [TeamMode.Solo]: "solo",
    [TeamMode.Duo]: "duo",
    [TeamMode.Squad]: "squad",
} as const;
export type TeamModeName = (typeof teamModeNames)[TeamMode];

export interface Stat {
    key: StatsKey;
    val: string | number;
}

export interface ModeCard {
    name: TeamModeName;
    games: number;
    midStats: Stat[];
    botStats: Stat[];
}

export interface Profile {
    username: string;
    banned: boolean;
    avatarTexture: string;
    wins: number;
    kills: number;
    games: number;
    kpg: string;
}

export function getProfile(stats: UserStatsResponse): Profile {
    const emoteDef = EmotesDefs[stats.player_icon];
    return {
        username: stats.username,
        banned: stats.banned,
        avatarTexture: emoteDef ? helpers.emoteImgToSvg(emoteDef.texture) : "/img/gui/player-gui.svg",
        wins: stats.wins,
        kills: stats.kills,
        games: stats.games,
        kpg: stats.kpg,
    };
}

/** one card per team mode, in TeamMode order; modes without games get an empty card */
export function getModeCards(stats: UserStatsResponse): ModeCard[] {
    const teamModes = [TeamMode.Solo, TeamMode.Duo, TeamMode.Squad];
    return teamModes.map((teamMode) => {
        const name = teamModeNames[teamMode];
        const mode = stats.modes.find((m) => m.teamMode == teamMode);
        if (!mode) return { name, games: 0, midStats: [], botStats: [] };
        return {
            name,
            games: mode.games,
            // overall rating / rank are not available yet
            midStats: [
                { key: "stats-rating", val: "-" },
                { key: "stats-rank", val: "-" },
            ],
            botStats: [
                { key: "stats-wins", val: mode.wins },
                { key: "stats-win-pct", val: mode.winPct },
                { key: "stats-kills", val: mode.kills },
                { key: "stats-avg-survived", val: formatTime(mode.avgTimeAlive) },
                { key: "stats-most-kills", val: mode.mostKills },
                { key: "stats-kpg", val: mode.kpg },
                { key: "stats-most-damage", val: mode.mostDamage },
                { key: "stats-avg-damage", val: mode.avgDamage },
            ],
        };
    });
}

/** "5 minutes ago", "an hour ago", "3 days ago"... */
export function timeAgo(endTime: string | Date, now = Date.now()) {
    const secondsPast = (now - new Date(endTime).getTime()) / 1000;
    if (secondsPast < 3600) {
        const minutes = Math.round(secondsPast / 60);
        return minutes < 2 ? "1 minute ago" : `${minutes} minutes ago`;
    }
    if (secondsPast <= 86400) {
        const hours = Math.round(secondsPast / 3600);
        return hours == 1 ? "an hour ago" : `${hours} hours ago`;
    }
    const days = Math.floor(secondsPast / 86400);
    return days == 1 ? "1 day ago" : `${days} days ago`;
}
