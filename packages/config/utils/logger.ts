import { sharedEnv } from "../env.ts";
import { Logger, type LoggerOptions } from "./consoleLogger.ts";

export async function logErrorToWebhook(from: "server" | "client", ...messages: any[]) {
    const url = from === "server" ? sharedEnv.ERROR_WEBHOOK_URL : sharedEnv.CLIENT_ERROR_WEBHOOK_URL;
    if (!url) return;

    try {
        const msg = messages
            .map((msg) => {
                if (msg instanceof Error) {
                    return `\`\`\`${msg.cause}\n${msg.stack}\`\`\``;
                }
                if (typeof msg === "object") {
                    return `\`\`\`json\n${JSON.stringify(msg, null, 2).replaceAll("`", "\\`")}\`\`\``;
                }
                return `${msg}`;
            })
            .join("\n");

        await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                embeds: [
                    {
                        color: 0xff0000,
                        title: `${from} error`,
                        timestamp: new Date().toISOString(),
                        description: msg,
                        footer: {
                            text: `Region: ${sharedEnv.REGION}`,
                        },
                    },
                ],
            }),
        });
    } catch (err) {
        // dont use defaultLogger.error here to not log it recursively :)
        console.error("Failed to log error to webhook", err);
    }
}

export const logOptions: LoggerOptions = {
    level: sharedEnv.LOG_LEVEL === "warning" ? "warn" : sharedEnv.LOG_LEVEL,
    date: sharedEnv.LOG_DATE,
};

export class ServerLogger extends Logger {
    constructor(prefix: string) {
        super(prefix, logOptions);
    }

    override error(...message: any[]): void {
        super.error(...message);
        logErrorToWebhook("server", ...message);
    }
}

export const defaultLogger = new ServerLogger("Generic");
