import { query } from "@solidjs/router";
import type {
    LeaderboardParams,
    LeaderboardResponse,
    MatchDataRequest,
    MatchDataResponse,
    MatchHistoryParams,
    MatchHistoryResponse,
    UserStatsRequest,
    UserStatsResponse,
} from "@survev/shared/types/stats.ts";
import { api } from "../api.ts";

async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(api.resolveUrl(`/api/${path}`), {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
        throw new Error(`/api/${path} failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
}

export const getLeaderboard = query(
    (params: LeaderboardParams) => post<LeaderboardResponse[] | null>("leaderboard", params),
    "leaderboard",
);

/** null when the player doesn't exist */
export const getUserStats = query(
    (params: UserStatsRequest) => post<UserStatsResponse | null>("user_stats", params),
    "userStats",
);

export const getMatchHistory = query(
    (params: MatchHistoryParams) => post<MatchHistoryResponse | null>("match_history", params),
    "matchHistory",
);

export const getMatchData = query(
    (params: MatchDataRequest) => post<MatchDataResponse | null>("match_data", params),
    "matchData",
);
