import type { LogRecord } from "@logtape/logtape";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createAxiomSink } from "../axiomSink.ts";

function rec(n: number): LogRecord {
    return {
        category: ["survev", "test"],
        level: "info",
        message: [`m${n}`],
        rawMessage: `m${n}`,
        timestamp: Date.now(),
        properties: {},
    };
}

type Call = { url: string; init: RequestInit };

function fakeFetch(status = 200, gate?: Promise<void>) {
    const calls: Call[] = [];
    const fn = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (gate) await gate;
        return new Response(null, { status });
    }) as unknown as typeof fetch;
    return { calls, fn };
}

const lines = (c: Call) =>
    (c.init.body as string)
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let errSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
    errSpy = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

test("ships queued records as one NDJSON batch on the interval", async () => {
    const f = fakeFetch();
    const sink = createAxiomSink({ token: "tok", dataset: "ds", fetch: f.fn, flushIntervalMs: 20 });
    sink(rec(1));
    sink(rec(2));
    sink(rec(3));
    await sleep(50);
    expect(f.calls.length).toBe(1);
    expect(f.calls[0].url).toBe("https://api.axiom.co/v1/datasets/ds/ingest");
    const headers = f.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBe("application/x-ndjson");
    expect(lines(f.calls[0]).map((l) => l.message)).toEqual(["m1", "m2", "m3"]);
    await sink[Symbol.asyncDispose]();
});

test("uses a custom baseUrl", async () => {
    const f = fakeFetch();
    const sink = createAxiomSink({
        token: "t",
        dataset: "ds",
        baseUrl: "https://eu.example.com",
        fetch: f.fn,
    });
    sink(rec(1));
    await sink[Symbol.asyncDispose]();
    expect(f.calls[0].url).toBe("https://eu.example.com/v1/datasets/ds/ingest");
});

test("flushes when batchSize is reached without waiting for the timer", async () => {
    const f = fakeFetch();
    const sink = createAxiomSink({
        token: "t",
        dataset: "ds",
        fetch: f.fn,
        batchSize: 2,
        flushIntervalMs: 60_000,
    });
    sink(rec(1));
    sink(rec(2));
    await sleep(5);
    expect(f.calls.length).toBe(1);
    expect(lines(f.calls[0]).length).toBe(2);
    await sink[Symbol.asyncDispose]();
});

test("overflow drops oldest and reports logger.dropped", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = fakeFetch(200, gate);
    const sink = createAxiomSink({
        token: "t",
        dataset: "ds",
        fetch: f.fn,
        maxQueue: 3,
        flushIntervalMs: 60_000,
    });
    for (let i = 1; i <= 5; i++) sink(rec(i));
    const disposed = sink[Symbol.asyncDispose]();
    await sleep(5);
    release();
    await disposed;
    const shipped = f.calls.flatMap(lines);
    expect(shipped[0].message).toBe("logger.dropped");
    expect(shipped[0].level).toBe("warning");
    expect(shipped[0].dropped).toBe(2);
    expect(shipped.slice(1).map((l) => l.message)).toEqual(["m3", "m4", "m5"]);
});

test("non-2xx is reported once and later records still ship", async () => {
    let status = 500;
    const calls: Call[] = [];
    const fn = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status });
    }) as unknown as typeof fetch;
    const sink = createAxiomSink({ token: "t", dataset: "ds", fetch: fn, batchSize: 1 });
    sink(rec(1));
    await sleep(5);
    expect(errSpy).toHaveBeenCalledTimes(1);
    status = 200;
    sink(rec(2));
    await sleep(5);
    expect(calls.length).toBe(2);
    expect(lines(calls[1])[0].message).toBe("m2");
    await sink[Symbol.asyncDispose]();
});

test("a throwing fetch never escapes the sink", async () => {
    const fn = (async () => {
        throw new Error("net down");
    }) as unknown as typeof fetch;
    const sink = createAxiomSink({ token: "t", dataset: "ds", fetch: fn, batchSize: 1 });
    expect(() => sink(rec(1))).not.toThrow();
    await sleep(5);
    expect(errSpy).toHaveBeenCalled();
    await sink[Symbol.asyncDispose]();
});

test("asyncDispose flushes remaining records before resolving", async () => {
    const f = fakeFetch();
    const sink = createAxiomSink({ token: "t", dataset: "ds", fetch: f.fn, flushIntervalMs: 60_000 });
    sink(rec(1));
    await sink[Symbol.asyncDispose]();
    expect(f.calls.length).toBe(1);
});
