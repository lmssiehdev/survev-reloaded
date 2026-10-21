import { Hono } from "hono";
import { databaseEnabledMiddleware, rateLimitMiddleware } from "../../auth/middleware.ts";
import { leaderboardRouter } from "./leaderboard.ts";
import { matchDataRouter } from "./match_data.ts";
import { matchHistoryRouter } from "./match_history.ts";
import { UserStatsRouter } from "./user_stats.ts";

// one budget for all stats routes. use() is path scoped:
// StatsRouter is mounted on /api/, a bare use() would cover every /api route
const statsRateLimit = rateLimitMiddleware(40, 60 * 1000);
const routes = {
    "/user_stats": UserStatsRouter,
    "/match_history": matchHistoryRouter,
    "/match_data": matchDataRouter,
    "/leaderboard": leaderboardRouter,
};

export const StatsRouter = new Hono();

for (const [path, router] of Object.entries(routes)) {
    StatsRouter.use(path, databaseEnabledMiddleware, statsRateLimit);
    StatsRouter.route(path, router);
}
