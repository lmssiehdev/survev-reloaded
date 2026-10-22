import { ServerLogger } from "@survev/config/utils/logger.ts";
import { Result } from "better-result";
import { UpstreamError } from "./errors.ts";

const logger = new ServerLogger("API");

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
            logger.warn(`${name} responded ${res.status}`);
            return Result.err(new UpstreamError({ message: `${name} responded ${res.status}` }));
        }
        return Result.ok(await res.json() as T);
    } catch (cause) {
        logger.warn(`${name} request failed`, cause);
        return Result.err(new UpstreamError({ message: `${name} request failed`, cause }));
    }
}
