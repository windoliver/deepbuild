# Acceptance tests for #492's two open clauses

Written blind from issue #492, the design and base commit `c12a65bb`, by a job that saw no implementation and read no
other worktree or branch. The first suite for this issue, on another branch, left these two clauses out of reach. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft (design: Dogfooding).

| Clause | Test | Expected |
|---|---|---|
| Criterion 7, the world half | `world-remap.test.ts` | A reverse remap whose target reads a world with inputs is refused, naming the remap and the read |
| The same clause, its twins | `world-remap.test.ts` | The same reverse remap over a world with no inputs, or read off the target, and a half-rate remap over the same target, are accepted |
| Criterion 13, the corpus half | `corpus-join.test.ts` | The committed corpus file holds the fixture and its recorded values; the default kit names it and passes |
| The same clause, its twin | `corpus-join.test.ts` | A copy with one recorded number changed fails the kit, naming the document, the item and the time |

## What was read

- The issue, with `gh issue view 492 --repo windoliver/deepbuild`.
- `docs/canvas-primitives.md`: Time remap; World and backend `physics.world@1`; Input track entries; Occurrence list;
  Physics output; Driver; Clip; Placement; Channel and key; Item and kind; Document (`worlds`); Migration.
- `docs/technical-design.md`: Dogfooding. AGENTS.md: Proof.
- At the base: `crates/deep-motion/src/main.rs`; `crates/deep-canvas-motion/src/doc.rs`, `occurrence.rs`, `module.rs`;
  `crates/deep-canvas/src/document/mod.rs`, `check.rs`; `crates/deep-show/src/kit/migration.rs`, `mod.rs`;
  `scripts/canvas-kit.mjs`; `tests/acceptance/138/` and `491/`.
- Probes of the base build, on throwaway documents outside this folder: `corpus_record` and the `migration` part. They
  gave the file's and the report's shapes; no expected value comes from them.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/492-gaps --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/492-gaps/tsconfig.json
```

`cargo` must be on PATH. Each file builds its binary once, in `beforeAll`, so the files run one at a time:
`scripts/lanes.mjs` needs `'tests/acceptance/492-gaps/'` in its `alone` list, an edit for the implementer. Every `it`
passes `TIMEOUT` (30 min). Vitest leaves a cache in `node_modules/.vite` here; delete it.

## The surface assumed

### Clause 1: `deep-motion eval`

Each document is one input line, `{doc, times: [0, <3 s in flicks>]}`. Accepted means `ok: true`. Refused means
`ok: false`, and the answer's JSON holds the remap's ID and the read.

- **A world that takes inputs.** A `physics.world@1` document, `profile: world`, inlined as the value under the scene's
  `worlds`: `worlds: {pond_world: {format, id, profile: "world", title, description, capacity, items: {ball},
  inputs: {shove: {kind: "poke", targets: ["ball"], impulse: 1}}}}`. The design writes `worlds: {ID → doc handle}`, but
  an eval line holds one document and nothing resolves a handle, and the base's check already requires each `worlds`
  entry to be an object.
- **A world that takes none.** The same document with `inputs` left out, and again with `inputs: {}`.
- **A placement's item reading that world.** The scene's placement `take` binds its clip's slot to item `mover`. The
  driver `fall_read`, on `items/mover/at/pos/1`, reads `count(hits)` with `vars: {hits: {list:
  "pond_world.occurrences"}}`, the design's `<world ID>.occurrences` in the filter form drivers take.
- **The remaps.** `time_remaps: {rewind_take: {target: "take", map: ...}}`. Reverse is `map: "reverse"`, as at the base.
  Half rate is the design's `map: channel (parent flick → child flick)`: `{type: "f32", keys}` with 0 at 0 s and 3 s in
  flicks at 6 s, linear. Its child time stays at or behind its parent's.
- **The profile.** `scene`, the profile the design lists `worlds` under.
- **Naming the read.** Either `pond_world` or `fall_read` in the answer.

The off-target twin keeps the world with inputs and moves the driver to `bystander`, an item outside the placement, so
a program that refuses any reverse remap beside such a world fails.

### Clause 2: `deep-show run` and the kit

- **The file.** `crates/deep-show/kit-corpus/replace-keeps-unkeyed.json`, as `corpus_record` writes it: `name`,
  `document`, `times`, `values` and `snapshots`, the last two keyed by flick.
- **The default kit.** `{call: "kit", parts: ["migration"], param_sets: 10}`, sent as `scripts/canvas-kit.mjs` sends its
  call, from the checkout root to `target/debug/deep-show`. It names no `corpus`, as the script's call doesn't, so the
  kit must read the committed folder by default. The script itself isn't run: it rewrites the tracked ledger, runs every
  part and prints no passing case's name. `parts` and `param_sets` only narrow the run.
- **A case.** Any module's `migration` part may hold it: the tests look across all modules. It is the case named
  `replace-keeps-unkeyed`.
- **A changed copy.** The file with the first number of one recorded item at the last sampled time raised by 1, in a
  temporary folder, read through the kit's existing `corpus` field. The committed file is never written.
- **Naming the document.** The design's failure names the kind, item, field and time, so the document is named by the
  failing case's name. The tests also check the failure's `item` and `t`.
- **x, y and `visible`.** A channel target ending in `at/pos/0` or `x`, `at/pos/1` or `y`, and `visible`.

## Not settled by the design, or not pinned here

- A world's outputs (`Physics output`) have fields but no stated place in a world document, so a read through an output
  bound to an item path isn't tested. A program that sees only the driver form passes.
- Nothing says what `<world ID>.occurrences` reads in `deep-motion`, which runs no world. The twins read only `ok`.
- The `map` channel's exact shape is this job's reading: the design says only `channel`, gives no `target` for it and
  no type for flick values.
- A replay or a hitstop beside such a world isn't tested: the design doesn't settle how a preset with fields is written.
- `values` at the base hold `core.lowered`, the item as authored, the same at every time. A held x or `visible` shows
  only in `snapshots`, though Migration says "evaluated values". The test requires recorded values at each time and at
  least two different snapshots, not x and `visible` in `values`.
- `migration.rs`'s `uses` admits a document to a module only by that module's kinds, and bare kinds such as `rect@1`
  belong to none. At the base a corpus document of only such items reaches no part, and the kit still says PASS. The
  tests fail that case, since they need the named case.
- If the implementer passes `corpus` in the script instead of defaulting it in the kit, the first corpus test fails.
- The tests don't pin that a sampled time falls inside placement B, or that the recorded document equals the fixture,
  which this job couldn't read.
