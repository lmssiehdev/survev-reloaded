import { EmotesDefs } from "@survev/shared/defs/gameObjects/emoteDefs.ts";
import { GameConfig } from "@survev/shared/gameConfig.ts";
import type { UserStatsResponse } from "@survev/shared/types/stats.ts";
import {
    ALL_TEAM_MODES,
    type LeaderboardType,
    type StatsInterval,
    TEAM_MODES,
    type TeamModeFilter,
    type TeamModeName,
} from "@survev/shared/types/statsFilters.ts";
import { helpers } from "../helpers.ts";
import type { StatsKey } from "./i18n.ts";

export const gameModes = helpers.getGameModes();
export const formatTime = helpers.formatTime;

export const intervalLabels = {
    daily: "stats-today",
    weekly: "stats-this-week",
    alltime: "stats-all-time",
} satisfies Record<StatsInterval, StatsKey>;

export const teamModeLabels = {
    solo: "stats-solo",
    duo: "stats-duo",
    squad: "stats-squad",
} satisfies Record<TeamModeName, StatsKey>;

export function teamModeFilterLabel(filter: TeamModeFilter): StatsKey {
    return filter === ALL_TEAM_MODES ? "stats-all" : teamModeLabels[GameConfig.TeamModeToString[filter]];
}

/** leaderboard type selector */
export const leaderboardTypeLabels = {
    most_kills: "stats-most-kills",
    most_damage_dealt: "stats-most-damage",
    kpg: "stats-kpg-full",
    kills: "stats-total-kills",
    wins: "stats-total-wins",
} satisfies Record<LeaderboardType, StatsKey>;

/** header of the leaderboard's stat column */
export const leaderboardStatLabels = {
    ...leaderboardTypeLabels,
    kpg: "stats-kpg",
} satisfies Record<LeaderboardType, StatsKey>;

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
    return TEAM_MODES.map((teamMode) => {
        const name = GameConfig.TeamModeToString[teamMode];
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
