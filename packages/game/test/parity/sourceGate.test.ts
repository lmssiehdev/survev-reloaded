// Source-diff allowlist gate: every gameplay file of the pinned upstream commit must match the fork
// file exactly (ignoring import paths and import order), or the difference must be recorded in
// allowed-diffs/ with a reason for every hunk.
//
// Regenerate after a reviewed change:
//   PARITY_REGEN=1 bun test packages/game/test/parity/sourceGate.test.ts
// Existing reasons are kept for unchanged hunks; new or changed hunks get "REASON: TODO",
// and the gate fails until every TODO is replaced by a real reason.

import { describe, expect, test } from "bun:test";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { forkPathFor, UPSTREAM_SHA, UPSTREAM_URL } from "./pin.ts";

const REGEN = process.env.PARITY_REGEN === "1";
const REGEN_HINT = "Review the change, then run `PARITY_REGEN=1 bun test packages/game/test/parity/sourceGate.test.ts`"
    + " and write a reason for every hunk marked REASON: TODO.";
const TODO = "REASON: TODO";

const UPSTREAM_ROOTS = ["server/src/game/", "shared/"];
const FORK_ROOTS = ["packages/game/", "packages/shared/"];
const CODE_FILE = /\.(ts|js|json)$/;

/** upstream gameplay files outside UPSTREAM_ROOTS that the fork moved into the gameplay packages */
const RELOCATED: Record<string, string> = {
    "server/src/utils/IDAllocator.ts": "packages/game/IDAllocator.ts",
    "server/src/utils/badWords.ts": "packages/shared/utils/badWords.ts",
};

const allowedDir = path.join(import.meta.dir, "allowed-diffs");
const missingFile = path.join(allowedDir, "missing.json");
const addedFile = path.join(allowedDir, "added.json");

function run(cmd: string[], opts: { cwd?: string; stdin?: string; env?: Record<string, string> } = {}) {
    const proc = Bun.spawnSync(cmd, {
        cwd: opts.cwd ?? import.meta.dir,
        stdin: opts.stdin === undefined ? "ignore" : Buffer.from(opts.stdin),
        env: opts.env ? { ...process.env, ...opts.env } : undefined,
    });
    return { exitCode: proc.exitCode, stdout: proc.stdout, stderr: proc.stderr.toString() };
}

const repoRoot = run(["git", "rev-parse", "--show-toplevel"]).stdout.toString().trim();

/** upstream path for a fork path; inverse of forkPathFor */
function upstreamPathFor(forkPath: string): string | undefined {
    const relocated = Object.keys(RELOCATED).find((up) => RELOCATED[up] === forkPath);
    if (relocated) return relocated;
    if (forkPath.startsWith("packages/game/")) return `server/src/game/${forkPath.slice(14)}`;
    if (forkPath.startsWith("packages/shared/")) return `shared/${forkPath.slice(16)}`;
    return undefined;
}

function ensureUpstreamCommit() {
    const has = () => run(["git", "cat-file", "-e", `${UPSTREAM_SHA}^{commit}`], { cwd: repoRoot }).exitCode === 0;
    if (has()) return;
    const fetch = run(["git", "fetch", "--no-tags", UPSTREAM_URL, UPSTREAM_SHA], { cwd: repoRoot });
    if (fetch.exitCode !== 0 || !has()) {
        throw new Error(
            `upstream commit ${UPSTREAM_SHA} is not in the object store and fetching it from ${UPSTREAM_URL} failed:\n`
                + `${fetch.stderr}\nFetch it manually: git fetch ${UPSTREAM_URL} ${UPSTREAM_SHA}`,
        );
    }
}

