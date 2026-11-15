# Acceptance tests for #213: between-step services and mirror reads

Written first, from issue #213 (its Scope, Fields, eight acceptance criteria and Proof line: "The hit-scan run and its
probe beside it; the seek comparison; the trap and the refusals with what each names; the mirror's comparisons in play
and after seeks; and each planted service's and mirror's failure"), its Oracle page (`doneright/oracles/issues/213.md` in
DeepBuildAI/deepbuild, branch `doneright`, and the two vendor files it pins), the design sections it names and base
commit `fe5a88f17` ("Merge pull request #2447 …", which holds #1919's, #522's, #531's, #532's, #547's and #200's
merges), by a job that never saw an implementation; none existed, and no other worktree, branch, pull request, plan or
session was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding). Lean: one file per criterion, one test per clause that needs its own run, plus a test
for each planted twin the criteria name. The Oracle page's ported criterion-1 tests are in `tests/acceptance/213-oracle/`.

## What was read

- The issue, live with `gh issue view 213 --repo windoliver/deepbuild`; its Oracle page and its vendor copies of the
  upstream engine's `query_pipeline_subshapes.rs` and the upstream geometry library's `cuboid_ray_cast.rs`.
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks; Between-step services;
  Mirror reads); Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Logic `logic@1` (its fields, exports, region map and read-region fill); Logic: checkpoints
  and bake; Logic: between-step services; Logic: mirror reads; Check input: `physics.query`; Registry and seal:
  registries; ID and sub-address; Phase (a logic step runs before a physics step at one time).
- At the base, read only for the surfaces these tests extend: `tests/acceptance/531/`, `532/`, `547/`, `544/` (the
  `deep-logic` protocol, its pieces, layouts, bakes, restores, logic.determinism and planted twins; #544's assembler),
  `1919/` and `522/` (`deep-physics`'s `query`, `bake` of a scene's world, `--planted`), `1918/` (scenes with worlds and
  channels in `deep-show run`), `539/` (`deep-show run`'s `logic` call, scenario `planted`), `200/` (the registries
  listing, packs refused naming a registry's fill, the seal's refusal line), `412/` (`plugin_entries`, `deep_kinds`
  list), `538-redraft-ac8/` (budgets), `2009/helpers.ts` (world builders, the `deep-physics` build, imported read only);
  the crates' Cargo edges (`deep-logic` links neither physics crate; `deep-physics-rapier` links no logic; `deep-show`
  links both), `crates/deep-logic` (`lib.rs`'s calls, `piece.rs`'s fields and layout, `bake.rs`), `crates/deep-show`
  (`picks.rs`'s `logic` call, `logic.rs`, `main.rs`'s scenario fields, `kinds.rs`'s listing of plug-in entries),
  `crates/deep-canvas/src/registry/core_lists.rs` (`logic.service@1`), `crates/deep-canvas-physics/src/backend.rs`
  (`query()`), `crates/deep-physics-rapier/src/runner.rs` and `scene.rs`; `scripts/benchmark.mjs` (`judgeLimit`,
  `fingerprint`, `validateBudgets`), `scripts/lanes.mjs`, `benchmarks/budgets.json`, `scripts/proof-change.mjs`.

What the base already does, which these tests don't credit: `logic.service@1` is the core's registry with fill
`[module]`, a fixture rule and a planted entry `answers_after_next_step` as data; `deep-logic` refuses a logic item's
`services` and `mirrors` ("isn't built yet"); `deep-show run`'s `logic` call steps a document's logic items with no
world beside them and answers each step's hash and arrays; `deep-physics` bakes a world (alone, or one a scene lists,
its kinematic bodies following the scene's channels) and answers physics.query's ray probe on a stored bake; the
pack check refuses a pack's entry in a registry packs can't fill; `deep_kinds` lists every scenario plug-in entry.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/213 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/213/tsconfig.json
rm -rf tests/acceptance/213/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set and Homebrew's rustup put on PATH when present (#2009's helper), and copies each
binary into a temporary folder:

