// Node/Bun-only additions; browser code imports index.ts instead.
import { AsyncLocalStorage } from "node:async_hooks";
import { flushLogs, getLogger, setupLogging, type SetupLoggingOptions } from "./index.ts";

export * from "./index.ts";

export type ServerLoggingOptions = Omit<SetupLoggingOptions, "contextLocalStorage" | "staticProps">;

export function setupServerLogging(opts: ServerLoggingOptions): Promise<void> {
    return setupLogging({
        ...opts,
        contextLocalStorage: new AsyncLocalStorage(),
        staticProps: { pid: process.pid },
    });
}

let crashHandlersInstalled = false;
let crashing = false;

async function crash(kind: "exception" | "rejection", err: unknown): Promise<void> {
    if (crashing) return;
    crashing = true;
    try {
        getLogger(["process"]).fatal("process.crash", { kind, err });
        await flushLogs();
    } finally {
        process.exit(1);
    }
}

export function installCrashHandlers(): void {
    if (crashHandlersInstalled) return;
    crashHandlersInstalled = true;
    process.on("uncaughtException", (err) => void crash("exception", err));
    process.on("unhandledRejection", (reason) => void crash("rejection", reason));
}

let processStarted = false;
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

/** Logs process.start once and logs process.exit + flushes on SIGINT/SIGTERM. */
export function logProcessStart(props?: Record<string, unknown>): void {
    if (processStarted) return;
    processStarted = true;
    const logger = getLogger(["process"]);
    logger.info("process.start", { ...props });
    let exiting = false;
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.on(signal, async () => {
            if (exiting) return;
            exiting = true;
            try {
                logger.info("process.exit", { signal });
                await flushLogs();
            } finally {
                process.exit(SIGNAL_EXIT_CODES[signal]);
            }
        });
    }
}
