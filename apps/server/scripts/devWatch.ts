/**
 * Dev-only restart-on-change runner.
 *
 * `bun --watch` only tracks the runtime import graph of the entry file, but the game
 * server forks `src/game/gameProcess.ts` as a separate process, so changes to it wouldn't
 * trigger a restart. This watches extra paths too, and the env file.
 *
 * Usage: bun scripts/devWatch.ts [--env-file=<path>] <entry> [...extra paths to watch]
 */
import { type FSWatcher, watch } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
// passed to bun, so every restart reads the env file again
const envFileArgs = args.filter((a) => a.startsWith("--env-file="));
const [entry, ...extraPaths] = args.filter((a) => !a.startsWith("--env-file="));
if (!entry) {
    console.error("Usage: bun scripts/devWatch.ts [--env-file=<path>] <entry> [...paths]");
    process.exit(1);
}

const watchPaths = [path.dirname(entry), ...extraPaths, ...envFileArgs.map((a) => a.slice("--env-file=".length))];

let child: ReturnType<typeof Bun.spawn> | undefined;
let restartTimeout: ReturnType<typeof setTimeout> | undefined;

function start() {
    child = Bun.spawn([process.execPath, ...envFileArgs, entry], {
        stdio: ["inherit", "inherit", "inherit"],
    });
}

async function restart(reason: string) {
    console.log(`[devWatch] ${reason} changed, restarting ${entry}`);
    if (child) {
        child.kill("SIGTERM");
        await child.exited;
    }
    start();
}

const watchers: FSWatcher[] = [];
for (const p of watchPaths) {
    try {
        watchers.push(
            watch(p, { recursive: true }, (_event, fileName) => {
                if (fileName?.includes("node_modules")) return;
                clearTimeout(restartTimeout);
                restartTimeout = setTimeout(() => restart(path.join(p, fileName ?? "")), 100);
            }),
        );
    } catch {
        // optional paths (like the env file) may not exist
    }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        for (const w of watchers) w.close();
        child?.kill(signal);
        process.exit();
    });
}

start();