| File | Builds |
|---|---|
| `ac1-hit-scan.test.ts` | `cargo build --locked -p deep-show --bin deep-show`; `cargo build --locked --bin deep-physics` (#2009's helper) |
| `ac2-seek-results.test.ts`, `ac3-trap-fuel.test.ts` | `deep-show` |
| `ac4-registry.test.ts` | `deep-show`, and `cargo build --locked -p deep-show --bin deep-show --features test-cast-sorts-by-id` |
| `ac5-crowd-mirror.test.ts`, `ac6-whole-copy.test.ts`, `ac7-region-order.test.ts` | `cargo build --locked --bin deep-logic` |
| `ac8-budgets.test.ts` | `deep-show` and `deep-logic`; on a reference Mac at rest only, both again with `--release` |

Programs are WebAssembly text (`programs.ts`) assembled by #544's assembler (`tests/acceptance/544/wat`, read only) into
`target/acceptance-544-wat/`. Every test passes a 60-minute timeout (criterion 8's two hours); folders (binaries, the
evidence store, bake stores, the pack) are temporary and deleted. Node built-ins and vitest only; `../2009/helpers.ts`
is imported read only (world builders, `deep-physics`'s build and runner, `statesOf`, `cargoError`), and
`scripts/benchmark.mjs` and `scripts/lanes.mjs` are imported for criterion 8. No process is started but cargo, the
assembler, `deep-show`, `deep-logic` and `deep-physics` (and the `sysctl`, `pmset`, `osascript` and `sw_vers` reads of
`fingerprint`), each waited for; none is stopped by name or port.

Gates. No cargo is `BLOCKED:` (#2009's helper), never a pass. Criterion 8's timings are judged only where the perf lane's
rule holds: `judgeLimit` given five zero readings against a limit of 1 must read PASS (a reference Mac on mains power,
Low Power Mode off, thermal state nominal, the load at each run's start and end under the core count); otherwise the
test fails `INCONCLUSIVE:` with the rule's reason, after every reading that doesn't depend on the machine has passed,
never a pass, and is never retried. Nothing else here depends on load.

## The surface under test

The issue names fields, a registry, a service, a trap kind, regions, logic.determinism and planted wrong programs, but
no command line. **Every call, field, reply field, flag, cargo feature, scenario name and layout below that the issue
or the design doesn't give is this job's invention**, the smallest the criteria need, extending #531's, #532's, #544's
and #547's `deep-logic`, #539's `logic` call and #200's and #412's listings in `deep-show run`, and #1919's
`deep-physics`; their READMEs' surfaces stand as written. The implementer builds exactly these, or a dispute goes to a
blind redraft.

**Which binary.** A criterion that needs a logic item and a physics world together is driven through `deep-show run`,
the only binary at the base that links both modules (the logic module only reads `logic.service@1`; the physics module
fills it). Mirror reads need logic items alone and are driven through `deep-logic`, which carries restores, layouts,
logic.determinism and `--planted`. physics.query is #1919's `query` on `deep-physics`.

### Logic item fields (`deep-logic` pieces and documents alike)

- `services: {"physics.cast@1": {"max_per_step": m}}` and the program's immutable i32 export `services_at`.
- `mirrors: [{"array": "<logic ID>.<name>", "at": global name}]` and, for each, the program's immutable i32 export of
  that name: the address of the whole mirrored array, laid out as its writer's array is (#531's element sizes).

### The services region (physics.cast@1's request and result layouts)

Little-endian; as in a control's read slot, a u32 followed by an 8-byte value is followed by 4 zero bytes; vec3 is three
f64, quat four. With one service, its block starts at `services_at` (more services follow in declaration order, each
block on an 8-byte boundary):

```text
+0                    u32 request count (the program's), 4 zero bytes
+8                    max_per_step requests, 160 bytes each
+8 + 160 m            u32 result count (the module's: the requests it answered), 4 zero bytes
+16 + 160 m           max_per_step results, 520 bytes each          block size 16 + 680 m
request (160 B):  +0 kind u32 (0 ray, 1 sweep, 2 overlap), +4 world u32 (its handle), +8 groups u32 (a mask over the
                  world's collision_groups, bit i the i-th name), +12 shape u32 (0 sphere, 1 capsule, 2 box; 0 for a ray),
                  +16 max f64 (a ray's, m), +24 from vec3 (a ray's origin; a sweep's from.pos; an overlap's at.pos),
                  +48 dir vec3 (a ray's direction; a sweep's to.pos), +72 rot quat (a sweep's from.rot; an overlap's
                  at.rot), +104 rot2 quat (a sweep's to.rot), +136 size vec3 (a sphere's radius; a capsule's half height
                  and radius; a box's half extents)
result (520 B):   +0 hits u32 (0 to 8), 4 zero bytes, then 8 hits of 64 B:
hit (64 B):       +0 id u32 (the body's handle), +4 address u32 (the shape use's index in the body), +8 point vec3,
                  +32 normal vec3, +56 distance f64
```

The tests write only ray requests and read `hits`, `id`, `point`, `normal` and `distance`. Hits are sorted by distance,
then ID; a result holds the first 8.

### `deep-show run`: the `logic` call (#539's) and what this suite adds

`{"call": "logic", "doc", "steps": n, "check"?: "logic.determinism", "at_times"?: [s], "seeks"?: [{"to": s}],
"regions"?: true}` runs the document's logic items from step 0 to n − 1 **beside the worlds the document lists**, each
world stepping as the scene's simulate phase steps it (a logic step runs before a physics step at one time), and its
services answered right after each step (Logic: between-step services). Reply, beside #539's `steps` (`step`, `t`,
`hash`, `arrays`), `track` and `check`:

| Field | Meaning |
|---|---|
| `handles: {"worlds": {<world ID>: u32}, "bodies": {<world ID>: {<body ID>: u32}}}` | the u32 each world and each of its bodies is interned to (ID and sub-address), the numbers a request's `world` takes and a hit's `id` gives; there whenever the document lists worlds; they depend on the document's IDs alone, not on a program's bytes |
| `steps[k].fuel: {<logic ID>: n}` | the fuel step k used: the program's own, plus 4,000 for each request step k − 1 had answered |
| `steps[k].service_ns: {<logic ID>: ns}` | the CPU time the services took answering what step k asked, right after it; 0 for an item that asked nothing or has no services |
| `steps[k].mirror_ns: {<logic ID>: ns}` | the CPU time the logic module took updating the item's mirrors before step k; 0 for an item without mirrors |
| `steps[k].regions: {<logic ID>: {"services": hex}}` | with `regions: true`, each item with services: its services block as step k read it, before `step(k)` ran |
| `checkpoints: {<logic ID>: [{"step", "deep_hash"}]}` | each item's checkpoints as play took them (#531's form) |
| `traps: [LogicTrap]` | #531's form; a services trap has `kind: "services"`, **`service`** (its name) and **`count`** |
| `seeks: [SeekResult]` | #532's `SeekResult` (`to`, `from`, `hashes`, `checkpoint: {step, deep_hash}`) per seek asked, plus `regions` as play's, of step `to` |
| `check` | logic.determinism (#532's runs) over the same world, sampled at `at_times` when given (s, step ⌊t × 60⌋); each failure (#532's `DetFailure`) also carries **`region`**: `"services"` or `"reads"`, the first region whose bytes as the failing step read them differ, else null |

Step k's arrays, hash, fuel and regions are its own; a trapped item's arrays keep its last good step's.

### `deep-show run`: registries

- A pack's `pack.json` `entries: {"logic.service@1": [entry]}` is refused at its pack check (#200's: `packs` lists it
  `refused`, with an error issue naming the registry and its fill, `module`).
- A plug-in's entry in a registry whose fill doesn't take plug-ins stays listed in `deep_kinds`' `list`, as #412 lists
  every plug-in entry (#412 AC8, whose `test.mark@1` doesn't take them either), with `origin: "plugin"`,
  `available: false` and **`refused: {"code", "registry", "fill": [...]}`** naming the registry and its fill. One rule
  for every such entry, so #412's `plug.square` gains a `refused` too and stays listed unavailable.
- `registries` lists `physics.cast@1` in `logic.service@1` with `module: "physics"`, `origin: "first_party"`, its kit
  result and `value` holding at least `max_per_step: 256` and `fuel_per_request: 4000`.
- The seal's refusal line is #200's (`ok`, `code: "seal_refused"`, `reason`, `modules`, `arrays`, `what`, `registry`,
  `entries`, `rules`, `passes`); an entry the conformance fixture refuses gives `reason: "entry_refused"`, `registry`,
  `entries` naming the entry, `rules` the kit rule, plus **`request`**: the index, from 0, of the fixture's request whose
  answer differed.

### `deep-logic`: what this suite adds

| Call or field | Meaning |
|---|---|
| `bake` gains `"arrays"?: ["<logic ID>.<name>"]` | the arrays its step records, its restores' and its probes' hold, and its `ranges`; absent: all, as before (a 100,000-element vec3 array in every step record would be gigabytes of JSON) |
| step records' `items[id].mirror_ns` | as `deep-show`'s `mirror_ns`, 0 for an item without mirrors |
| `check`'s `layout.entries` | each mirror's list is a read-region entry `{"region": "reads", "name": <array path>, "type": "ranges", "size": 2052}`, after every entry `reads` names, in `mirrors` order; the layout digest covers them |
| a refusal of a mirror | `logic_refused` naming the item, with a refusal whose field **`mirror`** is the array path |
| logic.determinism's failures | carry `region` as `deep-show`'s do |

**A mirror's list** in the read region: a u32 count, then `{first: u32, count: u32}` per range with nothing between,
256 ranges' room (2,052 bytes), or the count 0xFFFFFFFF when the whole array was copied. The ranges are in element
indices, ascending.

### Planted twins

Each is one criterion's wrong program, reachable only through its switch, and changes nothing else; the judge that
passes the real program must fail on it.

| Switch | Criterion | The wrong program |
|---|---|---|
| scenario `planted: "cast_answers_after_next_step"` | 1 | physics.cast@1 answers each request from the world after one more world step than the state the asking step read |
| scenario `planted: "results_after_checkpoint"` | 2 | the logic module writes a step's results into memory after that step's checkpoint is taken, not before |
| `deep-show` feature `test-cast-sorts-by-id` | 4 | the physics module's physics.cast@1 sorts each request's hits by ID, then distance; the seal runs the registry's kit on it |
| `deep-logic --planted mirror_whole_after_restore` | 5 | after a restore, each mirror's first step copies the whole array and lists the count 0xFFFFFFFF instead of the checkpoint's pending ranges |
| `deep-logic --planted mirror_lists_before_reads` | 7 | the read region's fill, and the layout, put the mirrors' lists before the entries `reads` names |

`twins.json` maps each criterion's ID to its twins. A scenario planted twin acts after the seal, so the run shows what
the wrong service or module reads; a planted service built in would be refused at the seal by its kit.

## Programs and fixtures

`programs.ts`: `shooter` (one ray from the origin along +x at step 30; every step copies the answers' count, the first
answer's hit count, and its first hit's id, distance and point.x), `flood` (a request count of 257 at step 20, k into `n`),
`meter` (k mod 4 rays at step k, the same work every step), `volley` (256 rays around the circle every step, summing the
answers' hits), `caster` (the Oracle lane's batches), `ticker` (k into `n`), `crowd`, `mirrorReader` and `plainReader`
(an FNV-1a checksum over 8-byte words of the mirror, or of the plain read; the mirror reader also copies its list),
`scatter`, `selfish`, `left`, `right`, `panel` (copies its read region's first 4,800 bytes), `bulk`, `reader8`.
`fixtures.ts`: the range (a 1 × 4 × 4 m wall centred at x = 10.5 m, its face at 10 m, static or kinematic following
`items/wall/at/pos` from 10.5 m at 0 s to 8.5 m at 2 s, and a static post at (5, 5, 0) off the ray), its scene, and the
handle probe (the scene with `ticker`, stepped once, for `handles`). Criterion 8's level is in its file.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed from the live issue. Each `describe` and `it` title starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#213.170f7e56` | `ac1-hit-scan.test.ts` (2) | The static range: steps 0 to 30 read no answer; step 31 reads one answer, one hit, naming the wall's handle (not the post's), at 10.000 m within 1 mm, its point at x = 10; step 32 none. physics.query's ray probe on `deep-physics`'s bake at world step 60: PASS, ids `[wall]`, its value the shooter's within 1e-6 m. The moving range: the real service's distance is the wall's face at world step 60 in `deep-physics`'s bake of the scene's world within 1 mm; `cast_answers_after_next_step` reads 1/120 m less (within 1e-4 m) and the judge fails naming the ray and step 31. Fails: an answer during a step, from another state, naming another body |
| 2 `#213.1361c0e3` | `ac2-seek-results.test.ts` (2) | A checkpoint every step: a seek to 31 restores the checkpoint before step 31 (`from` 31), reads play's services block byte for byte (one hit at 10 m on the wall) and play's step hash, and reaches play's deep hash at checkpoint 32; logic.determinism at 0.54 s passes. `results_after_checkpoint` fails it with a failure naming step 31 and `region: "services"`. Fails: results kept outside the checkpoint, a check that never compares the region |
| 3 `#213.b4f8dc3a` | `ac3-trap-fuel.test.ts` (2) | `flood`: one trap, `{step: 20, kind: services, service: physics.cast@1, count: 257}`; `flood.n` is k to step 19 and 19 from step 20. `meter`: step k's fuel is step 0's plus 4,000 × ((k − 1) mod 4) for k = 1 … 40. Fails: a dropped request or a clamp, arrays from the trapping step, fuel charged to the asking step or not at all |
| 4 `#213.f2c2a3f9` | `ac4-registry.test.ts` (2) | `test/castpack@1.0.0` is refused at its pack check naming `logic.service@1` and `module`; the plug-in's `test.caster.peek@1` is listed with origin plugin, `available: false` and a `refused` naming `logic.service@1` and `module`. The full set lists physics.cast@1 (physics, first party, kit PASS, 256 a step, 4,000 fuel); `test-cast-sorts-by-id` is refused at the seal: `entry_refused`, `logic.service@1`, physics.cast@1, a rule and the `request`. Fails: a fill that takes outside entries, a kit whose fixture can't see the sort |
| 5 `#213.38e13b08` | `ac5-crowd-mirror.test.ts` (2) | 600 steps: at every step `rules.sum` equals `plain.sum`; from step 1 rules' list is crowd's 10 runs of step k − 1 (step 0: empty or whole); 10 seeks to seeded steps (restores of the checkpoint at or before each) give play's list and both sums there. logic.determinism at 2.55 s passes the real mirror; `mirror_whole_after_restore` fails it with a seek failure from checkpoint 60 or 120 naming that step and `region: "reads"`. Fails: a mirror that misses a range, a list that doesn't name the runs, pending ranges not in the checkpoint |
| 6 `#213.8ba60177` | `ac6-whole-copy.test.ts` (2) | `scatter` changes 300 single elements at step 9: watch's step 10 reads the count 0xFFFFFFFF and a mirror equal to plain's read, and so does a seek to 10 (the restore of checkpoint 10), with play's mirror. `selfish` mirroring `selfish.cells` is refused at check (`logic_refused`, item `selfish`), a refusal naming the array in a field of its own. Fails: 300 ranges listed past the 256 room, a seek that lists them, a self-mirror admitted |
| 7 `#213.62c17765` | `ac7-region-order.test.ts` (2) | `check` puts knob's slot, then left.vals' list, then right.vals' (2,052 bytes each) in the read region; the program exporting that layout's digest is admitted; over 7 steps each step's bytes at those offsets hold knob's entries (1 at step 2, 2 at step 4, values 0.25, 0.5, 0.75), left's two ranges and right's one of the step before. `mirror_lists_before_reads`: knob's slot moves past both lists, the digest changes, and the program built for the real layout is refused, `logic_refused` naming `panel`. Fails: lists before reads, offsets the digest doesn't give |
| 8 `#213.16543e66` | `ac8-budgets.test.ts` (1) | On any machine: volley's steps read 256 answers with at least 256 hits and pay at least 1,024,000 fuel, each with a positive `service_ns`; reader8 lists 64 ranges a step with a positive `mirror_ns`; `ticker` reads `service_ns` and `mirror_ns` 0 at every step and pays the same fuel in `deep-show` as in `deep-logic`. `benchmarks/budgets.json` holds `logic-between-steps` (below), valid by the lane's validator, and `scripts/lanes.mjs` times this file. Gated: release builds, a warm-up and five runs; `cast_256_ms` (the median `service_ns` of volley's steps 0 to 58) under 1.3 and `mirror_1pct_ms` (the median `mirror_ns` of reader8's steps 1 to 63) under 0.1 by `judgeLimit` |

Test count: 2 + 2 + 2 + 2 + 2 + 2 + 2 + 1 = 15.

## Readings where the issue leaves a choice

- **"The same state"** (criterion 1): Logic: between-step services answers "each world as its last step before step k's
  time left it", and at one time a logic step runs before the physics step (Phase). For a 60 Hz item beside a 120 Hz
  world, step 30 (0.5 s) reads the state after 60 world steps (the last world step before 0.5 s is step 59), which is
  physics.query's `state: {step: 60}`. "Equal to a physics.query ray probe" is the same hit to within 1e-6 m and the
  same body.
- **The moving wall's reference** is the wall's face in `deep-physics`'s bake of the scene's world at that state, since
  physics.query reads a world document alone and a kinematic body moves only by a scene's channel. "1/120 m short" is the
  planted reading against the real one within 1e-4 m; the wall moves toward the origin at 1 m/s, so a later state is
  nearer. "Fails, naming the query and the step" is the judge (distance against the reference within 1 mm) failing with
  a message naming the ray and step 31.
- **Handles.** The design interns IDs to u32 handles; a program needs its world's to ask and a hit names a body's. The
  `logic` reply lists them, and a program that names its world is assembled after a probe run of the same scene with
  `ticker` reads them.
- **"Step 30's checkpoint"** (criterion 2) is the checkpoint taken after step 30, before step 31 (#531's label 31), the
  only one a result written "after" it could miss; the item checkpoints every step so it exists. logic.determinism
  samples step 32, so a seek run restores it. **"The region"** is `services`.
- **"In the bake"** (criterion 3) is the `logic` call's run, whose step records are the bake's. "The last good step's"
  arrays: the trapping step's writes are dropped, as #544 reads a trap.
- **"A pack … refused, naming the registry's fill"** is #200's pack check naming `logic.service@1` and `module`. **"So is a
  plug-in that tries to register one"**: #412 AC8 keeps listing every plug-in entry (unavailable when its kit failed),
  in a registry whose fill doesn't take plug-ins too, so a refused plug-in entry is listed unavailable with a refusal
  naming the fill, rather than left out. **"Naming the request"** is the seal line's `request`, beside #200's fields.
- **"A crowd item … and a rules item mirroring them"**: a third item, `plain`, reads the same array plainly, and both
  readers checksum what they hold every step, so "the mirror's bytes equal a plain read's" is checked byte for byte
  without 2.4 MB a step in the reply. Items step together at 60 Hz, so step k's pending ranges are crowd's step k − 1
  writes. Before crowd's first step nothing changed: step 0's list may be empty or a whole copy.
- **"A seek to each of 10 seeded times"** is #531's restore of the checkpoint at or before each seeded step (drawn by
  mulberry32 seeded 213 from 1 … 599), run through it; "the next step" is that step. A missing pending range would leave
  the mirror stale at it, since crowd rewrites an element only every 99 steps.
- **"Naming the step and the region"** (criterion 5): a seek failure whose `step` is the step its restore runs first and
  whose `region` is `reads`.
- **"300 scattered ranges"** (criterion 6): 300 single elements 10 apart; the seek is the restore of the checkpoint
  before the reading step (every 10 steps).
- **"At the offsets the item's layout digest gives"** (criterion 7): the layout `check` reports, and a program exporting
  its digest as `regions_digest` admitted; **"fails the read region's digest check, naming the item"**: under the planted
  fill that program is refused, `logic_refused` naming `panel`.
- **"Answered in under 1.3 ms of CPU"**, **"costs under 0.1 ms a step"**: a run's median `service_ns` and `mirror_ns`
  over the steps that do the work, five runs judged by `judgeLimit`. **"A level of 300 static shapes"**: 296 seeded
  pillars and four closing walls, so every ray hits something. **"1% in 64 runs"**: 10,000 of 1,000,000 elements, 16 runs
  of 157 and 48 of 156. **"Gains no work"**: `service_ns` and `mirror_ns` 0 and no fuel added, beside the budget task's
  merge-base comparison. **"Compared with the merge base"** is the perf lane's and the budget window's run of the task;
  the test runs no git and gives the validator no merge-base file.

## Harness checks at the base

Before the base run, a probe (not committed) ran this suite's programs and fixtures through the base's real components:
every program assembles and passes sandbox@1's check in an item without the new fields (the base's `regions_digest`
check refuses a program exporting a digest its layout never had); `crowd`'s bake changes exactly `crowdRuns(k)` at steps
0 to 3, and `plain`, reading crowd.positions, writes at each step the checksum this test works out over the array crowd's
earlier steps left (4,800,016 fuel a step, under its 8,000,000); `scatter` changes 300 ranges at step 9 and none else;
`left`, `right` and `bulk` change the ranges `leftRuns`, `rightRuns` and 64 runs of 10,000 elements in all; the static and
moving ranges with `ticker` are presented and their `logic` call steps (no `handles` at the base), the range with a
`services` item is refused (`logic_refused`, "services isn't built yet"); physics.query's ray at world step 60 on the
static range's bake is PASS, 10 m, `[wall]`; `deep-physics`'s bake of the moving range's world puts the wall's centre at
10.5 m at state 0, 10 m at 60 and 9.99167 m at 61 (1/120 m a step toward the origin).

## Not tested, because no criterion reaches it here

Sweeps and overlaps; collision groups on a service request beyond the Oracle lane's filtered ray; more than one service
on an item; the 8-hit cap and ties sorted by ID; a mirror of an array no logic item writes, of a preview array, past
memory or overlapping a region; the 256-range boundary; mirrors across different step rates; saves, rollbacks and
matches holding services or mirrors; the web player. They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- `scripts/lanes.mjs`: `'tests/acceptance/213/'` and `'tests/acceptance/213-oracle/'` in `alone` (the files build
  `deep-show` twice and `deep-logic`, and run long bakes), and `'tests/acceptance/213/ac8-budgets.test.ts'` in `timed`.
- `benchmarks/budgets.json`: the task `logic-between-steps`, `command: ["node", "benchmarks/canvas.mjs",
  "between-steps"]`, `margin: 0.5`, `limits: {}`, `targets: {"cast_256_ms": 1.3, "mirror_1pct_ms": 0.1, "idle_work": 0}`,
  `criteria` naming `#213.16543e66` and an `initialReason` naming #213; with `benchmarks/canvas.mjs between-steps`
  measuring what the task names.

`BASE-FAILURE.txt` is the run at the base.
