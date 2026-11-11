import { treaty } from "@elysia/eden";
import type { PublicRouteApp } from "@survev/api/types";
import type { SiteInfoRes } from "@survev/shared/types/api.ts";

/** the API's origin (VITE_API_URL) when it isn't the one the client is served from */
const apiUrl = import.meta.env.VITE_API_URL || "";

export const api = {
    resolveUrl(url: string) {
        return apiUrl + url;
    },
    resolveRoomHost() {
        return apiUrl ? new URL(apiUrl).host : window.location.host;
    },

    /** login methods the API has set up, filled in by site_info */
    logins: { discord: false, mock: false } as SiteInfoRes["logins"],

    loginSupported(type: keyof SiteInfoRes["logins"]) {
        return api.logins[type];
    },
    anyLoginSupported() {
        return api.logins.discord || api.logins.mock;
    },
    /** cookies only go out when logins work, a client served from another domain can't send them */
    credentials(): RequestCredentials {
        return api.anyLoginSupported() ? "include" : "omit";
    },
};

/** the API's JSON routes, typed from the server's routes */
export const client = treaty<PublicRouteApp>(api.resolveUrl(""), {
    // the url is relative when the API is on the same host
    keepDomain: true,
    // a fetcher, not fetch: { credentials }: api.credentials() changes once site_info loads
    fetcher: ((input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, credentials: api.credentials() })) as typeof fetch,
}).api;
