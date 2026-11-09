# Acceptance tests for #1732: arrange by relations in 3D, solved at check with nothing overlapping

Written first, from issue #1732 (its Scope, five acceptance criteria and Proof line: "The room fixture's relations
and audit, both hashes, the planted solve, the refusal and the scheduler counters"), the design sections it links and
those they lean on, and base commit `72767cf9` ("Merge pull request #1755 …"), by a job that never saw an
implementation; none existed, and no other branch, worktree, stash or PR was read. The issue has no Oracle page
(`doneright/oracles/issues/1732.md` answers 404). The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 1732 --repo windoliver/deepbuild`.
- `docs/canvas-primitives.md`: Units and axes (metres, +Y up, front +Z, R = Rz·Ry·Rx); Document (`collections`,
  `audit`); Item and kind: relations (#221's 2D relations); Frame clock and scheduler; Invalidation and damage;
  Render-back (its `include: … audit` and reply `audit`); Registry and seal and its registries; Phase (the check and
  frame phases); Constraint and Constraint: rest_on (`on: ID | collection | ground`, resolved at check, cached by
  content keys, audited); Geometry audit and Geometry audit: scenes (`scope`, `overlap {pairs, tolerance}`, `support
  {floating}`; failures name both IDs and the depth or gap).
- `docs/technical-design.md`: Dogfooding; Tests written first; "Who drafts it". AGENTS.md.
- At the base: `crates/deep-canvas-motion` (`constraint.rs`'s `rest_on`, `kit.rs`, `module.rs`), `crates/deep-motion`,
  `crates/deep-canvas-marks/src/relations.rs`, `crates/deep-canvas/src/registry/core_lists.rs`,
  `crates/deep-canvas/src/document` (the envelope's keys: `collections`, `audit`; patch ops), `crates/deep-canvas-scene3d`
  (`scene.rs`: `mark.box@1` a unit cube scaled by `params.size` about its centre, `at.pos`, `at.rot` in degrees;
  `spatial.rs`), `crates/deep-show` (`run`; `deep_show` and its `include`, where `audit` parses and does nothing;
  `deep_query` values at `items/<id>/at/pos` from `core.transform`; `eval` nodes; `frames` with its per-frame `ran`;
  the scenario's `planted`); the suites `tests/acceptance/489/`, `221/`, `420/`, `532/`, `387/`, `393/`, `411/`.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1732 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1732/tsconfig.json   # type-check (exits 0)
```

Each file builds `deep-show` once in `beforeAll` (`cargo build --locked --bin deep-show --no-default-features
--features full`, honoring `CARGO_TARGET_DIR`, with `/opt/homebrew/opt/rustup/bin` put first on `PATH`) and copies it
out under the OS temp folder; every test of a file fails when the build fails. The files build a cargo binary, so they
run one at a time: `scripts/lanes.mjs` needs `'tests/acceptance/1732/'` in its `alone` list (this job writes only this
folder; the implementer makes that edit). Every `it` passes `TIMEOUT` (30 min). Evidence folders go under the OS temp
folder and are deleted. Node built-ins and vitest only; nothing needs a GPU. `--root` leaves Vitest's cache in
`tests/acceptance/1732/node_modules/.vite`; delete it.

## The surface under test

The issue names `arrange@1`, its relation shape `{a, rel, b, d?}`, the seven relations, the geometry audit, the
scheduler's counters and a patch, but no code API. These tests extend `deep-show run`, which already presents scene3d
documents, reads evaluated values and counts frames; no new binary, subcommand or call. Everything #393's, #387's,
#411's and #420's READMEs define for `deep-show run` holds unchanged. **Every name below the issue or design doesn't
give is this job's choice** (listed again under Choices); the implementer builds exactly these, or a dispute goes to a
blind redraft.

### Documents

#420's agent form of a scene (`{format: 1, profile: "scene", title, description, size, requires, items}`, no `id`, no
`layers`), `requires.modules: {scene3d: "^1", motion: "^1"}`, and:

- Solids are `mark.box@1` with `params.size: [x, y, z]` (m), centred on `at.pos`, turned by `at.rot: [0, yaw, 0]`
  (degrees). The box is each item's true shape.
