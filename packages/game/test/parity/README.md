# Gameplay parity with upstream survev

The fork must play exactly like upstream survev at the commit pinned in `pin.ts`. Three checks
enforce that, all run by `bun run test`:

1. **Source gate** (`sourceGate.test.ts`, under a second): every gameplay file under
   `packages/game` and `packages/shared` either matches upstream (ignoring import paths) or
   differs only by a reviewed diff in `allowed-diffs/`, each hunk with a reason. A new upstream
   commit that we haven't ported, or a fork change nobody reviewed, fails here.
2. **STRICT replay tier** (`parity.test.ts`): each scenario in `scenarios.ts` / `directed.ts` is
   replayed on the fork and on upstream (extracted from git into
   `node_modules/.cache/survev-parity/`) on the same Bun, with a seeded `Math.random` and a frozen
   clock. These must match bit for bit: definitions, map generation, per-tick state of every game
   object (reflectively, minus `ignored.ts`), bullets, gas, living-player order, RNG call counts,
   and the order grid queries return objects in.
3. **CANONICAL wire tier** (same test): every message each client receives is decoded and must
   match upstream after sorting `fullObjects`, `partObjects` and `delObjIds` by id. Order inside
   those three lists has no visible effect on the client (object ids break every render tie that
   matters); every other list keeps its order. Raw bytes are compared too, report-only.

Upstream traces are cached per pin, Bun version and harness source, so after the first run only
the fork side replays.

## Commands

```sh
bun packages/game/test/parity/gate.ts                  # replay tiers, all scenarios
bun packages/game/test/parity/gate.ts --only solo-main # one scenario
bun packages/game/test/parity/mutants.ts               # prove the gate catches known bugs
~/aot-exploration/bin/bun-aot packages/game/test/parity/bench.ts --base <tree> --cand <tree>
```

`PARITY_JOBS` caps parallel replays. To debug a STRICT failure, rerun both sides with
`PARITY_DUMP_TICK=<tick> PARITY_DUMP_FILE=<file>` and diff the dumps (`replay.ts`).

## Bumping the pin

Port the upstream commits, bump `UPSTREAM_SHA`, run
`PARITY_REGEN=1 bun test packages/game/test/parity/sourceGate.test.ts`, write a reason for every
`REASON: TODO`, then run the full gate.
