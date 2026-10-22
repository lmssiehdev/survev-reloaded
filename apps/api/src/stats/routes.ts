import { Hono } from "hono";
import { rateLimitMiddleware } from "../lib/middleware.ts";
import { leaderboardRouter } from "./leaderboard.ts";
import { matchDataRouter } from "./matchData.ts";
import { matchHistoryRouter } from "./matchHistory.ts";
import { UserStatsRouter } from "./userStats.ts";

// one budget for all stats routes. use() is path scoped:
// StatsRouter is mounted on /api/, a bare use() would cover every /api route
const statsRateLimit = rateLimitMiddleware(40, 60 * 1000);

export const StatsRouter = new Hono()
    .use("/user_stats", statsRateLimit)
    .route("/user_stats", UserStatsRouter)
    .use("/match_history", statsRateLimit)
    .route("/match_history", matchHistoryRouter)
    .use("/match_data", statsRateLimit)
    .route("/match_data", matchDataRouter)
    .use("/leaderboard", statsRateLimit)
    .route("/leaderboard", leaderboardRouter);
