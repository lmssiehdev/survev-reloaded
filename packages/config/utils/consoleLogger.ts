import { styleText } from "node:util";

// no env access here, the client build (atlas builder) uses this too
export const logLevels = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof logLevels)[number];

export interface LoggerOptions {
    level: LogLevel;
    /** off when the log collector adds its own timestamps */
    date: boolean;
}

export class Logger {
    constructor(
        public prefix: string,
        public options: LoggerOptions = { level: "info", date: true },
    ) {}

    enabled(level: LogLevel) {
        return logLevels.indexOf(level) >= logLevels.indexOf(this.options.level);
    }

    private log(logFn = console.log, ...message: any[]): void {
        if (this.options.date) {
            const date = new Date();
            const dateString = `[${date.toISOString().substring(0, 10)} ${date.toLocaleTimeString()}]`;

            logFn(
                styleText("cyan", dateString),
                styleText("green", this.prefix),
                "|",
                ...message,
            );
        } else {
            logFn(styleText("green", this.prefix), "|", ...message);
        }
    }

    info(...message: any[]): void {
        if (!this.enabled("info")) return;
        this.log(console.info, styleText("blue", "[INFO]"), ...message);
    }

    debug(...message: any[]): void {
        if (!this.enabled("debug")) return;
        this.log(
            console.debug,
            // not a typo, just want it to align with the others :D
            styleText("magenta", "[DEBG]"),
            ...message,
        );
    }

    warn(...message: any[]): void {
        if (!this.enabled("warn")) return;
        this.log(console.warn, styleText("yellow", "[WARN]"), ...message);
    }

    error(...message: any[]): void {
        if (!this.enabled("error")) return;
        this.log(console.error, styleText("red", "[ERROR]"), ...message);
    }
}
