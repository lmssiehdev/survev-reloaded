import { installCrashHandlers, setupServerLogging } from "../../node.ts";

await setupServerLogging({ app: "api", level: "info", format: "json", env: "dev", git: "abc" });
installCrashHandlers();
Promise.reject(new Error("nope"));
