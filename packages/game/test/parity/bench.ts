// Paired replay benchmark of two fork-layout trees (a base and a candidate) on Bun's JIT.
// usage: bun bench.ts --base <root> --cand <root> [--pairs 3] [--scenario bench-solo]
//        [--cores 8-11] [--json out.json]
// Builds each tree the way production does (bundled, STRIP_FROM_PROD_SERVER removed,
// NODE_ENV=production) and runs the bundle with the Bun running this script. Runs alternate
// base/candidate per pair, pinned to the given cores, holding a lock so parallel benches never
// share cores. Every timing run is a replay with hashing off.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { CACHE_DIR } from "./upstream.ts";

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const base = arg("--base");
const cand = arg("--cand");
const pairs = Number(arg("--pairs", "3"));
const scenario = arg("--scenario", "bench-solo")!;
const cores = arg("--cores", "8-11")!;
const BUN = process.execPath;
const LOCK = join(CACHE_DIR, "bench.lock");

if (!base || !cand) {
    console.error("usage: bun bench.ts --base <root> --cand <root> [--pairs 3]");
    process.exit(2);
}

const stripPlugin = {
    name: "strip-prod-server",
    setup(b: any) {
        const re = /\/\* ?STRIP_FROM_PROD_SERVER:START ?\*\/[\s\S]*?\/\* ?STRIP_FROM_PROD_SERVER:END ?\*\//g;
        b.onLoad({ filter: /\.[jt]sx?$/ }, async ({ path }: { path: string }) => ({
            contents: (await Bun.file(path).text()).replace(re, ""),
            loader: extname(path).slice(1) as "ts",
        }));
    },
};

/** entry with static imports, so the bundler sees the whole game */
function writeEntry(root: string, dir: string) {
    const p = (f: string) => JSON.stringify(join(root, f));
    const h = (f: string) => JSON.stringify(join(import.meta.dir, f));
    const entry = join(dir, "entry.ts");
    writeFileSync(
        entry,
        `import ${h("prelude.ts")};
import { Game } from ${p("packages/game/game.ts")};
import { defaultGameOptions } from ${p("packages/game/gameOptions.ts")};
import { ClientSocket } from ${p("packages/game/socket.ts")};
import * as net from ${p("packages/shared/net/net.ts")};
import { GameConfig } from ${p("packages/shared/gameConfig.ts")};
import { forkTree } from ${h("trees.ts")};
import { replayLoaded } from ${h("replay.ts")};
import { findScenario } from ${h("scenarios.ts")};
const s = findScenario(${JSON.stringify(scenario)});
const r = await replayLoaded(forkTree({ Game, defaultGameOptions, ClientSocket, net, GameConfig, defs: {} }), "fork", s, { timing: true });
console.log(JSON.stringify(r.timing));
process.exit(0);
`,
    );
    return entry;
}

async function build(root: string, tag: string) {
    const dir = join(CACHE_DIR, "bench", tag);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const entry = writeEntry(root, dir);
    const o = {
        target: "bun" as const,
        format: "esm" as const,
        minify: { syntax: true, whitespace: false, identifiers: false },
        define: { "process.env.NODE_ENV": "'production'" },
        plugins: [stripPlugin],
        entrypoints: [entry],
    };
    const r = await Bun.build({ ...o, outdir: join(dir, "out"), naming: "[name].[ext]" });
    if (!r.success) throw new AggregateError(r.logs, `bench: build of ${root} failed`);
    return [BUN, join(dir, "out/entry.js")];
}

interface Timing {
    steadyUpd: number;
    steadySync: number;
    p50: number;
    p99: number;
    max: number;
    rssMb: number;
}

function run(cmd: string[]): Timing {
    const r = Bun.spawnSync(["flock", LOCK, "taskset", "-c", cores, ...cmd], {
        env: { ...process.env, PARITY_SEED: "1" },
        stdout: "pipe",
        stderr: "inherit",
    });
    if (r.exitCode !== 0) throw new Error(`bench: ${cmd.join(" ")} exited ${r.exitCode}`);
    const lines = r.stdout.toString().trim().split("\n");
    return JSON.parse(lines[lines.length - 1]);
}

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const builds = { base: await build(base, "base"), cand: await build(cand, "cand") };
const A: Timing[] = [];
const B: Timing[] = [];
for (let i = 0; i < pairs; i++) {
    A.push(run(builds.base));
    B.push(run(builds.cand));
}
const row: Record<string, string> = {};
for (const k of ["steadyUpd", "steadySync", "p50", "p99", "max", "rssMb"] as const) {
    const a = median(A.map((x) => x[k]));
    const b = median(B.map((x) => x[k]));
    row[k] = `${a.toFixed(3)} -> ${b.toFixed(3)} (${((b / a - 1) * 100).toFixed(1)}%)`;
}
console.log(JSON.stringify(row));
if (arg("--json")) writeFileSync(arg("--json")!, JSON.stringify({ summary: row, base: A, cand: B }, null, 2));
