// Browser-safe entry: no node:* imports, Bun APIs or process access here (see node.ts).
import {
    configure,
    type ContextLocalStorage,
    dispose,
    fingersCrossed,
    getConsoleSink,
    getLogger as getLogTapeLogger,
    type Logger,
    type LogLevel,
    type LogRecord,
    type Sink,
} from "@logtape/logtape";
import { type AxiomSinkOptions, createAxiomSink } from "./axiomSink.ts";
import { recordToJson, renderMessage } from "./format.ts";
import { serializeValue } from "./serialize.ts";

export { withContext } from "@logtape/logtape";
export type { AxiomSinkOptions };

export type AppName = "api" | "game-server" | "game-proc" | "bot";
export type AppLevel = "debug" | "info" | "warning" | "error";
export type AppLogger = Logger;

export type SetupLoggingOptions = {
    app: AppName;
    level: AppLevel;
    format: "pretty" | "json";
    env: string;
    git: string;
    region?: string;
    axiom?: AxiomSinkOptions;
    /** default true */
    console?: boolean;
    contextLocalStorage?: ContextLocalStorage<Record<string, unknown>>;
    staticProps?: Record<string, unknown>;
};

const FLUSH_TIMEOUT_MS = 3000;
const BUFFER_SIZE = 200;
/** LRU cap on per-context buffers so ended games/requests can't leak memory. */
const MAX_CONTEXTS = 1000;
const CONTEXT_KEYS = ["gameId", "requestId"];

/** The level just below `level`; records at or below it are buffered. */
const BUFFER_LEVEL: Record<AppLevel, LogLevel> = {
    debug: "trace",
    info: "debug",
    warning: "info",
    error: "warning",
};

const pad2 = (n: number) => String(n).padStart(2, "0");

function formatPretty(r: LogRecord): string {
    const d = new Date(r.timestamp);
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    const props = Object.keys(r.properties).length > 0 ? ` ${JSON.stringify(serializeValue(r.properties))}` : "";
    return `${time} ${r.level.toUpperCase()} ${r.category.join(".")} ${renderMessage(r.message)}${props}`;
}

const formatJson = (r: LogRecord) => JSON.stringify(recordToJson(r));

/** Fans out to every sink (merging static props first) and disposes them all. */
function createOutputSink(sinks: Sink[], staticProps: Record<string, unknown>): Sink & AsyncDisposable {
    const out = ((record: LogRecord) => {
        const merged: LogRecord = { ...record, properties: { ...record.properties, ...staticProps } };
        for (const sink of sinks) sink(merged);
    }) as Sink & AsyncDisposable;
    out[Symbol.asyncDispose] = async () => {
        await Promise.all(
            sinks.map(async (s) => {
                const d = s as Partial<Disposable & AsyncDisposable>;
                if (d[Symbol.asyncDispose]) await d[Symbol.asyncDispose]!();
                else d[Symbol.dispose]?.();
            }),
        );
    };
    return out;
}

export async function setupLogging(opts: SetupLoggingOptions): Promise<void> {
    const staticProps: Record<string, unknown> = {
        ...opts.staticProps,
        app: opts.app,
        env: opts.env,
        git: opts.git,
    };
    if (opts.region !== undefined) staticProps.region = opts.region;

    const sinks: Sink[] = [];
    if (opts.console ?? true) {
        const json = opts.format === "json";
        sinks.push(
            getConsoleSink({
                nonBlocking: true,
                formatter: json ? formatJson : formatPretty,
                // json mode: everything on stdout, one object per line
                levelMap: json
                    ? { trace: "log", debug: "log", info: "log", warning: "log", error: "log", fatal: "log" }
                    : undefined,
            }),
        );
    }
    if (opts.axiom) sinks.push(createAxiomSink(opts.axiom));

    // Records >= level pass straight through (above bufferLevel, below or at trigger);
    // lower ones wait per gameId/requestId and are replayed before a warning+ in the same context.
    // afterTrigger "buffer" keeps buffering after a replay instead of switching the context to passthrough.
    const main = fingersCrossed(createOutputSink(sinks, staticProps), {
        triggerLevel: opts.level === "error" ? "error" : "warning",
        bufferLevel: BUFFER_LEVEL[opts.level],
        afterTrigger: "buffer",
        maxBufferSize: BUFFER_SIZE,
        isolateByContext: { keys: CONTEXT_KEYS, maxContexts: MAX_CONTEXTS },
    });

    await configure({
        reset: true,
        contextLocalStorage: opts.contextLocalStorage,
        sinks: { main },
        loggers: [
            { category: ["survev"], lowestLevel: "debug", sinks: ["main"] },
            { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["main"] },
        ],
    });
}

export function getLogger(category: string[]): AppLogger {
    return getLogTapeLogger(["survev", ...category]);
}

/** Disposes LogTape (flushing console and Axiom), giving up after 3 s so a hung fetch can't block exit. */
export async function flushLogs(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
    });
    try {
        await Promise.race([dispose(), timeout]);
    } finally {
        clearTimeout(timer);
    }
}
