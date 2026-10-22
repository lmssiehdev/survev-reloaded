// the single source for the stats filter values used by the client, the zod schemas and the server.
// kept apart from stats.ts so the client can use them without pulling in zod

import { GameConfig, TeamMode } from "../gameConfig.ts";

/** every team mode, in display order */
export const TEAM_MODES = [TeamMode.Solo, TeamMode.Duo, TeamMode.Squad] as const;

/** team mode by its name, as the leaderboard API and URLs spell it */
export const TEAM_MODE_BY_NAME = {
    [GameConfig.TeamModeToString[TeamMode.Solo]]: TeamMode.Solo,
    [GameConfig.TeamModeToString[TeamMode.Duo]]: TeamMode.Duo,
    [GameConfig.TeamModeToString[TeamMode.Squad]]: TeamMode.Squad,
} as const;
export type TeamModeName = keyof typeof TEAM_MODE_BY_NAME;
export const TEAM_MODE_NAMES = TEAM_MODES.map((mode) => GameConfig.TeamModeToString[mode]) as [
    TeamModeName,
    ...TeamModeName[],
];

/** sent by the client when the "all" team mode filter is selected (Solo | Duo | Squad) */
export const ALL_TEAM_MODES = 7;
export type TeamModeFilter = TeamMode | typeof ALL_TEAM_MODES;
/** match history team mode filters, in display order */
export const TEAM_MODE_FILTERS = [ALL_TEAM_MODES, ...TEAM_MODES] as const;

/** sent by the client when "all modes" is selected */
export const ALL_MAPS = "-1";

export const STATS_INTERVALS = ["daily", "weekly", "alltime"] as const;
export type StatsInterval = (typeof STATS_INTERVALS)[number];

export const LEADERBOARD_TYPES = ["most_kills", "most_damage_dealt", "kpg", "kills", "wins"] as const;
export type LeaderboardType = (typeof LEADERBOARD_TYPES)[number];
