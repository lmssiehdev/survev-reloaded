import { Config } from "@survev/config/serverConfig.ts";
import { type Loadout, loadout } from "@survev/shared/utils/loadout.ts";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
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

/**
 * Non-httpOnly hint the client reads to know it is logged in
 * without a request (apps/client/src/account.ts).
 */
const LOGGED_IN_HINT = "app-data";
const loggedInHintAttributes = { maxAge: 30 * DAY, path: "/", domain: cookieDomain };

export const MOCK_USER_ID = "MOCK_USER_ID";

/** GET /api/auth/mock: dev-only login as a fixed test account, no oauth keys needed */
const mockLogin = {
    id: "mock-login",
    endpoints: {
        mockLogin: createAuthEndpoint("/mock", { method: "GET" }, async (ctx) => {
            const adapter = ctx.context.internalAdapter;
            let user = await adapter.findUserById(MOCK_USER_ID);
            if (!user) {
                await db.insert(usersTable).values({
                    id: MOCK_USER_ID,
                    email: "mock@survev.local",
                    emailVerified: true,
                    username: MOCK_USER_ID,
                    slug: MOCK_USER_ID,
                }).onConflictDoNothing();
                await giveNewAccountItems(MOCK_USER_ID);
                user = await adapter.findUserById(MOCK_USER_ID);
            }
            const session = await adapter.createSession(user!.id);
            await setSessionCookie(ctx, { session, user: user! });
            ctx.setCookie(LOGGED_IN_HINT, "1", loggedInHintAttributes);
            throw ctx.redirect(clientUrl);
        }),
    },
} satisfies BetterAuthPlugin;

const { DISCORD_CLIENT_ID, DISCORD_SECRET_ID, GOOGLE_CLIENT_ID, GOOGLE_SECRET_ID } = Config.secrets;

/** keeps the redirect URIs already registered on the discord / google apps */
const legacyRedirectUri = (provider: string) => `${Config.oauthRedirectURI}/api/auth/${provider}/callback`;

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
                redirectURI: legacyRedirectUri("discord"),
                prompt: "none",
                requireEmailVerification: true,
            },
        }),
        ...(GOOGLE_CLIENT_ID && GOOGLE_SECRET_ID && {
            google: {
                clientId: GOOGLE_CLIENT_ID,
                clientSecret: GOOGLE_SECRET_ID,
                redirectURI: legacyRedirectUri("google"),
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

    hooks: {
        after: createAuthMiddleware(async (ctx) => {
            if (ctx.path.startsWith("/callback/") && ctx.context.newSession) {
                ctx.setCookie(LOGGED_IN_HINT, "1", loggedInHintAttributes);
            }
        }),
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

export const loggedInHint = { name: LOGGED_IN_HINT, attributes: loggedInHintAttributes };

/** better-auth only removes expired sessions when they are looked up again */
export async function deleteExpiredSessions() {
    await db.delete(sessionTable).where(lt(sessionTable.expiresAt, new Date()));
}