/** all upstream gameplay files at the pinned commit, read with a single `git cat-file --batch` */
function readUpstreamFiles(): Map<string, string> {
    const list = run([
        "git",
        "ls-tree",
        "-r",
        "-z",
        "--name-only",
        UPSTREAM_SHA,
        "--",
        ...UPSTREAM_ROOTS,
        ...Object.keys(RELOCATED),
    ], {
        cwd: repoRoot,
    });
    const paths = list.stdout.toString().split("\0").filter((p) => CODE_FILE.test(p));
    const batch = run(["git", "cat-file", "--batch"], {
        cwd: repoRoot,
        stdin: paths.map((p) => `${UPSTREAM_SHA}:${p}\n`).join(""),
    });
    if (batch.exitCode !== 0) throw new Error(`git cat-file failed: ${batch.stderr}`);

    const out = batch.stdout;
    const files = new Map<string, string>();
    let offset = 0;
    for (const p of paths) {
        const headerEnd = out.indexOf(10, offset);
        const header = out.subarray(offset, headerEnd).toString();
        const size = Number(header.split(" ")[2]);
        if (!header.includes(" blob ")) throw new Error(`unexpected cat-file header for ${p}: ${header}`);
        files.set(p, out.subarray(headerEnd + 1, headerEnd + 1 + size).toString());
        offset = headerEnd + 1 + size + 1;
    }
    return files;
}

/** tracked and untracked (not ignored) fork files under the gameplay packages */
function listForkFiles(): string[] {
    const list = run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...FORK_ROOTS], {
        cwd: repoRoot,
    });
    return [...new Set(list.stdout.toString().split("\0"))]
        .filter((p) => p && existsSync(path.join(repoRoot, p)))
        .sort();
}

//
// Normalisation: only import specifiers and import order are ignored
//

const IMPORT_RE =
    /^(import|export)(\s+type)?\s+([\w$]+(?:\s*,\s*\{[^}]*\})?|\*\s+as\s+[\w$]+|\*|\{[^}]*\})\s+from\s+(["'])([^"']+)\4;?[ \t]*(?:\n|$)|^import\s+(["'])([^"']+)\6;?[ \t]*(?:\n|$)/gm;

/** the module an import specifier points at, as an upstream-layout repo path (or the bare package name) */
function canonicalModule(spec: string, filePath: string): string {
    let resolved: string;
    if (spec.startsWith(".")) resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), spec));
    else if (spec.startsWith("@survev/shared/")) resolved = `packages/shared/${spec.slice(15)}`;
    else if (spec.startsWith("@survev/game/")) resolved = `packages/game/${spec.slice(13)}`;
    else return spec;
    return upstreamPathFor(resolved) ?? resolved;
}

function canonicalClause(clause: string): string {
    return clause
        .replace(/\s+/g, " ")
        .replace(/,\s*\}/, " }")
        .replace(/\{\s*/, "{ ")
        .replace(/\s*\}/, " }")
        .trim();
}

/** `filePath` is the file's path in its own tree (upstream or fork layout) */
function normalise(text: string, filePath: string): string {
    if (filePath.endsWith(".json")) return text;
    const imports: string[] = [];
    const body = text.replace(IMPORT_RE, (...m: (string | undefined)[]) => {
        const [, kw, type, clause, , spec, , sideEffectSpec] = m;
        if (sideEffectSpec !== undefined) {
            imports.push(`import "${canonicalModule(sideEffectSpec, filePath)}";`);
        } else {
            imports.push(
                `${kw}${type ? " type" : ""} ${canonicalClause(clause!)} from "${canonicalModule(spec!, filePath)}";`,
            );
        }
        return "";
    });
    if (imports.length === 0) return text;
    return `${imports.sort().join("\n")}\n\n${body.replace(/^\n+/, "")}`;
}

//
// Diffs
//

const tmp = mkdtempSync(path.join(tmpdir(), "survev-parity-"));

/** unified diff body (from the first @@) of two normalised texts, or "" when equal */
function unifiedDiff(a: string, b: string, upstreamPath: string, forkPath: string): string {
    writeFileSync(path.join(tmp, "a"), a);
    writeFileSync(path.join(tmp, "b"), b);
    const diff = run(
        [
            "git",
            "-c",
            "diff.algorithm=myers",
            "diff",
            "--no-index",
            "--no-color",
            "--no-ext-diff",
            "--indent-heuristic",
            "-U3",
            "a",
            "b",
        ],
        { cwd: tmp, env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } },
    );
    if (diff.exitCode === 0) return "";
    if (diff.exitCode !== 1) throw new Error(`git diff failed: ${diff.stderr}`);
    const out = diff.stdout.toString();
    return `--- upstream/${upstreamPath}\n+++ fork/${forkPath}\n${out.slice(out.indexOf("@@"))}`;
}

