// Two-tier replay parity gate: the fork (or any fork-layout tree) against upstream at the pinned
// commit, on the same Bun.
//   STRICT     defs, map generation, per-tick sim state, RNG call counts, grid query order
//   CANONICAL  every message each client receives, decoded, with fullObjects / partObjects /
//              delObjIds sorted by id (the client audit found order inside them invisible)
//   raw bytes  report only: Set iteration order on the server shows up here first
// usage: bun gate.ts [--tree <fork-layout root>] [--only a,b]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { UPSTREAM_SHA } from "./pin.ts";
import type { Checkpoint, Trace } from "./replay.ts";
import type { Scenario } from "./scenario.ts";
import { allScenarios } from "./scenarios.ts";
import { CACHE_DIR, ensureUpstreamTree, REPO_ROOT } from "./upstream.ts";

const HERE = import.meta.dir;
const STRICT_CHANNELS = ["state", "rng", "grid"] as const;

/** upstream traces only depend on the pin, Bun, and the harness itself */
function harnessKey(): string {
    const h = createHash("sha256").update(UPSTREAM_SHA).update(Bun.version).update(Bun.revision);
    for (const f of ["replay.ts", "hash.ts", "prelude.ts", "trees.ts", "scenarios.ts", "directed.ts", "ignored.ts"]) {
        h.update(readFileSync(join(HERE, f)));
    }
    return h.digest("hex").slice(0, 16);
}

async function runReplay(root: string, layout: "fork" | "upstream", s: Scenario, out: string): Promise<Trace> {
    const tmp = `${out}.${process.pid}.tmp`;
    const proc = Bun.spawn(["bun", join(HERE, "replay.ts"), root, layout, s.name, tmp], {
        // upstream reads and writes its config file next to its own config.ts; cwd is irrelevant
        cwd: layout === "upstream" ? root : REPO_ROOT,
        env: { ...process.env, PARITY_SEED: String(s.seed) },
        stdout: "pipe",
        stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code !== 0) throw new Error(`parity: ${layout} replay of ${s.name} exited ${code}\n${stderr.slice(-4000)}`);
    renameSync(tmp, out);
    return JSON.parse(readFileSync(out, "utf8"));
}

async function limit<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
    const out: T[] = new Array(jobs.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(n, jobs.length) }, async () => {
            while (next < jobs.length) {
                const i = next++;
                out[i] = await jobs[i]();
            }
        }),
    );
    return out;
}

export interface ScenarioResult {
    scenario: string;
    /** empty when STRICT holds */
    strict: string[];
    /** empty when CANONICAL holds */
    canonical: string[];
    /** report only */
    raw: string | undefined;
    /** expected coverage counters that stayed at 0 */
    uncovered: string[];
    coverage: Record<string, number>;
    wallMs: { fork: number; upstream: number };
}

function firstDiff(a: Checkpoint[], b: Checkpoint[], k: keyof Checkpoint): string | undefined {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        if (a[i][k] !== b[i][k]) {
            const from = i === 0 ? 0 : a[i - 1].tick + 1;
            return `${k} differs in ticks ${from}..${a[i].tick}`;
        }
    }
    return a.length === b.length ? undefined : `${k}: ${a.length} vs ${b.length} checkpoints`;
}

export function compare(s: Scenario, fork: Trace, up: Trace): ScenarioResult {
    const strict: string[] = [];
    if (fork.defs !== up.defs) strict.push("definitions (GameConfig, object/map defs) differ");
    if (fork.map !== up.map) strict.push("map generation output differs");
    if (fork.ticksRun !== up.ticksRun) strict.push(`ran ${fork.ticksRun} ticks, upstream ${up.ticksRun}`);
    for (const k of STRICT_CHANNELS) {
        const d = firstDiff(fork.checkpoints, up.checkpoints, k)
            ?? (fork.final[k] !== up.final[k] ? `${k} differs after the last checkpoint` : undefined);
        if (d) strict.push(d);
    }
    const canonical: string[] = [];
    const c = firstDiff(fork.checkpoints, up.checkpoints, "canon")
        ?? (fork.final.canon !== up.final.canon ? "canon differs after the last checkpoint" : undefined);
    if (c) canonical.push(`wire ${c}`);
    const raw = firstDiff(fork.checkpoints, up.checkpoints, "raw")
        ?? (fork.final.raw !== up.final.raw ? "raw differs after the last checkpoint" : undefined);
    return {
        scenario: s.name,
        strict,
        canonical,
        raw,
        uncovered: (s.expect ?? []).filter((k) => !fork.coverage[k]),
        coverage: fork.coverage,
        wallMs: { fork: fork.wallMs, upstream: up.wallMs },
    };
}

export interface GateOptions {
    /** fork-layout tree to check, default the repo itself */
    tree?: string;
    scenarios?: Scenario[];
    jobs?: number;
}

export async function runGate(opts: GateOptions = {}): Promise<ScenarioResult[]> {
    const tree = opts.tree ?? REPO_ROOT;
    const scenarios = opts.scenarios ?? allScenarios;
    const jobs = opts.jobs ?? Number(process.env.PARITY_JOBS ?? Math.max(1, Math.min(8, availableParallelism() - 1)));
    const upstreamRoot = ensureUpstreamTree();
    const traceDir = join(CACHE_DIR, "traces", harnessKey());
    const forkDir = join(CACHE_DIR, "runs", createHash("sha256").update(tree).digest("hex").slice(0, 12));
    mkdirSync(traceDir, { recursive: true });
    mkdirSync(forkDir, { recursive: true });

    const work: (() => Promise<Trace>)[] = [];
    for (const s of scenarios) {
        const cached = join(traceDir, `${s.name}.json`);
        work.push(() =>
            existsSync(cached)
                ? Promise.resolve(JSON.parse(readFileSync(cached, "utf8")))
                : runReplay(upstreamRoot, "upstream", s, cached)
        );
        work.push(() => runReplay(tree, "fork", s, join(forkDir, `${s.name}.json`)));
    }
    const traces = await limit(work, jobs);
    return scenarios.map((s, i) => compare(s, traces[2 * i + 1], traces[2 * i]));
}

export function formatResults(results: ScenarioResult[]): string {
    const lines: string[] = [];
    for (const r of results) {
        const verdict = r.strict.length ? "STRICT FAIL" : r.canonical.length ? "CANONICAL FAIL" : "pass";
        lines.push(
            `${r.scenario.padEnd(22)} ${verdict.padEnd(15)} raw: ${r.raw ?? "identical"}  (${
                (r.wallMs.fork / 1000).toFixed(0)
            }s)`,
        );
        for (const d of [...r.strict, ...r.canonical]) lines.push(`    ${d}`);
        if (r.uncovered.length) lines.push(`    coverage missing: ${r.uncovered.join(", ")}`);
    }
    return lines.join("\n");
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const tree = args.includes("--tree") ? args[args.indexOf("--tree") + 1] : undefined;
    const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : undefined;
    const scenarios = only ? allScenarios.filter((s) => only.includes(s.name)) : undefined;
    const results = await runGate({ tree, scenarios });
    console.log(formatResults(results));
    if (args.includes("--json")) console.log(JSON.stringify(results));
    process.exit(results.some((r) => r.strict.length || r.canonical.length || r.uncovered.length) ? 1 : 0);
}
