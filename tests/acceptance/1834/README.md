# Acceptance tests for #1834: logic fires a world's inputs

Written first, from issue #1834 ("Logic fires a world's inputs: how a step marks a fire, and the fire reaching the world
as an input entry": its Scope, two acceptance criteria and its Proof line, "The lab fixture fired by a logic item,
played, seeked and replayed, and the planted late fire failing"), its Oracle page (`doneright/oracles/issues/1834.md` in
DeepBuildAI/deepbuild, branch `doneright`: no upstream test checks either criterion), the design sections it links and
base commit `5fcfb690b` ("Merge pull request #3079 …"), by a job that never saw an implementation; none existed, and no
other worktree, branch, pull request, plan or session was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion,
one test per clause that needs its own run, plus the planted twin criterion 1 names; `deep-show run` for the document
(the logic module, the core's input track and the physics module in one build), `deep-physics` for the replay.

## What was read

- The issue, live with `gh issue view 1834 --repo windoliver/deepbuild` (no comments), and its Oracle page.
- `node scripts/design-section.mjs --issue 1834`: `docs/technical-design.md` The logic module (Logic, Sandbox and
  budgets, Logic bake and checks, Occurrences from logic, …) and `docs/canvas-primitives.md` Input track entries (`on:
  {logic: ID}`: "takes the entries that logic item fires, which the logic module puts on the core's input track as
  derived entries that follow from its steps and are never stored"; "a logic item's `fires` is checked against the inputs
  the world declares"). Around them: Check input: logic kinds and its **As built (#194)** paragraph on `logic.tuning`
  and `fires` (the fire region at `fires_at`, its slots, "at the world's first step at or after the logic step's
  time", the refusal "naming the item and the input", `fires_and_reads` "until #1834"). AGENTS.md.
- At the base, only for the surfaces these tests drive: `tests/acceptance/522/` (README, helpers, `ac2`'s scene played
  by `eval`, `ac3`'s `physics_bake` and replay, `twins.json`, tsconfig), `tests/acceptance/1918/`, `2010/` and `2009/`
  helpers (through 522's), `tests/acceptance/194/` (README, `programs.ts`'s tuner and platformer, `ac12`'s fire),
  `tests/acceptance/538/helpers.ts` (`assemble`, `putEvidence`), `531/` and `532/` (their README and helper shapes);
  `crates/deep-logic/src/piece/fires.rs`, `piece.rs` (optional exports), `piece/checks.rs` (the fire region),
  `planted.rs`; `crates/deep-play/src/fires.rs` and `derive.rs`; `crates/deep-show/src/physics.rs` (`physics_bake`),
  `physics/derive.rs`, `logic.rs` (`inline_logic`, the logic twins a scenario's `planted` reaches), `main.rs`'s
  `planted`; `crates/deep-canvas-physics/src/doc/inputs.rs` (a kind's fields and `number_fields`);
  `crates/deep-physics-rapier/src/inputs.rs` (a launch); `crates/deep-canvas/src/time.rs` (`step_length`);
  `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs` (`twins.json`), `scripts/lanes.mjs` (`lane.json`).

**What the base already does, which these tests don't credit.** The issue's text predates #194, whose build went "far
enough for a tuning value to reach a world" (As built (#194)): `crates/deep-logic/src/piece.rs` no longer refuses
`fires` by name. A logic item may declare `fires: {world → [input ID]}`; each input takes a slot in the fire region at
the exported global `fires_at` (an i32 count, then one f64 per number field of its kind); the logic module clears the
counts before a step and a step that leaves one above 0 fires once (`deep-logic` `piece/fires.rs`); deep-show bakes
the fires before the worlds and keeps them in the form as `logic_fires`, each reaching the world input `on: {logic:
<item>}` at the world's first step at or after the logic step's time (`deep-play` `derive.rs`), and `physics_bake`
keeps it as `from: "logic:<item>"`. At check, `deep-play` `fires.rs` refuses a fire of an input the world doesn't
declare, one not on that item, and a world input on the item that the item's `fires` doesn't list, naming the item and
the input; an item that both fires into a world and reads it is refused, `fires_and_reads`, "until #1834". There is no
planted late fire: no `fire_one_step_late` among `deep-logic`'s twins or the logic twins a deep-show scenario's
`planted` reaches. The base run wasn't taken (no build grant came on this machine); BASE-FAILURE.txt says why, and
what the base should give by this reading: the planted twin's test fails (`bad_input`, an unknown `planted` name), and
the other two pass.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 300 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/1834 --testTimeout=600000 --no-file-parallelism --reporter=verbose
npx tsc -p tests/acceptance/1834/tsconfig.json
rm -rf tests/acceptance/1834/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll` (or at its first program), honoring `CARGO_TARGET_DIR`, with
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set and Homebrew's rustup put on PATH when present, and
copies each binary into a temporary folder:

| File | Builds |
|---|---|
| `ac1-fire-launch.test.ts` | `cargo build --locked --bin deep-physics` (#2009's helper); `cargo build --locked -p deep-show --bin deep-show` (#522's helper, no feature: the full set); #544's assembler (`tests/acceptance/544/wat`, in `target/acceptance-538-wat`, #538's helper) |
| `ac2-undeclared-fire.test.ts` | deep-show (the full set); #544's assembler |

Every test passes a 60-minute timeout (#2009's `TIMEOUT`); a file's builds have 60 minutes each. Evidence stores and
binaries are temporary and deleted. Node built-ins and vitest only; `../522/helpers.ts` (and through it `../1918/`,
`../2010/` and `../2009/helpers.ts`) and `../538/helpers.ts` are imported read only. No process is started but `cargo`,
`deep-physics`, `deep-show` and the assembler, each waited for; none is stopped by name or port. `lane.json` runs the
folder alone, since each file builds deep-show. Nothing here depends on time or load. No cargo on this machine is
`BLOCKED:` (#2009's helper), a failed test, never a pass.

## The surface under test

The issue names a logic item's `fires`, a step that marks a fire, derived entries on the input track, a refusal at
check and a planted logic module, but no command line. **Every call, field, flag and planted name below that the issue,
the design or the base doesn't give is this job's choice**, the smallest the criteria need, extending #522's and #194's
surfaces as written. The implementer builds exactly these, or a dispute goes to a blind redraft.

### The program (`helpers.ts`: `coachProgram`)

WebAssembly text assembled by #544's assembler, one page of memory: `reads_at` 0, `writes_at` 4096 (its one write, `k:
i32`, the step's number), and `fires_at` 4352. The fire is marked as the As built (#194) paragraph lays the fire region
out, which the base runs: for each input the item's `fires` lists, in declaration order, an i32 count and then one f64
for each number field of its kind. **A launch's number fields are read as its scalar ones, `vertical` alone** (the
base's `number_fields("launch")`); its `linear` and `angular` are three numbers each and come from the world input's
own fields. So the coach's slot for `kick` is the count at 4352 and `vertical` at 4356: at its step 240 the program
leaves the count at 1 (and `vertical` 0), and at every other step it writes 0 there. Whatever text the design gains
for "how a step marks a fire in its write region", a program written to the As built layout must keep firing so.

### The lab fixture (`helpers.ts`: `labScene`, `launchWorld`)

#522's ball-and-goal lab (#2010's `ballAndGoal`, a checkpoint every 60 steps, its grab and release) with its ball at
rest at the kick spot, as #522's criterion 3 sets it, and the world input **`kick: {kind: "launch", targets: ["ball"],
on: {logic: "coach"}, linear: [6, 3, 0.4]}`**. As a scene (#1918's `sceneDoc`): 4 s at 60 fps, `seed` 1834, requiring
scene3d, logic and physics, the world `lab` with its ball's pose an output to the scene's ball (`items/ball/at`), a
camera, and the logic item **`coach`**: `{kind: "logic@1", params: {program: <sha256>, step_rate: 70, writes: {k:
{type: "i32"}}, fires: {lab: ["kick"]}}}`, the program listed as an asset `coach_program` with a CC0 license and put in
the scenario's evidence store by its SHA-256. The replay's world (`REPLAY`) is the same world with its ball's position
an output of its own.

### deep-show (the full set), driven unchanged

#393's scenario (#1918's helper), the agent's `deep_show` with `issues`, `eval` with `paths` (`items/ball/at/pos`), and
#522's `physics_bake {doc, world}` → `{ok, key, steps, step_hashes, inputs: [Kept]}`, `Kept = {step, kind, target,
data, input, from, written}`. A refusal at check is the `deep_show` reply's `outcome: "refused"` with an error issue.

### `deep-physics`, driven unchanged

#522's `bake {world, track, steps}` with `track: [{step, kind, target, data}]`, its `step_hashes` and `bodies`.

### The planted twin (`twins.json`)

| Name | How a run selects it | The wrong program |
|---|---|---|
| **`fire_one_step_late`** | a deep-show scenario's **`"planted": "fire_one_step_late"`**, a logic twin (`deep_logic::Planted`) that deep-show's scenario reaches as it reaches `check_compares_step_hashes` and `logic_reads_wall_clock` | the logic module writes each fire as if the logic step after the one that marked it had marked it: a fire marked at logic step k reaches the world at its first step at or after logic step k + 1's time, with the same data. Nothing else changes; the run answers ok |

### Steps

An entry stamped `step: k` applies at the start of the world's step from the state after k steps to the state after
k + 1 (#522's step convention): it first shows in `step_hashes[k + 1]`. Logic step k's time is k × its step length
(705,600,000 / 70 = 10,080,000 flicks), as the base's fire rows give `t`. The coach's step 240 is at 2,419,200,000
flicks, 411.43 world steps of 5,880,000; **the world's first step at or after it is 412** (`firstWorldStep`). Logic
step 241 is 413.14 world steps, so the planted twin's launch lands at **414**.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s, computed from the live issue. Each `describe` and `it` title starts with its
criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#1834.9a12b06c` | `ac1-fire-launch.test.ts` (2) | One deep-show run presents the lab fixture, evaluates the scene's ball at frames 207 (a seek straight past the launch), 0, 205, 206, 207, 208, 239 (played) and 206 (a seek back), and answers `physics_bake` for `lab`. The bake keeps exactly one launch: step 412, target ball, input kick, `from: "logic:coach"`, `linear` (6, 3, 0.4). `deep-physics`'s bake of the kept entries gives the same 481 step hashes (the replay); the judge passes (one launch from the coach to kick at 412, and the step hashes those of a `deep-physics` bake with that one launch at 412); in the replay the ball rests after step 412 and is launched at 6 m/s along x after 413; and the scene's ball at each frame f is the replay's ball after step 2f within 1e-6 m. Under `fire_one_step_late` the bake keeps the launch at 414 and the judge fails, a failure naming step 412. Fails: a fire that never reaches the world, a launch at 411 (the step at or before) or another step, a fire written late, derived entries not kept or replayed differently, a scene that doesn't show the launch when played or seeked |
| 2 `#1834.0e85ef5d` | `ac2-undeclared-fire.test.ts` (1) | One deep-show run: the lab fixture (`fires: {lab: [kick]}`) is presented with no error issue; the coach with `fires: {lab: [lift]}` (the world also taking `lift`, a poke of the ball, `on: {logic: "coach"}`) and the coach with no `fires`, each while the world's `kick` takes `on: {logic: "coach"}`, are refused, each with an error issue naming `coach` and `kick`. Fails: a fire of an undeclared input admitted, a refusal that names neither, every fire refused |

Test count: 2 + 1 = 3.

## Readings where the issue leaves a choice

- **"Its step 240".** The coach's own step 240, at 70 Hz: at the default 60 Hz logic step 240 falls on world step 480
  exactly, and "the world's first step at or after it" would be no different from the step at or before it or the
  nearest. At 70 Hz they are 412, 411 and 411.
- **"Launches the ball at the world's first step at or after it"**: the bake keeps the launch stamped 412 (applied
  from the state after 412 steps), the step hashes are those of a bake with that one launch at 412, the ball rests
  after 412 steps and moves at 6 m/s after 413.
- **"A replay gives the same step hashes"** is #522's: `deep-physics`'s bake of the same world with the entries the bake
  kept as its track, since derived entries aren't stored.
- **"Played, seeked and replayed"** (the Proof line): the scene's ball evaluated by `eval` at frames in order and out
  of order, first straight to a frame after the launch, each equal to the replay's.
- **"Writes the fire one step late"**: one step of the logic item's own (the logic module writes the fire), so at 70 Hz
  the launch lands two world steps late, at 414. **"Fails, naming the step"**: the judge's failure names step 412, the
  step the launch was due, from the first step hash that differs (`step_hashes[413]`).
- **"Fires an input its `fires` doesn't declare"**: a program marks fires only in the slots its `fires` lays out, so
  an item fires an input its `fires` doesn't declare only through a world input `on: {logic: <item>}` its `fires`
  doesn't list. Both forms are tested: `fires` naming another input of the world, and no `fires`. A world input the
  item's `fires` names but the world doesn't declare is the other check (Input track entries), not this criterion.
- **"Refused at check, naming the item and the input"**: the `deep_show` reply's outcome `refused`, with an error issue
  whose fields (#522's `names`: `ids`, `path`, `actual`, `what`, …) hold `coach` and `kick` as whole words. Its code
  isn't pinned.

## Not tested, because no criterion reaches it here

The design's text on how a step marks a fire in its write region and where it falls among the step's other writes
(Scope, first item: a docs change, for diff review); an item that both fires into a world and reads it (`fires_and_reads`
at the base); a fire's number fields carried as data (a jump's height is #194's criterion 12); several fires in a step,
fires into several worlds, a fire after a scrub or a fork, the web player and logic.determinism with fires. They are
follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- `fire_one_step_late` in `deep-logic`'s planted twins and among the logic twins a deep-show scenario's `planted`
  reaches (`crates/deep-show/src/logic.rs`).
