export type SerializedError = {
    name: string;
    message: string;
    stack?: string;
    cause?: SerializedError | unknown;
    [key: string]: unknown;
};

const MAX_DEPTH = 6;

export function serializeError(err: unknown): SerializedError {
    return serializeErrorAt(err, 0, new WeakSet());
}

function serializeErrorAt(err: unknown, depth: number, seen: WeakSet<object>): SerializedError {
    if (!(err instanceof Error)) {
        return { name: "NonError", message: String(serializeAt(err, depth, seen)) };
    }
    seen.add(err);
    const out: SerializedError = { name: err.name, message: err.message };
    for (const [k, v] of Object.entries(err)) {
        if (k === "name" || k === "message" || k === "stack" || k === "cause") continue;
        out[k] = serializeAt(v, depth + 1, seen);
    }
    if (err.stack !== undefined) out.stack = err.stack;
    if (err.cause !== undefined) out.cause = serializeAt(err.cause, depth + 1, seen);
    seen.delete(err);
    return out;
}

function serializeAt(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (typeof value === "bigint") return value.toString();
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    if (depth > MAX_DEPTH) return "[MaxDepth]";
    if (value instanceof Error) return serializeErrorAt(value, depth, seen);
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();

    seen.add(value);
    let out: unknown;
    if (Array.isArray(value)) {
        out = value.map((v) => serializeAt(v, depth + 1, seen));
    } else {
        const obj: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            obj[k] = serializeAt(v, depth + 1, seen);
        }
        out = obj;
    }
    seen.delete(value);
    return out;
}

/** Errors (any depth, max 6) become plain objects, circular refs "[Circular]", bigint a string. */
export function serializeValue(value: unknown): unknown {
    return serializeAt(value, 0, new WeakSet());
}
