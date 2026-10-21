import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { Config } from "@survev/config/serverConfig.ts";
import { type Loadout, loadout } from "@survev/shared/utils/loadout.ts";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { lt } from "drizzle-orm";
import { db } from "../db/index.ts";
import { accountTable, sessionTable, usersTable, verificationTable } from "../db/schema.ts";
import { generateUsername, giveNewAccountItems } from "./users.ts";

const DAY = 60 * 60 * 24;

/** where the client lives; login flows always end there */
const clientUrl = Config.oauthBasePath;

/** set when the client is on another subdomain than the API, so cookies are shared */
const cookieDomain = URL.canParse(clientUrl) ? new URL(clientUrl).hostname : undefined;

export const MOCK_USER_ID = "MOCK_USER_ID";

/** GET /api/auth/mock: dev-only login as a fixed test account, no oauth keys needed */
const mockLogin = {
    id: "mock-login",
    endpoints: {
        mockLogin: createAuthEndpoint("/mock", { method: "GET" }, async (ctx) => {
            const users = ctx.context.internalAdapter;
            // created through the normal hooks, so it gets a generated name and the starter items
            const user = (await users.findUserById(MOCK_USER_ID))
                ?? (await users.createUser({
                    id: MOCK_USER_ID,
                    email: "mock@survev.local",
                    name: MOCK_USER_ID,
                    emailVerified: true,
                }, { method: "mock" }));
            const session = await users.createSession(user.id);
            await setSessionCookie(ctx, { session, user });
            throw ctx.redirect(clientUrl);
        }),
    },
} satisfies BetterAuthPlugin;

const { DISCORD_CLIENT_ID, DISCORD_SECRET_ID, GOOGLE_CLIENT_ID, GOOGLE_SECRET_ID } = Config.secrets;

export const auth = betterAuth({
    appName: "survev",
    baseURL: Config.oauthRedirectURI,
    basePath: "/api/auth",
    secret: Config.secrets.BETTER_AUTH_SECRET,
    trustedOrigins: [
        ...new Set([new URL(Config.oauthRedirectURI).origin, ...(cookieDomain ? [new URL(clientUrl).origin] : [])]),
    ],
    telemetry: { enabled: false },
    // routes are already behind our own rateLimitMiddleware
    rateLimit: { enabled: false },

    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            user: usersTable,
            session: sessionTable,
            account: accountTable,
            verification: verificationTable,
        },
    }),

    socialProviders: {
        ...(DISCORD_CLIENT_ID && DISCORD_SECRET_ID && {
            discord: {
                clientId: DISCORD_CLIENT_ID,
                clientSecret: DISCORD_SECRET_ID,
                prompt: "none",
                requireEmailVerification: true,
            },
        }),
        ...(GOOGLE_CLIENT_ID && GOOGLE_SECRET_ID && {
            google: {
                clientId: GOOGLE_CLIENT_ID,
                clientSecret: GOOGLE_SECRET_ID,
                // no profile scope: we never use the google name or picture
                disableDefaultScope: true,
                scope: ["openid", "email"],
                requireEmailVerification: true,
            },
        }),
    },

    user: {
        fields: {
            name: "username",
            createdAt: "userCreated",
        },
        additionalFields: {
            // set by the user.create.before hook below
            slug: { type: "string", required: true, input: false, defaultValue: "" },
            banned: { type: "boolean", required: true, input: false, defaultValue: false },
            banReason: { type: "string", required: true, input: false, defaultValue: "" },
            bannedBy: { type: "string", required: true, input: false, defaultValue: "" },
            usernameSet: { type: "boolean", required: true, input: false, defaultValue: false },
            lastUsernameChangeTime: { type: "date", required: false, input: false },
            loadout: {
                type: "json",
                required: true,
                input: false,
                defaultValue: () => loadout.validate({} as Loadout),
            },
        },
    },

    session: {
        expiresIn: 30 * DAY,
        // extend the session once it is past its halfway point
        updateAge: 15 * DAY,
    },

    account: {
        encryptOAuthTokens: true,
        accountLinking: { enabled: true, trustedProviders: ["discord", "google"] },
    },

    databaseHooks: {
        user: {
            create: {
                // never take names or avatars from the provider
                before: async (user) => {
                    const { username, slug } = await generateUsername();
                    return { data: { ...user, name: username, slug, image: null } };
                },
                after: async (user) => {
                    await giveNewAccountItems(user.id);
                },
            },
        },
    },

    advanced: {
        cookiePrefix: "survev",
        ...(cookieDomain && { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }),
        ...(Config.apiServer.proxyIPHeader && {
            ipAddress: { ipAddressHeaders: [Config.apiServer.proxyIPHeader] },
        }),
    },

    onAPIError: { errorURL: clientUrl },

    plugins: Config.debug.allowMockAccount ? [mockLogin] : [],
});

export type AuthUser = typeof auth.$Infer.Session.user;
export type AuthSession = typeof auth.$Infer.Session.session;

export type SocialProvider = "discord" | "google";

export function isProviderEnabled(provider: SocialProvider) {
    return provider === "discord"
        ? !!(DISCORD_CLIENT_ID && DISCORD_SECRET_ID)
        : !!(GOOGLE_CLIENT_ID && GOOGLE_SECRET_ID);
}

/** better-auth only removes expired sessions when they are looked up again */
export async function deleteExpiredSessions() {
    await db.delete(sessionTable).where(lt(sessionTable.expiresAt, new Date()));
}
