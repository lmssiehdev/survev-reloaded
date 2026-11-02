import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { UPSTREAM_SHA, UPSTREAM_URL } from "./pin.ts";

export const REPO_ROOT = resolve(import.meta.dir, "../../../..");
/** inside node_modules so it is ignored, and so bare imports from copied trees resolve upward */
export const CACHE_DIR = join(REPO_ROOT, "node_modules/.cache/survev-parity");

function git(args: string[]) {
    return Bun.spawnSync(["git", ...args], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
}

/** packages upstream's game code imports, linked from the fork's own install */
const UPSTREAM_DEPS = ["zod", "obscenity", "hono", "slugify"];

/**
 * Extracts upstream at the pinned commit into the cache (server/src, shared, root config) and
 * links the few npm packages it imports. hjson is stubbed: no config file exists, so upstream
 * runs on its defaults.
 */
export function ensureUpstreamTree(): string {
    const dir = join(CACHE_DIR, `upstream-${UPSTREAM_SHA.slice(0, 12)}`);
    if (existsSync(join(dir, ".ready"))) return dir;

    if (git(["cat-file", "-e", `${UPSTREAM_SHA}^{commit}`]).exitCode !== 0) {
        const f = git(["fetch", "--no-tags", "--depth=1", UPSTREAM_URL, UPSTREAM_SHA]);
        if (f.exitCode !== 0) {
            throw new Error(`parity: cannot fetch upstream ${UPSTREAM_SHA}: ${f.stderr.toString()}`);
        }
    }
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const archive = git([
        "archive",
        "--format=tar",
        UPSTREAM_SHA,
        "server/src",
        "shared",
        "config.ts",
        "configType.ts",
    ]);
    if (archive.exitCode !== 0) throw new Error(`parity: git archive failed: ${archive.stderr.toString()}`);
    const tar = Bun.spawnSync(["tar", "-x", "-C", dir], { stdin: archive.stdout });
    if (tar.exitCode !== 0) throw new Error(`parity: tar failed: ${tar.stderr.toString()}`);

    const store = join(REPO_ROOT, "node_modules/.bun");
    const entries = new Bun.Glob("*").scanSync({ cwd: store, onlyFiles: false });
    const all = [...entries];
    for (const dep of UPSTREAM_DEPS) {
        const hit = all.find((e) => e.startsWith(`${dep}@`));
        if (!hit) throw new Error(`parity: ${dep} not in node_modules/.bun, run bun install`);
        const target = join(store, hit, "node_modules", dep);
        const link = join(dir, "node_modules", dep);
        mkdirSync(dirname(link), { recursive: true });
        symlinkSync(target, link);
    }
    const hjson = join(dir, "node_modules/hjson");
    mkdirSync(hjson, { recursive: true });
    writeFileSync(join(hjson, "package.json"), JSON.stringify({ name: "hjson", main: "index.js" }));
    writeFileSync(join(hjson, "index.js"), "module.exports = { parse: JSON.parse, stringify: JSON.stringify };\n");
    writeFileSync(join(dir, ".ready"), UPSTREAM_SHA);
    return dir;
}

if (import.meta.main) console.log(ensureUpstreamTree());
