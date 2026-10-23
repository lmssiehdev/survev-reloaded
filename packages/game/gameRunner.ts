import type { GameWsDisconnectReason } from "@survev/shared/types/api.ts";
import type { Client } from "./client.ts";
import { Game, type GameHooks } from "./game.ts";
import { GAME_TPS, type GameMode, type GameOptions, NET_SYNC_TPS } from "./gameOptions.ts";
import type { ClientSocket } from "./socket.ts";

/** what a GameRunner needs from the process or page it runs in, the game's hooks are optional */
export interface GameRunnerHost extends GameHooks {
    gameOptions(id: string, config: GameMode): GameOptions;
    /** the game stopped and the runner let go of it */
    onGameStopped?(game: Game): void;
}

/**
 * Runs one game at a time: creates it, ticks it and hands it the sockets of its players.
 * The host adds the transport (IPC and Bun.serve for the game server)
 * and adds join tokens to the game itself
 */
export class GameRunner {
    game: Game | undefined;

    private readonly hooks: GameHooks;
    private readonly timers: Array<ReturnType<typeof setInterval>> = [];

    constructor(private readonly host: GameRunnerHost) {
        this.hooks = {
            updateData: (game) => {
                host.updateData?.(game);
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
        );
    }

    stop() {
        for (const timer of this.timers) clearInterval(timer);
        this.timers.length = 0;
    }

    /** does nothing while a game is still running */
    create(id: string, config: GameMode) {
        if (this.game) return;
        this.game = new Game(id, config, this.host.gameOptions(id, config), this.hooks);
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
