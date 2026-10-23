import { reset } from "@logtape/logtape";
import { afterEach, expect, spyOn, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flushLogs, getLogger, setupLogging, withContext } from "../index.ts";
import { setupServerLogging } from "../node.ts";

type Line = Record<string, unknown>;

function fakeFetch() {
    const lines: Line[] = [];
    const fn = (async (_url: string, init: RequestInit) => {
        for (const l of (init.body as string).split("\n").filter(Boolean)) {
            lines.push(JSON.parse(l));
        }
        return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    return { lines, fn };
}

const base = { app: "api", env: "dev", git: "abc", console: false } as const;

async function setup(level: "debug" | "info" | "warning" | "error", extra: { region?: string } = {}) {
    const f = fakeFetch();
    await setupLogging({
        ...base,
        ...extra,
        level,
        format: "json",
        contextLocalStorage: new AsyncLocalStorage(),
        axiom: { token: "t", dataset: "d", fetch: f.fn, flushIntervalMs: 10 },
    });
    return f;
}

afterEach(async () => {
    await reset();
});

test("records carry static props; region only when given", async () => {
    const a = await setup("info");
    getLogger(["t"]).info("hello");
    await flushLogs();
    expect(a.lines).toHaveLength(1);
    expect(a.lines[0]).toMatchObject({ app: "api", env: "dev", git: "abc", message: "hello", category: "survev.t" });
    expect("region" in a.lines[0]).toBe(false);
    await reset();

    const b = await setup("info", { region: "eu" });
    getLogger(["t"]).info("hello");
    await flushLogs();
    expect(b.lines[0].region).toBe("eu");
});

test("setupServerLogging adds numeric pid", async () => {
    const f = fakeFetch();
    await setupServerLogging({
        ...base,
        level: "info",
        format: "json",
        axiom: { token: "t", dataset: "d", fetch: f.fn },
    });
    getLogger(["t"]).info("hello");
    await flushLogs();
    expect(f.lines[0].pid).toBe(process.pid);
    expect(f.lines[0].app).toBe("api");
});

test("below-level records buffer per gameId and replay before a warning+ in the same game", async () => {
    const f = await setup("info");
    const log = getLogger(["game"]);
    log.with({ gameId: "g1" }).debug("d1");
    log.with({ gameId: "g2" }).debug("d2");
    log.info("plain-info");
    log.with({ gameId: "g1" }).error("e1");
    await flushLogs();
    expect(f.lines.map((l) => l.message)).toEqual(["plain-info", "d1", "e1"]);
    // replayed records carry static props too
    expect(f.lines[1]).toMatchObject({ app: "api", gameId: "g1", level: "debug" });
});

test("a lone below-level record is not shipped", async () => {
    const f = await setup("info");
    getLogger(["game"]).with({ gameId: "g1" }).debug("d1");
    await flushLogs();
    expect(f.lines).toHaveLength(0);
});

test("withContext requestId isolates buffers too", async () => {
    const f = await setup("info");
    const log = getLogger(["http"]);
    withContext({ requestId: "r1" }, () => log.debug("r1-debug"));
    withContext({ requestId: "r2" }, () => log.debug("r2-debug"));
    withContext({ requestId: "r1" }, () => log.warn("r1-warn"));
    await flushLogs();
    expect(f.lines.map((l) => l.message)).toEqual(["r1-debug", "r1-warn"]);
    expect(f.lines[0].requestId).toBe("r1");
});

test("buffering resumes after a trigger and records are never emitted twice", async () => {
    const f = await setup("info");
    const g = getLogger(["game"]).with({ gameId: "g1" });
    g.debug("d1");
    g.error("e1");
    g.debug("d2");
    g.info("i1");
    await flushLogs();
    expect(f.lines.map((l) => l.message)).toEqual(["d1", "e1", "i1"]);
});

test("level debug passes debug immediately", async () => {
    const f = await setup("debug");
    getLogger(["game"]).with({ gameId: "g1" }).debug("d1");
    await flushLogs();
    expect(f.lines.map((l) => l.message)).toEqual(["d1"]);
});

test("no axiom and console off: no fetch calls", async () => {
    const spy = spyOn(globalThis, "fetch");
    try {
        await setupLogging({ ...base, level: "debug", format: "json" });
        getLogger(["t"]).error("x");
        await flushLogs();
        expect(spy).not.toHaveBeenCalled();
    } finally {
        spy.mockRestore();
    }
});

test("flushLogs is bounded when the axiom fetch hangs", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const hang = (async () => {
            await gate;
            return new Response(null, { status: 200 });
        }) as unknown as typeof fetch;
        await setupLogging({
            ...base,
            level: "info",
            format: "json",
            axiom: { token: "t", dataset: "d", fetch: hang, flushIntervalMs: 10 },
        });
        getLogger(["t"]).info("x");
        const t0 = Date.now();
        await flushLogs();
        const took = Date.now() - t0;
        expect(took).toBeGreaterThanOrEqual(2900);
        expect(took).toBeLessThan(4500);
        // let the abandoned dispose finish so reset() in afterEach can run
        release();
        await new Promise((r) => setTimeout(r, 50));
    } finally {
        errSpy.mockRestore();
    }
}, 10_000);

test("index.ts stays browser-safe", () => {
    const src = readFileSync(join(import.meta.dir, "..", "index.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']node:/);
    expect(src).not.toContain("process.");
});

test("crash handler logs process.crash as JSON on stdout and exits 1", async () => {
    const proc = Bun.spawn(["bun", join(import.meta.dir, "fixtures", "rejects.ts")], {
        stdout: "pipe",
        stderr: "pipe",
    });
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    expect(code).toBe(1);
    const lines = out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line);
    const crash = lines.find((l) => l.message === "process.crash");
    expect(crash).toBeDefined();
    expect(crash).toMatchObject({ kind: "rejection", level: "fatal", app: "api" });
    expect((crash!.err as { message: string }).message).toBe("nope");
    expect(typeof crash!.pid).toBe("number");
});
