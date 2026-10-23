export type SerializedError = {
    name: string;
    message: string;
    stack?: string;
    cause?: SerializedError | unknown;
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
    if (value instanceof Date) return value.toISOString();

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
