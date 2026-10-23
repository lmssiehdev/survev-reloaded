import { GameHandle, GamePool } from "@survev/game/gamePool.ts";
import type { ProcessMsg } from "@survev/game/ipcTypes.ts";
import { getLogger } from "@survev/logger/node.ts";
import { type ChildProcess, fork } from "node:child_process";
import { env } from "../env.ts";

// run the source in dev, the bundled build in production
const procFile = import.meta.filename.endsWith(".ts") ? "src/game/gameProcess.ts" : "dist/gameProcess.js";

/** a child process running a GameRunner, players connect to it on its own port */
export class GameProcess extends GameHandle {
    readonly process: ChildProcess;

    /** set once the process exited, `process.killed` only means a signal was sent */
    exited = false;

    /** set by killProcess, tells an intentional exit from a crash */
    killed = false;

    constructor(readonly port: number) {
        super();
        this.process = fork(procFile, [port.toString()], {
            serialization: "advanced",
            // don't inherit the parent's runtime flags
            execArgv: [],
        });
    }

    send(msg: ProcessMsg) {
        if (this.exited || !this.process.channel) return;
        this.process.send(msg);
    }

    logProps() {
        return { childPid: this.process.pid, port: this.port };
    }
}

export class GameProcessManager extends GamePool<GameProcess> {
    private readonly _freePorts: number[] = [];

    constructor() {
        super(getLogger(["game-server", "manager"]));

        for (let i = 0; i < env.maxGames; i++) {
            this._freePorts.push(env.firstGamePort + i);
        }

        this.start();
    }

    protected spawn(): GameProcess | undefined {
        const port = this._freePorts.shift();
        if (port === undefined) return undefined;

        const proc = new GameProcess(port);

        proc.process.on("message", (msg: ProcessMsg) => {
            this.handleMsg(proc, msg);
        });
        proc.process.on("exit", (code, signal) => {
            proc.exited = true;
            const props = {
                ...proc.logProps(),
                code,
                signal,
                gameId: proc.gameData.id || undefined,
            };
            if (proc.killed) this.logger.info("game.proc.exit", props);
            else this.logger.error("game.proc.died", props);
            this.remove(proc);
            if (!this._freePorts.includes(proc.port)) {
                this._freePorts.push(proc.port);
            }
        });
        // lost the IPC channel, the process can't be used anymore
        proc.process.on("disconnect", () => {
            if (!proc.killed && !proc.exited) {
                this.logger.warn("game.proc.disconnected", proc.logProps());
            }
            // not an intentional kill: if the process dies on its own it must still log game.proc.died
            this.killProcess(proc, "SIGTERM", false);
        });
        this.logger.info("game.proc.spawn", proc.logProps());

        return proc;
    }

    protected kill(proc: GameProcess, reason: "unresponsive" | "stale") {
        if (reason === "unresponsive") {
            // sigquit can dump a core of the process
            // useful for debugging infinite loops
            this.killProcess(proc, "SIGQUIT", false);
        } else {
            this.killProcess(proc);
        }
    }

    /** `intentional` false (lost IPC) cleans up without marking the exit as requested */
    killProcess(proc: GameProcess, signal: NodeJS.Signals = "SIGTERM", intentional = true): void {
        this.remove(proc);
        if (proc.exited) return;
        if (intentional) proc.killed = true;

        // send SIGTERM, if still hasn't terminated after 5 seconds, send SIGKILL >:3
        proc.process.kill(signal);
        setTimeout(() => {
            if (!proc.exited) {
                proc.process.kill("SIGKILL");
            }
        }, 5000);
    }
}