const HUNK_REASON_RE = /^# hunk (\d+)\b[^:]*: (.*)$/;

interface AllowedDiff {
    /** free-form header comment lines that are not per-hunk reasons */
    preamble: string[];
    /** reason per hunk index (0-based) */
    reasons: Map<number, string>;
    body: string;
}

function parseAllowedDiff(text: string): AllowedDiff {
    const lines = text.split("\n");
    const preamble: string[] = [];
    const reasons = new Map<number, string>();
    let i = 0;
    for (; i < lines.length && lines[i].startsWith("#"); i++) {
        const m = HUNK_REASON_RE.exec(lines[i]);
        if (m) reasons.set(Number(m[1]) - 1, m[2].trim());
        else preamble.push(lines[i]);
    }
    return { preamble, reasons, body: lines.slice(i).join("\n") };
}

/** hunks of a diff body, each without its @@ line so a hunk that only moved still matches */
function hunksOf(body: string): { at: string; content: string }[] {
    const hunks: { at: string; content: string }[] = [];
    for (const chunk of body.split(/^(?=@@ )/m).slice(1)) {
        const nl = chunk.indexOf("\n");
        hunks.push({ at: chunk.slice(0, chunk.indexOf(" @@") + 3), content: chunk.slice(nl + 1) });
    }
    return hunks;
}

function renderAllowedDiff(body: string, previous: AllowedDiff | undefined): string {
    // queued per hunk content, so identical hunks keep their own reasons in order
    const oldReasons = new Map<string, string[]>();
    if (previous) {
        hunksOf(previous.body).forEach((h, i) => {
            const reason = previous.reasons.get(i);
            if (!reason) return;
            const queue = oldReasons.get(h.content) ?? [];
            queue.push(reason);
            oldReasons.set(h.content, queue);
        });
    }
    const header = [...(previous?.preamble ?? [])];
    hunksOf(body).forEach((h, i) => {
        header.push(`# hunk ${i + 1} (${h.at}): ${oldReasons.get(h.content)?.shift() ?? TODO}`);
    });
    return `${header.join("\n")}\n${body}`;
}

/** problems with a recorded diff's reasons, empty when every hunk has a real reason */
function reasonProblems(allowed: AllowedDiff): string[] {
    const problems: string[] = [];
    const count = hunksOf(allowed.body).length;
    for (let i = 0; i < count; i++) {
        const reason = allowed.reasons.get(i);
        if (!reason) problems.push(`hunk ${i + 1} has no reason`);
        else if (reason.includes(TODO)) problems.push(`hunk ${i + 1} is marked ${TODO}`);
    }
    for (const i of allowed.reasons.keys()) {
        if (i >= count) problems.push(`reason for hunk ${i + 1}, but the diff only has ${count} hunks`);
    }
    if (allowed.preamble.some((l) => l.includes(TODO))) problems.push(`header is marked ${TODO}`);
    return problems;
}

function readJsonAllowlist(file: string): Record<string, string> {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>) : {};
}

