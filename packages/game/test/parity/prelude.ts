// Imported before any game module. Replaces every clock and RNG source the sim can reach, so a
// replay is a pure function of the scenario.
const seed = Number(process.env.PARITY_SEED ?? 1) >>> 0;
let s = seed;

export const rng = { calls: 0 };

Math.random = function() {
    rng.calls++;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const clock = { now: 1_700_000_000_000 };
Date.now = () => clock.now;
