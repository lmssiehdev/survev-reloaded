import { query } from "@solidjs/router";
import type {
    LeaderboardParams,
    MatchDataRequest,
    MatchHistoryParams,
    UserStatsRequest,
} from "@survev/shared/types/stats.ts";
import { client } from "../api.ts";
import { helpers } from "../helpers.ts";

/** the data of an Eden call, which throws on a failed request or an error status */
async function data<T>(call: Promise<{ data: T; error: unknown }>): Promise<T> {
    const { data, error } = await call;
    if (error) throw error;
    return data;
}

const timeout = () => ({ fetch: { signal: helpers.abortSignal(10_000) } });

export const getLeaderboard = query(
    (params: LeaderboardParams) => data(client.leaderboard.post(params, timeout())),
    "leaderboard",
);

/** null when the player doesn't exist */
export const getUserStats = query(
    (params: UserStatsRequest) => data(client.user_stats.post(params, timeout())),
    "userStats",
);

export const getMatchHistory = query(
    (params: MatchHistoryParams) => data(client.match_history.post(params, timeout())),
    "matchHistory",
);

export const getMatchData = query(
    (params: MatchDataRequest) => data(client.match_data.post(params, timeout())),
    "matchData",
);
