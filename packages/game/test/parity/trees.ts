import { join } from "node:path";

/**
 * One game server source tree the replay can drive: the fork itself, a mutant copy of it,
 * or upstream survev at the pinned commit (pnpm layout, global Config instead of options).
 */
export type TreeLayout = "fork" | "upstream";

export interface LoadedTree {
    Game: any;
    net: any;
    GameConfig: any;
    ClientSocket: any;
    defs: Record<string, unknown>;
    newGame(id: string, mode: { mapName: string; teamMode: number }, fixedSpawn: boolean): any;
}

export async function loadTree(root: string, layout: TreeLayout): Promise<LoadedTree> {
    const game = layout === "fork" ? join(root, "packages/game") : join(root, "server/src/game");
    const shared = layout === "fork" ? join(root, "packages/shared") : join(root, "shared");

    const [{ Game }, { ClientSocket }, net, { GameConfig }, { RawGameObjectDefs }, { RawMapObjectDefs }, { MapDefs }] =
        await Promise.all([
            import(join(game, "game.ts")),
            import(join(game, "socket.ts")),
            import(join(shared, "net/net.ts")),
            import(join(shared, "gameConfig.ts")),
            import(join(shared, "defs/gameObjectDefs.ts")),
            import(join(shared, "defs/mapObjectDefs.ts")),
            import(join(shared, "defs/mapDefs.ts")),
        ]);
    const defs = { GameConfig, RawGameObjectDefs, RawMapObjectDefs, MapDefs };

    if (layout === "fork") {
        const { defaultGameOptions } = await import(join(game, "gameOptions.ts"));
        return forkTree({ Game, defaultGameOptions, ClientSocket, net, GameConfig, defs });
    }

    const { Config } = await import(join(root, "server/src/config.ts"));
    Object.assign(Config.logging, {
        logDate: false,
        debugLogs: false,
        infoLogs: false,
        warnLogs: false,
        errorLogs: true,
    });
    Config.rateLimitsEnabled = false;
    Config.uniqueInGameNames = true;
    const newGame: LoadedTree["newGame"] = (id, mode, fixedSpawn) => {
        if (fixedSpawn) Config.debug.spawnMode = "fixed";
        return new Game(id, mode);
    };
    return { Game, net, GameConfig, ClientSocket, defs, newGame };
}

/** a fork-layout tree from already imported modules (static imports, used by the bench build) */
export function forkTree(m: {
    Game: any;
    defaultGameOptions: any;
    ClientSocket: any;
    net: any;
    GameConfig: any;
    defs: Record<string, unknown>;
}): LoadedTree {
    const noop = () => {};
    return {
        ...m,
        newGame(id, mode, fixedSpawn) {
            const options = m.defaultGameOptions({ debug: noop, info: noop, warn: noop, error: console.error });
            if (fixedSpawn) options.debug.spawnMode = "fixed";
            return new m.Game(id, mode, options);
        },
    };
}
