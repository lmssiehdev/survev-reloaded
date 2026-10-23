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

export function recordToJson(record: LogRecord): Record<string, unknown> {
    return {
        ...(serializeValue(record.properties) as Record<string, unknown>),
        _time: new Date(record.timestamp).toISOString(),
        level: record.level,
        category: record.category.join("."),
        message: renderMessage(record.message),
    };
}
