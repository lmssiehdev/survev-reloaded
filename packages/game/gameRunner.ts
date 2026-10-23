import type { GameWsDisconnectReason } from "@survev/shared/types/api.ts";
import type { Client } from "./client.ts";
import { Game, type GameHooks } from "./game.ts";
import { GAME_TPS, type GameMode, type GameOptions, NET_SYNC_TPS } from "./gameOptions.ts";
import { type ProcessMsg, ProcessMsgType } from "./ipcTypes.ts";
import type { ClientSocket } from "./socket.ts";

/** what a GameRunner needs from the process or worker it runs in */
export interface GameRunnerHost extends Omit<GameHooks, "updateData"> {
    /** sends a message to whoever creates the games and hands out join tokens */
    send(msg: ProcessMsg): void;
    gameOptions(id: string, config: GameMode): GameOptions;
    /** the game stopped and the runner let go of it */
    onGameStopped?(game: Game): void;
}

/**
 * Runs one game at a time: creates it from the messages it receives,
 * ticks it, reports its data back and hands it the sockets of its players.
 * The host only adds the transport (IPC and Bun.serve for the game server)
 */
export class GameRunner {
    game: Game | undefined;

    private readonly hooks: GameHooks;
    private readonly timers: Array<ReturnType<typeof setInterval>> = [];

    constructor(private readonly host: GameRunnerHost) {
        this.hooks = {
            updateData: (game) => {
                host.send({ type: ProcessMsgType.UpdateData, ...game.getData() });
                if (game.stopped && game === this.game) {
                    this.game = undefined;
                    host.onGameStopped?.(game);
                }
            },
            saveGame: (game) => host.saveGame?.(game),
            sendQuestProgress: (userId, progress) => host.sendQuestProgress?.(userId, progress),
        };
    }

    start() {
        this.timers.push(
            setInterval(() => this.game?.update(), 1000 / GAME_TPS),
            setInterval(() => this.game?.netSync(), 1000 / NET_SYNC_TPS),
            // also a keep alive, the owner kills runners it hasn't heard from in 10 seconds
            setInterval(() => this.sendData(), 5000),
        );
    }

    stop() {
        for (const timer of this.timers) clearInterval(timer);
        this.timers.length = 0;
    }

    handleMsg(msg: ProcessMsg) {
        if (msg.type === ProcessMsgType.Create && !this.game) {
            this.game = new Game(msg.id, msg.config, this.host.gameOptions(msg.id, msg.config), this.hooks);
        }

        if (!this.game) return;

        switch (msg.type) {
            case ProcessMsgType.AddJoinToken:
                this.game.addJoinTokens(msg.tokens, msg.autoFill);
                break;
            case ProcessMsgType.AddSpectateToken:
                this.game.addSpectateToken(msg.token, msg.data);
                break;
        }
    }

    sendData() {
        if (this.game) {
            this.game.updateData();
        } else {
            this.host.send({ type: ProcessMsgType.KeepAlive });
        }
    }

    socketMessage(socket: ClientSocket<Client>, data: ArrayBuffer) {
        if (!this.game) {
            socket.close();
            return;
        }
        this.game.clientBarn.handleMsg(data, socket);
    }

    socketClosed(socket: ClientSocket<Client>) {
        this.game?.clientBarn.handleSocketClose(socket);
    }

    /** tells the players why and drops the game, for when the host is going away */
    abort(reason: GameWsDisconnectReason) {
        if (!this.game) return;
        for (const client of this.game.clientBarn.clients) {
            client.socket.close(reason);
        }
        this.game = undefined;
    }
}
