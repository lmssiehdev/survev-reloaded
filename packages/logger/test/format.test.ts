import type { LogRecord } from "@logtape/logtape";
import { expect, test } from "bun:test";
import { recordToJson } from "../format.ts";
import { serializeError, serializeValue } from "../serialize.ts";

test("serializeError keeps name, message, stack and cause", () => {
    const s = serializeError(new Error("a", { cause: new Error("b") }));
    expect(s.name).toBe("Error");
    expect(s.message).toBe("a");
    expect(s.stack).toContain("a");
    expect((s.cause as { message: string }).message).toBe("b");
});

test("serializeValue converts nested errors", () => {
    const out = serializeValue({ nested: { err: new TypeError("x") } }) as {
        nested: { err: { name: string } };
    };
    expect(out.nested.err.name).toBe("TypeError");
});

test("serializeValue marks circular references and stringifies bigint", () => {
    const o: any = {};
    o.self = o;
    o.big = 5n;
    const out = serializeValue(o) as any;
    expect(out.self).toBe("[Circular]");
    expect(out.big).toBe("5");
});

test("recordToJson flattens the record", () => {
    const record: LogRecord = {
        category: ["survev", "api"],
        level: "error",
        message: ["failed ", 3, ""],
        rawMessage: "failed {n}",
        timestamp: Date.now(),
        properties: { userId: "u1", err: new Error("boom") },
    };
    const json = recordToJson(record) as any;
    expect(json.category).toBe("survev.api");
    expect(json.level).toBe("error");
    expect(json.message).toBe("failed 3");
    expect(json.userId).toBe("u1");
    expect(json.err.message).toBe("boom");
    expect(Number.isNaN(new Date(json._time).getTime())).toBe(false);
});

test("serializeValue does not throw on an invalid Date", () => {
    expect(serializeValue({ d: new Date("nope") })).toEqual({ d: "Invalid Date" });
});

test("serializeError keeps own enumerable properties", () => {
    const s = serializeError(Object.assign(new Error("x"), { code: "23505", detail: "dup" })) as any;
    expect(s.code).toBe("23505");
    expect(s.detail).toBe("dup");
    expect(s.message).toBe("x");
});
