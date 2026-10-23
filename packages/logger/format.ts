import type { LogRecord } from "@logtape/logtape";
import { serializeValue } from "./serialize.ts";

function renderPart(part: unknown): string {
    if (typeof part === "string") return part;
    if (part instanceof Error) return `${part.name}: ${part.message}`;
    if (part !== null && typeof part === "object") {
        return JSON.stringify(serializeValue(part));
    }
    return String(part);
}

export function renderMessage(message: readonly unknown[]): string {
    return message.map(renderPart).join("");
}

const RESERVED_KEYS = new Set(["_time", "level", "category", "message"]);

export function recordToJson(record: LogRecord): Record<string, unknown> {
    const props = serializeValue(record.properties) as Record<string, unknown>;
    // a prop named like a top-level field is kept as prop_<key> instead of being overwritten
    const safeProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
        safeProps[RESERVED_KEYS.has(key) ? `prop_${key}` : key] = value;
    }
    return {
        ...safeProps,
        _time: new Date(record.timestamp).toISOString(),
        level: record.level,
        category: record.category.join("."),
        message: renderMessage(record.message),
    };
}
