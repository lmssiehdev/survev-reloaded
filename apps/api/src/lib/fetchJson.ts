import { getLogger } from "@survev/logger/node.ts";
import { Result } from "better-result";
import { UpstreamError } from "./errors.ts";

const logger = getLogger(["api", "fetch"]);

/** POST/GET a JSON api with a timeout; a network error, timeout, non 2xx or bad json is an UpstreamError */
export async function fetchJson<T>(
    name: string,
    url: string | URL,
    { timeoutMs = 10_000, ...init }: RequestInit & { timeoutMs?: number } = {},
): Promise<Result<T, UpstreamError>> {
    // never log the url, it can hold api keys
    try {
        const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) {
            logger.warn("upstream.bad_status", { name, status: res.status });
            return Result.err(new UpstreamError({ message: `${name} responded ${res.status}` }));
        }
        return Result.ok(await res.json() as T);
    } catch (cause) {
        // bun fetch errors carry the full url in `path`, so log only these fields
        const { name: errName, message, code } = cause as { name?: string; message?: string; code?: string };
        logger.warn("upstream.request_failed", { name, err: { name: errName, message, code } });
        return Result.err(new UpstreamError({ message: `${name} request failed`, cause }));
    }
}