function writeJsonAllowlist(file: string, entries: Record<string, string>) {
    const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

const diffFileName = (forkPath: string) => `${forkPath.replaceAll("/", "__")}.diff`;

//
// Gather
//

ensureUpstreamCommit();
const upstreamFiles = readUpstreamFiles();
const forkFiles = listForkFiles();

interface FileResult {
    upstreamPath: string;
    forkPath: string;
    /** normalised unified diff, "" when identical after normalisation */
    diff: string;
}

const results: FileResult[] = [];
const missing: string[] = [];
for (const [upstreamPath, upstreamText] of upstreamFiles) {
    const forkPath = RELOCATED[upstreamPath] ?? forkPathFor(upstreamPath)!;
    const abs = path.join(repoRoot, forkPath);
    if (!existsSync(abs)) {
        missing.push(upstreamPath);
        continue;
    }
    const a = normalise(upstreamText, upstreamPath);
    const b = normalise(readFileSync(abs, "utf8"), forkPath);
    results.push({ upstreamPath, forkPath, diff: a === b ? "" : unifiedDiff(a, b, upstreamPath, forkPath) });
}
rmSync(tmp, { recursive: true, force: true });

const added = forkFiles.filter((p) => {
    if (p.split("/").includes("test")) return false;
    const up = upstreamPathFor(p);
    return up === undefined || !upstreamFiles.has(up);
});

const expectedDiffFiles = new Set(results.filter((r) => r.diff).map((r) => diffFileName(r.forkPath)));

if (REGEN) {
    mkdirSync(allowedDir, { recursive: true });
    for (const r of results) {
        if (!r.diff) continue;
        const file = path.join(allowedDir, diffFileName(r.forkPath));
        const previous = existsSync(file) ? parseAllowedDiff(readFileSync(file, "utf8")) : undefined;
        writeFileSync(file, renderAllowedDiff(r.diff, previous));
    }
    for (const f of readdirSync(allowedDir)) {
        if (f.endsWith(".diff") && !expectedDiffFiles.has(f)) unlinkSync(path.join(allowedDir, f));
    }
    const oldMissing = readJsonAllowlist(missingFile);
    writeJsonAllowlist(missingFile, Object.fromEntries(missing.map((p) => [p, oldMissing[p] ?? TODO])));
    const oldAdded = readJsonAllowlist(addedFile);
    writeJsonAllowlist(addedFile, Object.fromEntries(added.map((p) => [p, oldAdded[p] ?? TODO])));
}

//
// Tests
//

describe(`gameplay source parity with upstream ${UPSTREAM_SHA.slice(0, 8)}`, () => {
    test.each(results.map((r) => [r.forkPath, r] as const))("%s", (_, r) => {
        const file = path.join(allowedDir, diffFileName(r.forkPath));
        const rel = path.relative(repoRoot, file);
        if (!r.diff) {
            if (existsSync(file)) throw new Error(`${r.forkPath} now matches upstream; delete stale ${rel}`);
            return;
        }
        if (!existsSync(file)) {
            throw new Error(
                `${r.forkPath} differs from upstream ${r.upstreamPath} and ${rel} is missing.\n\n${r.diff}\n${REGEN_HINT}`,
            );
        }
        const allowed = parseAllowedDiff(readFileSync(file, "utf8"));
        if (allowed.body !== r.diff) {
            throw new Error(
                `${r.forkPath} differs from upstream ${r.upstreamPath} in a way not recorded in ${rel}.\n\n`
                    + `actual diff:\n${r.diff}\n${REGEN_HINT}`,
            );
        }
        const problems = reasonProblems(allowed);
        if (problems.length) throw new Error(`${rel}:\n  ${problems.join("\n  ")}\n${REGEN_HINT}`);
    });

    test("no stale allowed diffs", () => {
        const stale = existsSync(allowedDir)
            ? readdirSync(allowedDir).filter((f) => f.endsWith(".diff") && !expectedDiffFiles.has(f))
            : [];
        expect(stale, `allowed diffs for files that no longer differ or no longer exist; ${REGEN_HINT}`).toEqual([]);
    });

    test("upstream files missing in the fork are allowlisted in missing.json", () => {
        const allow = readJsonAllowlist(missingFile);
        const unlisted = missing.filter((p) => !allow[p]);
        const todo = missing.filter((p) => allow[p]?.includes(TODO));
        const stale = Object.keys(allow).filter((p) => !missing.includes(p));
        expect({ unlisted, todo, stale }, REGEN_HINT).toEqual({ unlisted: [], todo: [], stale: [] });
    });

    test("fork-only gameplay files are allowlisted in added.json", () => {
        const allow = readJsonAllowlist(addedFile);
        const unlisted = added.filter((p) => !allow[p]);
        const todo = added.filter((p) => allow[p]?.includes(TODO));
        const stale = Object.keys(allow).filter((p) => !added.includes(p));
        expect({ unlisted, todo, stale }, REGEN_HINT).toEqual({ unlisted: [], todo: [], stale: [] });
    });
});
