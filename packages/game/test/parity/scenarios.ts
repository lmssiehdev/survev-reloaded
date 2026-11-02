import { directedScenarios } from "./directed.ts";
import type { Scenario } from "./scenario.ts";

/** Base scenarios: random-walk bots over whole matches. Directed ones live in directed.ts. */
export const baseScenarios: Scenario[] = [
    { name: "solo-main", mapName: "main", teamMode: 1, bots: 79, ticks: 8000, seed: 1 },
    { name: "squad-main", mapName: "main", teamMode: 4, bots: 60, ticks: 8000, seed: 2 },
    { name: "solo-desert", mapName: "desert", teamMode: 1, bots: 60, ticks: 8000, seed: 3 },
    { name: "faction", mapName: "faction", teamMode: 4, bots: 60, ticks: 6000, seed: 4 },
];

export const allScenarios: Scenario[] = [...baseScenarios, ...directedScenarios];

/** timing only (bench.ts), not part of the gate: the 79-bot solo replay the perf numbers use */
export const benchScenarios: Scenario[] = [
    { name: "bench-solo", mapName: "main", teamMode: 1, bots: 79, ticks: 12000, seed: 1 },
];

export function findScenario(name: string): Scenario {
    const s = [...allScenarios, ...benchScenarios].find((x) => x.name === name);
    if (!s) throw new Error(`parity: unknown scenario ${name}`);
    return s;
}
