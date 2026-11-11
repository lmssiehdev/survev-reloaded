import { EmotesDefs } from "@survev/shared/defs/gameObjects/emoteDefs.ts";
import { GameConfig } from "@survev/shared/gameConfig.ts";
import type { UserStatsResponse } from "@survev/shared/types/stats.ts";
import {
    ALL_TEAM_MODES,
    type LeaderboardType,
    TEAM_MODE_BY_NAME,
    TEAM_MODES,
    type TeamModeFilter,
    type TeamModeName,
} from "@survev/shared/types/statsFilters.ts";
import { LEADERBOARD_TITLE_KEYS, TEAM_MODE_LABEL_KEYS } from "@survev/shared/types/statsLabels.ts";
import { helpers } from "../helpers.ts";
import type { StatsKey } from "./i18n.ts";

export const gameModes = helpers.getGameModes();
export const formatTime = helpers.formatTime;

/** label of a team mode as the leaderboard URL spells it */
export const teamModeNameLabel = (name: TeamModeName) => TEAM_MODE_LABEL_KEYS[TEAM_MODE_BY_NAME[name]];

export function teamModeFilterLabel(filter: TeamModeFilter): StatsKey {
    return filter === ALL_TEAM_MODES ? "stats-all" : TEAM_MODE_LABEL_KEYS[filter];
}

/** header of the leaderboard's stat column: kills per game is abbreviated */
export const leaderboardStatLabels = {
    ...LEADERBOARD_TITLE_KEYS,
    kpg: "stats-kpg",
} satisfies Record<LeaderboardType, StatsKey>;

export interface Stat {
    key: StatsKey;
    val: string | number;
}

export interface ModeCard {
    name: TeamModeName;
    label: StatsKey;
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
        const label = TEAM_MODE_LABEL_KEYS[teamMode];
        const mode = stats.modes.find((m) => m.teamMode === teamMode);
        if (!mode) return { name, label, games: 0, midStats: [], botStats: [] };
        return {
            name,
            label,
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
        return hours === 1 ? "an hour ago" : `${hours} hours ago`;
    }
    const days = Math.floor(secondsPast / 86400);
    return days === 1 ? "1 day ago" : `${days} days ago`;
}
