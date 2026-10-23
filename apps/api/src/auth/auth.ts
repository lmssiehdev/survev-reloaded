import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { type Loadout, loadout } from "@survev/shared/utils/loadout.ts";
import { betterAuth } from "better-auth";
import { db } from "../db/index.ts";
import { relations } from "../db/relations.ts";
import { accounts, sessions, users, verifications } from "../db/schema.ts";
import { env } from "../env.ts";
import { generateUsername, giveNewAccountItems } from "../user/users.ts";
import { mockLogin } from "./mockLogin.ts";

const DAY = 60 * 60 * 24;

/** where the client lives; login flows always end there */
const clientUrl = env.CLIENT_URL;

/** set when the client is on another subdomain than the API, so cookies are shared */
const cookieDomain = URL.canParse(clientUrl) ? new URL(clientUrl).hostname : undefined;

const { DISCORD_CLIENT_ID, DISCORD_SECRET_ID } = env;

export const auth = betterAuth({
    appName: "survev",
    baseURL: env.PUBLIC_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [
        ...new Set([new URL(env.PUBLIC_URL).origin, ...(cookieDomain ? [new URL(clientUrl).origin] : [])]),
    ],
    telemetry: { enabled: false },
    // routes are already behind our own rateLimitMiddleware
    rateLimit: { enabled: false },

    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            user: users,
            session: sessions,
            account: accounts,
            verification: verifications,
            ...relations,
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
        // session + user in one query (uses the drizzle relations)
        database: { joins: true },
        ...(cookieDomain && { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }),
        ...(env.PROXY_IP_HEADER && {
            ipAddress: { ipAddressHeaders: [env.PROXY_IP_HEADER] },
        }),
    },

    onAPIError: { errorURL: clientUrl },

    plugins: env.ALLOW_MOCK_ACCOUNT ? [mockLogin] : [],
});

export type AuthUser = typeof auth.$Infer.Session.user;
export type AuthSession = typeof auth.$Infer.Session.session;
