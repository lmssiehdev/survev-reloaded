import type { GameWsDisconnectReason } from "@survev/shared/types/api.ts";
import type { Client } from "./client.ts";
import { Game, type GameHooks } from "./game.ts";
import type { GameMode, GameOptions } from "./gameOptions.ts";
import type { ClientSocket } from "./socket.ts";

/** what a GameRunner needs from the process or page it runs in, the game's hooks are optional */
export interface GameRunnerHost extends GameHooks {
    gameOptions(id: string, config: GameMode): GameOptions;
    /** the game stopped and the runner let go of it */
    onGameStopped?(game: Game): void;
}

/**
 * Runs one game at a time: creates it, ticks it at its options' rates
 * and hands it the sockets of its players.
 * The host adds the transport (IPC and Bun.serve for the game server)
 * and adds join tokens to the game itself
 */
export class GameRunner {
    game: Game | undefined;

    private readonly hooks: GameHooks;
    private timers: Array<ReturnType<typeof setInterval>> = [];

    constructor(private readonly host: GameRunnerHost) {
        this.hooks = {
            updateData: (game) => {
                host.updateData?.(game);
                if (game.stopped && game === this.game) {
                    this.drop();
                    host.onGameStopped?.(game);
                }
            },
            saveGame: (game) => host.saveGame?.(game),
            sendQuestProgress: (userId, progress) => host.sendQuestProgress?.(userId, progress),
        };
    }

    /** does nothing while a game is still running */
    create(id: string, config: GameMode) {
        if (this.game) return;
        const game = new Game(id, config, this.host.gameOptions(id, config), this.hooks);
        this.game = game;
        this.timers = [
            setInterval(() => game.update(), 1000 / game.options.gameTps),
            setInterval(() => game.netSync(), 1000 / game.options.netSyncTps),
        ];
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
        this.drop();
    }

    private drop() {
        for (const timer of this.timers) clearInterval(timer);
        this.timers = [];
        this.game = undefined;
    }
}
