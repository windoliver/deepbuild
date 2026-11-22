# Acceptance tests for #2396: a moving rest_on reads each item's own transform, whatever order the items are listed in

These tests were written before any fix existed, by a job that had only issue #2396, the design sections it names
and the ones those lean on, and base commit `58b4a8cb2`. No other worktree, branch or pull request was read.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion, no planted program, no timing.

**Not run here.** The machine is shared and loaded, so this job built no Rust, ran no test file and made no
`BASE-FAILURE.txt`. The type-check wasn't run either: this worktree has no `node_modules`, and the main checkout's
holds no TypeScript or vitest. The implementing session runs both files against the base's own `deep-show` and
records what each meets first in `BASE-FAILURE.txt` (expected: below).

## What was read

- Issue #2396's body: the reproduction (vase rest_on table, a channel lifting the table 0 → 0.25 m over 2 s, a slab
  `flag`; listed cam, table, vase, flag it is refused `no_support`, listed cam, flag, table, vase it presents), its
  Cause, Scope, the two criteria and the Proof line.
- `node scripts/design-section.mjs --issue 2396` (canvas primitives: Builders, recipes, looks and cameras) and, in
  `docs/canvas-primitives.md`: Order keys ("a map has no order of its own"), Constraint: rest_on, The order of one
  evaluation, Determinism. `docs/technical-design.md`: Dogfooding.
- At the base, for surfaces and conventions only:
  - `AGENTS.md`; `scripts/proof-change.mjs` (`criterionId`); `scripts/lanes.mjs` (`lane.json`).
  - `tests/acceptance/2013/` (README, helpers, `ac2-rest-on.test.ts`, tsconfig, BASE-FAILURE), the model for layout
    and helpers; `tests/acceptance/379/helpers.ts` for a `camera@1` item and a channel's form.
  - `crates/deep-show/src/main.rs` (the `eval`, `deep_query` and `deep_show` calls), `frames.rs` (the `eval`
    reply's `nodes`: `operator, module, phase, item, key, result, run, thread`), `query.rs` (`values[path]`, one
    entry per time in `at`), `crates/deep-canvas/src/schedule/mod.rs` (`nodes`, `NodeReport`).
  - `crates/deep-canvas-scene3d/src/rest.rs` (the operators' registration only, to learn that a moving rest exists
    as a per-frame operator and raises `no_support`) and `builders.rs` (`slab@1 {size}` stands on its plan).
  - `crates/deep-canvas-motion/src/doc.rs`: a channel's `target`, `type` and `keys`.

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2396 --no-file-parallelism
npx tsc -p tests/acceptance/2396/tsconfig.json   # type-check
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full` (with
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set), copies the binary out of `target/` (honouring
`CARGO_TARGET_DIR`) and fails every test whose build failed. `lane.json` makes the folder run alone. Every run writes
into a temporary evidence folder and deletes it.

## The surface under test

No new call. `deep-show run` (one scenario line in, one answer line out) with the agent's `deep_show`
(`{call, session, doc, document, include: ["issues"]}`, presented when `outcome` is `presented` with no error issue),
`deep_query` (`{call, session, doc, paths, at: ["0s", "1s", "2s"]}`, `values[path][k]` the evaluated value at the
k-th time) and `eval` (`{call, doc, t}`, its `nodes` every node of the revision with its `key` and `result`).
Each listing is shown in a `run` of its own, under one document ID, so two listings differ in nothing else.

## The document (helpers.ts, `liftedDoc`)

A `scene` in the agent's form, `requires.modules` holding `scene3d` and `motion`. Metres, +Y up.

| Item | Kind | Written |
|---|---|---|
| `cam` | `camera@1` | perspective, on (0, 0.2, 0), order `a0` |
| `table` | `mark.box@1` | 1.2 × 0.05 × 0.8 m centred at the origin, order `a1` |
| `vase` | `mark.sphere@1` | radius 0.1 m, centred at (0.2, 1.0, 0.1), order `a2` |
| `flag` | `slab@1` | 0.1 × 1.5 × 0.6 m standing at (3, 0, 0), under nothing, order `a3` |

- `channels.lift`: `items/table/at/pos/1`, `f32`, 0 at 0 s to 0.25 at 2 s, linear.
- `constraints.rest`: `{owner: vase, kind: rest_on, on: table}`, every other field at its default (axis (0, −1, 0),
  true shape).
- A listing changes only the order of the `items` map's entries; IDs, order keys and fields stay, so by Order keys
  every listing is the same document.
- The vase rests where its ball meets the lifted top: centre y = lift + 0.025 + 0.1, so 0.125, 0.25 and 0.375 m at
  0, 1 and 2 s, x and z as written. The tests judge it within the geometry audit's 2 mm.

## The tests

- `ac1-either-order.test.ts`, **#2396.e524c371**: both of the issue's listings are presented, the vase is rested on
  the moving table at 0, 1 and 2 s in each, and its places are the same JSON numbers in both. Fails on: the base (the
  cam, table, vase, flag listing is refused `no_support`); a program that leaves the vase unrested in both orders; one
  that rests it once and doesn't follow the lift; one whose rest depends on the listing.
- `ac2-shuffle.test.ts`, **#2396.9c791087**: a property over listings: the reproduction's, the reverse of ID order
  and a seeded shuffle's draws for seeds 1 to 12, each once (at least 6 besides ID order). For every one, each of
  0, 1 and 2 s, the multiset of nodes as (operator, module, phase, item, key, result) equals the ID-order document's.
  Guards that the property is about something: the ID-order document has more than three nodes, each with a key and
  a result, some on `vase` and `table`, and its nodes at 1 s differ from those at 0 s. Fails on: the base (the
  reproduction's listing isn't presented); a fix that reads the right slots but keys or results a node by the listing.

## Expected at the base

Both files run the reproduction's listing first, so each should fail at "the document listed cam, table, vase, flag:
the check raises no error (no no_support)" (or at its `outcome` being `refused`), with a `no_support` issue on the
rest. Not observed here; `BASE-FAILURE.txt` is the implementing session's record of what the base binary answers.
