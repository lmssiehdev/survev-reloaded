import { ServerLogger } from "@survev/config/utils/logger.ts";
import { Result, TaggedError } from "better-result";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const logger = new ServerLogger("API");

//
// expected failures, every route and helper returns these through a Result
//

export class InvalidParams extends TaggedError("InvalidParams")<{ message: string; issues?: unknown }> {}
export class Unauthorized extends TaggedError("Unauthorized")<{ message: string }> {}
export class Forbidden extends TaggedError("Forbidden")<{ message: string }> {}
export class NotFound extends TaggedError("NotFound")<{ message: string }> {}
export class Conflict extends TaggedError("Conflict")<{ message: string }> {}
export class RateLimited extends TaggedError("RateLimited")<{ message: string }> {}
/** a third party (region, turnstile, proxycheck) failed or timed out */
export class UpstreamError extends TaggedError("UpstreamError")<{ message: string; cause?: unknown }> {}
export class DatabaseError extends TaggedError("DatabaseError")<{ message: string; cause: unknown }> {}

export type ApiError =
    | InvalidParams
    | Unauthorized
    | Forbidden
    | NotFound
    | Conflict
    | RateLimited
    | UpstreamError
    | DatabaseError;

const statusByTag = {
    InvalidParams: 400,
    Unauthorized: 401,
    Forbidden: 403,
    NotFound: 404,
    Conflict: 409,
    RateLimited: 429,
    UpstreamError: 502,
    DatabaseError: 500,
} as const satisfies Record<ApiError["_tag"], ContentfulStatusCode>;

/** the one error body the API sends */
export interface ErrorBody {
    error: ApiError["_tag"] | "InternalError";
    message: string;
    issues?: unknown;
}

/** failures are logged where they happen (query, fetchResult), not here */
export function errorResponse(c: Context, error: ApiError) {
    const status = statusByTag[error._tag];
    return c.json<ErrorBody, typeof status>(
        { error: error._tag, message: error.message, ...("issues" in error && { issues: error.issues }) },
        status,
    );
}

/** ok: 200 with the value, err: the error body with the error's status */
export function respond<T>(c: Context, result: Result<T, ApiError>) {
    return result.isOk() ? c.json(result.value, 200) : errorResponse(c, result.error);
}

/** run a query (or transaction), a rejection is logged and becomes a DatabaseError */
export function query<T>(fn: () => Promise<T>, message = "Database query failed") {
    return Result.tryPromise({
        try: fn,
        catch: (cause) => {
            logger.error(message, cause);
            return new DatabaseError({ message, cause });
        },
    });
}

/** like query, a missing row is a NotFound */
export function queryOne<T>(fn: () => Promise<T | undefined>, notFound: string) {
    return query(fn).then(
        Result.andThen((value: T | undefined) =>
            value === undefined ? Result.err(new NotFound({ message: notFound })) : Result.ok(value)
        ),
    );
}

/**
 * a fetch that times out and never rejects; a non 2xx status is an UpstreamError too.
 * `retries` only retries network failures / timeouts, use it for idempotent requests only
 */
export function fetchResult(
    name: string,
    input: string | URL,
    init: RequestInit & { timeoutMs?: number; retries?: number } = {},
) {
    const { timeoutMs = 10_000, retries = 0, ...rest } = init;
    // never log the url, it can hold api keys
    return Result.tryPromise(
        {
            try: () => fetch(input, { ...rest, signal: AbortSignal.timeout(timeoutMs) }),
            catch: (cause) => new UpstreamError({ message: `${name} request failed`, cause }),
        },
        { retry: { times: retries, delayMs: 500, backoff: "exponential" } },
    )
        .then(Result.andThen((res: Response) =>
            res.ok
                ? Result.ok(res)
                : Result.err(new UpstreamError({ message: `${name} responded ${res.status}` }))
        ))
        .then(Result.tapError((err: UpstreamError) => logger.warn(err.message, err.cause ?? "")));
}

/** read a json body, a bad body is an UpstreamError */
export function readJson<T>(name: string, res: Response) {
    return Result.tryPromise({
        try: () => res.json() as Promise<T>,
        catch: (cause) => {
            logger.warn(`${name} sent invalid json`, cause);
            return new UpstreamError({ message: `${name} sent invalid json`, cause });
        },
    });
}
