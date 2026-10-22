import { z } from "zod";
import { MapId, type TeamMode } from "../gameConfig.ts";
import {
    ALL_MAPS,
    LEADERBOARD_TYPES,
    STATS_INTERVALS,
    TEAM_MODE_BY_NAME,
    TEAM_MODE_FILTERS,
    TEAM_MODE_NAMES,
} from "./statsFilters.ts";

export * from "./statsFilters.ts";

//
// Match History
//

export const zMatchHistoryRequest = z.object({
    slug: z.string(),
    offset: z.number(),
    count: z.number(),
    teamModeFilter: z.literal(TEAM_MODE_FILTERS),
});

export type MatchHistoryParams = z.infer<typeof zMatchHistoryRequest>;

export type MatchHistory = {
    guid: string;
    region: string;
    map_id: number;
    team_mode: TeamMode;
    team_count: number;
    team_total: number;
    end_time: string | Date;
    time_alive: number;
    rank: number;
    kills: number;
    team_kills: number;
    damage_dealt: number;
    damage_taken: number;
};
export type MatchHistoryResponse = MatchHistory[];

//
// Match Data
//
export const zMatchDataRequest = z.object({
    gameId: z.string(),
});

export type MatchDataRequest = z.infer<typeof zMatchDataRequest>;
export type MatchDataResponse = MatchData[];

export type MatchData = {
    slug: string | null;
    username: string;
    player_id: number;
    team_id: number;
    time_alive: number;
    rank: number;
    died: boolean;
    kills: number;
    damage_dealt: number;
    damage_taken: number;
    killer_id: number;
    killed_ids: number[];
    role: string;
};

//
// User Stats
//
const VALID_MAP_IDS = Object.values(MapId)
    .filter((id) => typeof id === "number")
    .map((id) => id.toString()) as [string, ...string[]];

export const zUserStatsRequest = z.object({
    interval: z.enum(STATS_INTERVALS),
    slug: z.string().min(1),
    mapIdFilter: z.enum([ALL_MAPS, ...VALID_MAP_IDS]),
});

export type UserStatsRequest = z.infer<typeof zUserStatsRequest>;

export type UserStatsResponse = {
    slug: string;
    username: string;
    player_icon: string;
    banned: boolean;
    wins: number;
    kills: number;
    games: number;
    kpg: string;
    modes: Mode[];
};

export interface Mode {
    teamMode: number;
    games: number;
    wins: number;
    kills: number;
    winPct: string;
    mostKills: number;
    mostDamage: number;
    kpg: string;
    avgDamage: number;
    avgTimeAlive: number;
}

//
// Leaderboard
//
export const zLeaderboardsRequest = z.object({
    interval: z.enum(STATS_INTERVALS),
    mapId: z.enum(VALID_MAP_IDS).transform((v) => Number(v)),
    type: z.enum(LEADERBOARD_TYPES),
    teamMode: z.enum(TEAM_MODE_NAMES).transform((name) => TEAM_MODE_BY_NAME[name]),
});

export type LeaderboardResponse =
    & {
        val: number;
        region: string;
        /**
         * not used
         */
        active?: boolean;
        /**
         * required for all types except most_kills & win_streak
         */
        games?: number;
    }
    & (
        | {
            slug: string | null;
            username: string;
        }
        | {
            slugs: (string | null)[];
            usernames: string[];
        }
    );

export type LeaderboardRequest = z.infer<typeof zLeaderboardsRequest>;
/** what the client sends; the server maps teamMode/mapId to numbers */
export type LeaderboardParams = z.input<typeof zLeaderboardsRequest>;
