// Mutation check for the replay gate: each mutant is a small gameplay change the gate must catch.
// usage: bun mutants.ts [--only a,b]
// Copies packages/ per mutant into the cache, applies one text replacement, and runs the gate on it.
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatResults, runGate } from "./gate.ts";
import { CACHE_DIR, REPO_ROOT } from "./upstream.ts";

interface Mutant {
    name: string;
    why: string;
    file: string;
    from: string;
    to: string;
    /** a second replacement in the same file */
    also?: [string, string];
}

export const mutants: Mutant[] = [
    {
        name: "deffloat",
        why: "definition change: one fewer shotgun pellet",
        file: "packages/shared/defs/gameObjects/gunDefs.ts",
        from: "bulletCount: 9",
        to: "bulletCount: 8",
    },
    {
        name: "headshot",
        why: "tiny float change in a hit roll threshold",
        file: "packages/shared/gameConfig.ts",
        from: "headshotChance: 0.15",
        to: "headshotChance: 0.1500001",
    },
    {
        name: "order",
        why: "living players sorted the other way round",
        file: "packages/game/objects/player.ts",
        from: "this.livingPlayers.sort((a, b) => a.teamId - b.teamId);",
        to: "this.livingPlayers.sort((a, b) => b.teamId - a.teamId);",
    },
    {
        name: "rngextra",
        why: "one extra Math.random call per explosion",
        file: "packages/game/objects/explosion.ts",
        from: "varianceT: Math.random(),",
        to: "varianceT: (Math.random(), Math.random()),",
    },
    {
        name: "fae0ac09-unported",
        why: "upstream fix reverted: melee swap after dropping weapons on death",
        file: "packages/game/objects/player.ts",
        from:
            "        this.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee);\n        for (let i = 0; i < GameConfig.WeaponSlot.Count; i++) {",
        to: "        for (let i = 0; i < GameConfig.WeaponSlot.Count; i++) {",
        also: [
            "            }\n        }\n\n        for (const item of Object.keys(this.invManager.items) as InventoryItem[]) {",
            "            }\n        }\n        this.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee);\n\n        for (const item of Object.keys(this.invManager.items) as InventoryItem[]) {",
        ],
    },
    {
        name: "collision-order",
        why: "player vs obstacle collisions resolved in reverse grid order",
        file: "packages/game/objects/player.ts",
        from:
            "            for (let j = 0; j < objs.length && !this.debug.noClip; j++) {\n                const obj = objs[j];",
        to: "            for (let j = 0; j < objs.length && !this.debug.noClip; j++) {\n                const obj = objs[objs.length - 1 - j];",
    },
    {
        name: "visibility-off-by-one",
        why: "client culling rect one unit wider",
        file: "packages/game/client.ts",
        from: "let width = this._cullingZoom + 4;",
        to: "let width = this._cullingZoom + 5;",
    },
];

function makeTree(m: Mutant): string {
    const dir = join(CACHE_DIR, "mutants", m.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    // packages/*/node_modules are relative symlinks into ../../../node_modules/.bun
    cpSync(join(REPO_ROOT, "packages"), join(dir, "packages"), { recursive: true, verbatimSymlinks: true });
    symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
    const path = join(dir, m.file);
    const src = readFileSync(path, "utf8");
    if (!src.includes(m.from)) throw new Error(`mutant ${m.name}: pattern not found in ${m.file}`);
    let out = src.replace(m.from, m.to);
    if (m.also) {
        if (!out.includes(m.also[0])) throw new Error(`mutant ${m.name}: second pattern not found`);
        out = out.replace(m.also[0], m.also[1]);
    }
    writeFileSync(path, out);
    return dir;
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : undefined;
    const list = only ? mutants.filter((m) => only.includes(m.name)) : mutants;
    const rows: string[] = [];
    let caught = 0;
    for (const m of list) {
        const t0 = performance.now();
        const results = await runGate({ tree: makeTree(m) });
        const by = (k: "strict" | "canonical") => results.filter((r) => r[k].length).map((r) => r.scenario);
        const strict = by("strict");
        const canonical = by("canonical");
        const hit = strict.length + canonical.length > 0;
        if (hit) caught++;
        rows.push(
            `${hit ? "CAUGHT" : "MISSED"} ${m.name.padEnd(22)} strict: ${strict.join(",") || "-"}  canonical: ${
                canonical.join(",") || "-"
            }  (${((performance.now() - t0) / 1000).toFixed(0)}s)`,
        );
        if (args.includes("--verbose")) rows.push(formatResults(results));
        console.log(rows[rows.length - 1]);
    }
    console.log(`\ncaught ${caught}/${list.length}`);
    process.exit(caught === list.length ? 0 : 1);
}
