import type { LogRecord, Sink } from "@logtape/logtape";
import { recordToJson } from "./format.ts";

export type AxiomSinkOptions = {
    token: string;
    dataset: string;
    baseUrl?: string;
    fetch?: typeof fetch;
    flushIntervalMs?: number;
    batchSize?: number;
    maxQueue?: number;
};

export function createAxiomSink(opts: AxiomSinkOptions): Sink & AsyncDisposable {
    const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    const url = `${opts.baseUrl ?? "https://api.axiom.co"}/v1/datasets/${opts.dataset}/ingest`;
    const batchSize = opts.batchSize ?? 500;
    const maxQueue = opts.maxQueue ?? 10_000;

    let queue: Record<string, unknown>[] = [];
    let dropped = 0;
    let inFlight: Promise<void> | undefined;

    async function send(): Promise<void> {
        const batch = queue.splice(0, batchSize);
        const droppedNow = dropped;
        dropped = 0;
        if (droppedNow > 0) {
            batch.unshift({
                _time: new Date().toISOString(),
                level: "warning",
                message: "logger.dropped",
                dropped: droppedNow,
            });
        }
        try {
            const res = await doFetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${opts.token}`,
                    "Content-Type": "application/x-ndjson",
                },
                body: batch.map((r) => JSON.stringify(r)).join("\n"),
            });
            if (!res.ok) {
                dropped += droppedNow;
                console.error("axiom ingest failed", res.status);
            }
        } catch (err) {
            dropped += droppedNow;
            console.error("axiom ingest failed", err);
        }
    }

    /** Starts a request unless one is in flight; chains further batches while the queue is large. */
    function flush(): void {
        if (inFlight || queue.length === 0) return;
        inFlight = send().finally(() => {
            inFlight = undefined;
            if (queue.length >= batchSize) flush();
        });
    }

    const timer = setInterval(flush, opts.flushIntervalMs ?? 2000);
    (timer as { unref?: () => void }).unref?.();

    const sink = ((record: LogRecord) => {
        try {
            queue.push(recordToJson(record));
            if (queue.length > maxQueue) {
                queue.shift();
                dropped++;
            }
            if (queue.length >= batchSize) flush();
        } catch (err) {
            console.error("axiom sink failed", err);
        }
    }) as Sink & AsyncDisposable;

    sink[Symbol.asyncDispose] = async () => {
        clearInterval(timer);
        while (queue.length > 0 || inFlight) {
            if (inFlight) await inFlight;
            else flush();
        }
    };
    return sink;
}
