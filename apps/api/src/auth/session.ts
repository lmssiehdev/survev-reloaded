import { getLogger } from "@survev/logger/node.ts";
import { Elysia, type HTTPHeaders } from "elysia";
import { Unauthorized } from "../lib/errors.ts";
import { noteRequest } from "../lib/requestLog.ts";
import { auth, type AuthSession, type AuthUser } from "./auth.ts";

const logger = getLogger(["api", "auth"]);

/** adds the set-cookie headers of a better-auth api call to the response */
export function appendCookies(set: { headers: HTTPHeaders }, headers: Headers | undefined) {
    const cookies = headers?.getSetCookie() ?? [];
    if (cookies.length) {
        set.headers["set-cookie"] = [...(set.headers["set-cookie"] as string[] | undefined ?? []), ...cookies];
    }
}

/**
 * better-auth's session: `user` / `session`, null when logged out. A banned user still has one, routes check `user.banned`.
 * returnHeaders: getSession extends active sessions, the refreshed cookie has to reach the browser too.
 */
async function loadSession(request: Request, set: { headers: HTTPHeaders }) {
    const res = await auth.api
        .getSession({ headers: request.headers, returnHeaders: true })
        .catch((err) => void logger.error("auth.session_load_failed", { err }));

    appendCookies(set, res?.headers);
    const user: AuthUser | null = res?.response?.user ?? null;
    const session: AuthSession | null = res?.response?.session ?? null;
    noteRequest(request, { userId: user?.id });
    return { user, session };
}

export const session = new Elysia({ name: "session" })
    .macro({
        /** the session, null when logged out */
        session: {
            derive: ({ request, set }) => loadSession(request, set),
        },
        /** the session, 401 when logged out */
        auth: {
            async derive({ request, set }) {
                const { user, session } = await loadSession(request, set);
                if (!user || !session) {
                    throw new Unauthorized({ message: "Authentication failed" });
                }
                return { user, session };
            },
        },
    });
