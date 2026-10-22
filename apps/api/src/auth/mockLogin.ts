import { Config } from "@survev/config/serverConfig.ts";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

export const MOCK_USER_ID = "MOCK_USER_ID";

/** GET /api/auth/mock: dev-only login as a fixed test account, no oauth keys needed */
export const mockLogin = {
    id: "mock-login",
    endpoints: {
        mockLogin: createAuthEndpoint("/mock", { method: "GET" }, async (ctx) => {
            const adapter = ctx.context.internalAdapter;
            // created through the normal hooks, so it gets a generated name and the starter items
            const user = (await adapter.findUserById(MOCK_USER_ID))
                ?? (await adapter.createUser({
                    id: MOCK_USER_ID,
                    email: "mock@survev.local",
                    name: MOCK_USER_ID,
                    emailVerified: true,
                }, { method: "mock" }));
            const session = await adapter.createSession(user.id);
            await setSessionCookie(ctx, { session, user });
            throw ctx.redirect(Config.oauthBasePath);
        }),
    },
} satisfies BetterAuthPlugin;
