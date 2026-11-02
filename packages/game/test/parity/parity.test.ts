import { beforeAll, describe, expect, test } from "bun:test";
import { formatResults, runGate, type ScenarioResult } from "./gate.ts";
import { UPSTREAM_SHA } from "./pin.ts";
import { allScenarios } from "./scenarios.ts";

// Replays every scenario on the fork and on upstream at the pinned commit (cached per pin, Bun
// and harness version), in parallel subprocesses. Takes minutes, not seconds.
let results: ScenarioResult[] = [];

beforeAll(async () => {
    results = await runGate();
    console.log(formatResults(results));
}, 30 * 60_000);

describe(`replay parity with upstream ${UPSTREAM_SHA.slice(0, 8)}`, () => {
    for (const s of allScenarios) {
        const result = () => {
            const r = results.find((x) => x.scenario === s.name);
            if (!r) throw new Error(`no result for ${s.name}`);
            return r;
        };
        test(`${s.name}: STRICT (state, rng, grid order, map, defs)`, () => {
            expect(result().strict).toEqual([]);
        });
        test(`${s.name}: CANONICAL wire`, () => {
            expect(result().canonical).toEqual([]);
        });
        test(`${s.name}: exercises ${s.expect?.join(", ") || "a full match"}`, () => {
            expect(result().uncovered).toEqual([]);
        });
    }
});
