/** What a bot sends with its next InputMsg. The replay sends inputs every 3rd tick. */
export interface BotInput {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    shoot: boolean;
    /** radians */
    aim: number;
    /** GameConfig.Input values added to the next message, then cleared */
    inputs: number[];
}

export interface Bot {
    index: number;
    input: BotInput;
    /** random-walk driver; set false to steer the bot from the scenario */
    auto: boolean;
    /** the server Player behind this bot's socket */
    readonly player: any;
}

export interface ScenarioCtx {
    game: any;
    GameConfig: any;
    tick: number;
    bots: Bot[];
    /** script rng, independent of the sim's Math.random so scripts never shift the RNG stream */
    rand(): number;
    /** coverage counter shown in the report; scenarios assert on these to prove they hit something */
    count(label: string, n?: number): void;
    /** count calls to obj[method] under label */
    countCalls(obj: any, method: string, label: string): void;
}

export interface Scenario {
    name: string;
    mapName: string;
    teamMode: 1 | 2 | 4;
    bots: number;
    ticks: number;
    seed: number;
    fixedSpawn?: boolean;
    /** coverage counters that must be > 0 at the end, so a scenario can't silently stop exercising its target */
    expect?: string[];
    /** once, after every bot joined and before tick 0 */
    setup?(ctx: ScenarioCtx): void;
    /** every tick, before inputs and game.update */
    tick?(ctx: ScenarioCtx): void;
}
