import { getLogger } from "@survev/logger/node.ts";
import { Result, TaggedError } from "better-result";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const logger = getLogger(["api", "errors"]);

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

/** failures are logged where they happen (query, fetchJson), not here */
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
            logger.error("db.query_failed", { message, err: cause });
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
