import { createAuthClient } from "better-auth/client";
import { api } from "./api.ts";

/** better-auth's own client for its /api/auth endpoints (sign in, sign out) */
export const authClient = createAuthClient({
    baseURL: new URL(api.resolveUrl("/api/auth"), window.location.href).href,
    fetchOptions: { credentials: "include" },
});

/** redirects to discord, which sends the player back to this page */
export function signInWithDiscord() {
    const back = window.location.origin + window.location.pathname;
    return authClient.signIn.social({ provider: "discord", callbackURL: back, errorCallbackURL: back });
}