- `arrange@1` is an item (the motion module's kind): `{"kind": "arrange@1", "params": {"items": [ID], "relations":
  [{"a": ID, "rel": "on" | "inside" | "next_to" | "against" | "facing" | "near" | "apart", "b": ID | collection ID,
  "d"?: m}]}}`. `items` are the items it places; any other ID a relation names is a fixed item, which it reads and
  never moves. The fixture's arrangement item is `arrangement`.
- `collections: {room: {members: [floor, wall_n, wall_e, wall_s, wall_w]}}`: `table inside room` names the collection,
  as `rest_on`'s `on` may (Constraint: rest_on); its bounds are its members' together.
- `audit: {scope: "scene", overlap: {pairs: "all", tolerance: 0.001}, support: {floating: ["floor", …]}}`: Geometry
  audit: scenes' fields, held at 1 mm as the issue's criterion is.

### Calls

- `{"call": "deep_show", "session", "doc", "document", "include": ["issues", "audit"]}` (#393). New on the reply:
  `audit: {failures: [Failure]}`, render-back's geometry audit of the revision the reply is of (Render-back's reply
  `audit`), with `Failure = {check: "overlap" | "coincident" | "support" | "relation", ids: [ID], …}`: `overlap` for
  two items passing into each other past the tolerance (`ids` both items, plus the depth), `relation` for an
  arrangement's relation the evaluated scene misses (its JSON holds the relation's `a`, `rel` and `b` as strings,
  plus by how much). Other fields (depth, gap, time, fix) are the implementer's; the tests read `check`, `ids` and
  search the failure's JSON.
- A set the solve can't satisfy is refused at check: `outcome: "refused"`, with an error issue `{code:
  "arrange_unsatisfied", severity: "error", missed: [{a, rel, b, by: m}], …}`, `by` how far the relation still misses,
  in m (the issue's "shortfall in m"). Other fields (the overlapping pair) are the implementer's.
- `{"call": "deep_query", "session", "doc", "paths": ["items/<id>/at/pos", "items/<id>/at/rot"], "at": ["0s"]}`
  (#411): `values[path][0]` is the item's evaluated transform, the arrangement's derived value applied: `pos` in m,
  `rot` `[x, y, z]` in degrees.
- `{"call": "frames", "doc", "count"}` (#387, #856; frames 1/60 s apart from 0). New in each frame: `solves: {arrange item ID →
  n}`, the number of solves of each arrangement the frame ran, every arrangement of the document listed (0 when none
  ran). This is "the scheduler's counters" the criterion reads, beside `ran`.
- A patch is a whole revision that differs from the last only at one path (`items/lamp/at/pos`), the agent's own
  form, as #387's and #420's suites patch.

### Planted programs (scenario `planted`, each reachable only there)

| Name | Criterion | The wrong program |
|---|---|---|
| `arrange_ignores_pair_overlap` | 2 | the solve leaves out how deep the placed items overlap each other (it still keeps them out of the fixed items) |
| `arrange_solves_per_frame` | 4 | the arrangement solves again in every frame, not once per content key at check |

### Relations as these tests hold them (`helpers.ts`, `relationMiss`)

On the evaluated boxes, to 1 mm and 1°:

- `on`: a's bottom within 1 mm of b's top, and a's centre over b's top.
- `inside`: every corner of a within b's bounds (a collection's: its members' together).
- `next_to`: a side face of a lies flat on a side face of b, along that face: the planes within 1 mm, the normals
  opposite within 1°, a's face no wider than b's face where it lies, the two faces' heights overlapping; and the boxes
  touch (gap and depth each ≤ 1 mm).
- `against`: the same, with a's back face (local −Z).
- `facing`: a's front ray (local +Z) meets b's footprint grown by 1 mm, or points within 20° + 1° of b's centre.
- No arranged item turns about x or z (each rot's x and z within 1e-9°), and no two solids pass more than 1 mm into
  each other (by the separating axis test on the footprints and the y ranges).

### Fixtures (all sizes this job's choice, in m, `[x, y, z]`)

| Item | Size | Start (`at.pos`, yaw) |
|---|---|---|
| `floor` | 4.2 × 0.1 × 3.2, top at y = 0 | fixed |
| `wall_n` / `wall_s` | 4.2 × 2.5 × 0.1, at z = −1.55 / 1.55 | fixed; north is −Z |
| `wall_e` / `wall_w` | 0.1 × 2.5 × 3.0, at x = 2.05 / −2.05 | fixed; the interior is 4 × 3 m |
| `table` | 1.2 × 0.75 × 0.8 (the issue's 1.2 m table) | centre of the room |
| `chair_k` | 0.65 × 0.85 × 0.65 (an armchair) | spread on the floor; criterion 2 all at the centre |
| `lamp` | 0.2 × 0.45 × 0.2 | on the floor at (1.7, 0) |
| `shelf` | 0.9 × 1.8 × 0.35 | (0, −1.2), 0.125 m off the north wall |
| `rug` | 1.0 × 0.01 × 0.6 | (1.6, 0.95), yaw 90° |
| `fan` (criterion 4) | 0.3 × 0.05 × 0.3, floating at y = 2.2 | turned about +Y by a channel, 360° over 2 s |

The chair is 0.65 m square, so under `next_to` as held here one chair fits along each side of the 1.2 × 0.8 m table
(two along a long side need 1.3 m): four fit, six don't, at any turn.

## Criteria to tests

| Criterion | File | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 | `ac1-room.test.ts` (2) | the room is presented; every relation holds to 1 mm and 1° on the transforms deep_query reads; nothing turns off +Y; no two solids pass > 1 mm into each other, and the audit lists no overlap; two runs in one process and a fresh process give one hash of the arranged transforms, the lamp lifted by the solve (fails a solve that misses a relation, a non-deterministic search, a seed from the clock or the process) |
| 2 | `ac2-stacked.test.ts` (2) | chairs stacked at the centre: the same relations hold, no pair overlaps past 1 mm, the audit names no chair pair; `arrange_ignores_pair_overlap`: the audit fails an overlap naming two chairs, and those two pass > 1 mm into each other |
| 3 | `ac3-six-chairs.test.ts` (1) | six chairs next_to the table: `outcome: "refused"`, an error `arrange_unsatisfied` whose `missed` holds a chair's `next_to table` with `by` > 1 mm (fails a solve that places them half right, or refuses without naming the relation and its shortfall) |
| 4 | `ac4-no-solve-per-frame.test.ts` (2) | the room with a turning fan: ten frames, each after the first runs nodes (`ran` > 0) and `solves.arrangement` is 0; `arrange_solves_per_frame` makes the same check fail, each failure naming `arrangement` |
| 5 | `ac5-break-out.test.ts` (2) | a patch lifting the lamp 0.3 m: the lamp stands at the patched place (within 1e-9), every other arranged item keeps its solved place (within 1e-9), and the audit has a `relation` failure naming lamp, `on` and table; a patch sliding the lamp along the table's top: the same break-out, and the audit names nothing of the lamp (fails a re-solve that pulls the lamp back or moves the rest, and an audit that doesn't hold the relation) |

## Choices where the issue is open

1. **Surface**: `deep-show run`'s existing calls; render-back's `audit` on the `deep_show` reply; `deep_query` values
   for the transforms; `frames` for the counters. No new call.
2. **Kind and fields**: `arrange@1` as an item with `params.items` and `params.relations`; the arrangement item's ID
   `arrangement`; a fixed item is any relation's ID not in `items`.
3. **`room`** is a collection of the floor and the four walls (a solid room box would overlap everything in it).
4. **North** is −Z; the north wall is `wall_n`. Front is +Z (Units and axes); back is −Z.
5. **The relations' tests** (above), in particular `next_to` as face on face along the face, which is what makes six
   0.65 m chairs not fit a 1.2 m table, and `on` as the centre over the top.
6. **The audit's shape** (`failures`, `check` names `overlap`, `coincident`, `relation`) and that it reports a relation
   an arrangement names after a patch breaks the item out.
7. **The refusal**: `outcome: "refused"`, code `arrange_unsatisfied`, `missed: [{a, rel, b, by}]`.
8. **The counter**: `frames[k].solves[<arrange ID>]`; frames after the first are judged, since the first follows the
   revision's own check.
9. **"Two runs"**: two documents of the same content in one process; **"a fresh process"**: a second `deep-show run`;
   the hash is SHA-256 of the canonical JSON of every arranged item's `pos` and `rot`.
10. **"Keep their solved places"**: within 1e-9 m and 1e-9°. The lift is 0.3 m; the slide is 0.3 m from the table's
    centre along its length.
11. **Sizes and starts**: the fixtures table above.
12. **Planted names**: `arrange_ignores_pair_overlap`, `arrange_solves_per_frame`, as scenario `planted` values.

## Scope not under a criterion

`near`, `apart` and `d`; the solve's search, its cost terms and its seeding; keeping an item that already fits; the
contact snap; support of items not declared floating; the refusal's overlapping pair. No criterion states an
observation for them, so these tests don't check them.

## At the base

`deep-show run` presents the room, reads each box's `at/pos` and `at/rot` through `deep_query`, and counts frames
(`ran`), but `arrange@1` is skipped with the notice `unknown_kind`, `include: ["audit"]` adds nothing to the reply,
frames carry no `solves`, and neither planted name exists. `BASE-FAILURE.txt` is the run at the base on this Mac: all
9 tests fail, 7 on `arrange@1` skipped as an unknown kind (AC3's as presented where it must be refused) and the 2
planted ones on the scenario's `bad_input` for an unknown `planted` name.
