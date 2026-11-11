# Acceptance tests for #547: smaller bakes from written pages and changed array ranges

Written first, from issue #547 (its Scope, five acceptance criteria and Proof line: "The 32 MiB item's checkpoint sizes
and seeks, the 30-minute grid's bake, and the forced ring budget"), its Oracle page (`doneright/oracles/issues/547.md`
in DeepBuildAI/deepbuild, branch `doneright`: no upstream test for any criterion), the design sections it names and the
base commit, by a job that never saw an implementation; none existed, and no other branch, worktree or pull request was
read. The base is this worktree's HEAD, `3c36f9180` ("Merge pull request #2232 …"). The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 547 --repo windoliver/deepbuild`, and its Oracle page; #532 and #535, which it
  depends on, for context.
- `docs/canvas-primitives.md`: Logic `logic@1` (`checkpoint {every, budget}`, `budget.memory`, `step_rate`, the read
  region's control slots); Logic: checkpoints and bake (the first and every eighth checkpoint whole, the rest the 64 KiB
  pages written since the one before; a restore from the last whole one and the pages after it; spacing doubling past
  the budget, a dropped checkpoint's pages merged into the next; the bake's arrays as changed ranges with every array
  whole at each checkpoint; playback rebuilding arrays that must match the step hashes; its Cost line's "32 MiB memory
  that writes 3 pages a turn stores 192 KiB"); Net: rollback (how written pages are found); Net: desync and replay (a
  match's recorded track); Transport (`span: open`); Logic: mirror reads (ranges as the bake keeps them); Logic: saves;
  Carried state: the cache manifest; Check input: logic kinds.
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks; Saves), Rollback,
  Dogfooding. AGENTS.md.
- At the base: `crates/deep-logic` (`lib.rs`: the calls `check`, `bake` with restores, probes and seeks, `determinism`,
  `open`, `step`, `--planted`; `world.rs`: checkpoints, the ring, its thinning and restores; `piece.rs`: the item's
  params), `crates/deep-canvas-sandbox/src/rewrite.rs` (memory.fill and memory.copy marking pages, and #531's planted
  `tracker_skips_memory_copy`), the suites `tests/acceptance/531/`, `532/` (the model: its README, helpers.ts,
  programs.ts), `535/`, `544/` (its assembler), `1575-redraft-ac1/` (how a suite calls `judgeLimit`), and
  `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`).

What the base already does, which these tests don't credit (the issue: "No test proves them yet, so criteria 1 and 3
prove them here"): checkpoints of the pages written since the one before, with the first and every eighth whole;
restores from the last whole one and the pages after it; a ring that doubles its spacing past its budget and merges a
dropped checkpoint's pages into the next; bakes with restores, probes and seeks; logic.determinism; `open` and `step`
sessions; each step record's `pages`. It reports none of a ring, has no `playback` or `seek` call, no playback run or
`element` in logic.determinism, no `cache` on `open`, no `deep_hash` in a step's reply, answers a seek with no
checkpoint before it by refusing the whole bake, has none of this suite's planted names, and keeps every step's arrays
whole in a bake (a 108,000-step bake of a 9,216-element array doesn't fit in memory there).

## Run them

```sh
npm ci                          # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH                 # rustup's cargo (helpers.ts also adds it when present)
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/547 --testTimeout=600000 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/547
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set):

- **The assembler**: #544's `tests/acceptance/544/wat/` (crate `acceptance-544-wat`: #532's, copied; `wat =1.263.0`,
  `wasmparser =0.263.0`; outside the workspace, its own `Cargo.lock`), used read-only, into
  `target/acceptance-544-wat/`. #532's own copy isn't used: its lockfile predates `.cargo/config.toml`'s later patches,
  so `cargo build --locked` refuses it at this base. It turns the programs in `programs.ts` into bytes.
- **`deep-logic`** for this Mac: `cargo build --locked --bin deep-logic` in the checkout (the dev build, as #532's
  suite and the repo's other timing reads use).

Every test passes an explicit 90-minute timeout (it overrides `--testTimeout`): criteria 2 and 4 play 108,000 and
72,000 steps several times. Temporary folders (binaries, assembler output, the session's cache) are deleted; processes
this suite starts are stopped by their PIDs. Node built-ins and vitest only. **`scripts/lanes.mjs` needs
`'tests/acceptance/547/'` in its `alone` list**: the files build cargo binaries, run bakes of many minutes and read
wall-clock seek times (criterion 4). This README is the instruction; the implementer makes that edit.

Gates: an assembler that doesn't build is `BLOCKED:` (a failed test, never a pass). Criterion 4's timing is wall-clock,
read on the test's own clock and judged by the perf lane's rule (below): off a quiet reference Mac its tests skip as
`INCONCLUSIVE`, neither a pass nor a fail, with every reading printed; its other assertions (the state each seek lands
on, the steps it re-runs, the cache's bytes) fail whatever the machine. No reading that is missing passes.

`BASE-FAILURE.txt` is the run at the base (its first lines give the counts and why). Each test calls first what the base
lacks (a ring, `playback`, a step's `deep_hash`, a planted name), so at the base every test fails within a second,
before its slow legs.

## The surface under test

The issue names checkpoints of written pages, the ring's budget and spacing, bakes of changed array ranges, playback,
keyframes spilled to the cache, seeks timed on the reference Mac, logic.determinism and planted twins, but no command
line. As in #531's and #532's suites, the surface is `deep-logic`: **every call, field and planted name below that the
issue or the design doesn't give is this job's invention**, the smallest surface the criteria need, extending #532's
JSON-lines protocol (its README: deep-logic); the implementer builds exactly these, or a dispute goes to a blind redraft.
Calls and fields not named here stay as #531's and #532's READMEs define them.

### `deep-logic`: what this suite adds

| Call | Reply |
|---|---|
| `{"call": "bake", …}` (#532's) | #532's `Bake`, plus `"ring": {<logic ID>: Ring}`. A seek to a step at or before which the ring holds no checkpoint answers `{"to": s, "from": null, "error": "no_checkpoint"}` in its place, and the bake's other seeks are answered as before |
| `{"call": "playback", …the fields of bake but restores, probes and seeks, "at": [k]}` | the check first (a refusal answers as `check` does), then `{"ok": true, "stored": {<logic ID>: {"arrays": bytes}}, "arrays": [{"step": k, "arrays": {"<logic ID>.<name>": [value]}}]}`, `arrays` in the order of `at`, no step records |
| `{"call": "determinism", …}` (#532's) | #532's, with a playback run (below) and `"element"` on every failure |
| `{"call": "open", "piece", "track"?, "cache"?: {"dir": path, "budget": bytes}}` (#531's) | #531's |
| `{"call": "step", "session", "to": k}` (#531's) | #531's, plus `"deep_hash": {<logic ID>: 16 hex}` |
| `{"call": "seek", "session", "to": k}` | `{"ok": true, "to": k, "from": c, "deep_hash": {<logic ID>: 16 hex}}` |

```text
Ring = {"budget": bytes, "bytes": bytes, "spacing": steps, "checkpoints": [Kept]}
Kept = {"step": c, "whole": bool, "pages": [page index], "memory": bytes, "globals": bytes, "bytes": bytes}
DetFailure = #532's, plus "element": an element index | null, and "run" may be "playback"
```

What each field means:

- **The ring.** Each item's checkpoint ring as it stands once the bake's last checkpoint is taken (the state after its
  last step): `budget` its byte budget (`checkpoint.budget`), `bytes` what its checkpoints count against it together,
  `spacing` the steps between the checkpoints it takes now (`checkpoint.every`, doubled each time it passed its budget),
  and each checkpoint it holds, in step order: `whole` (it holds the whole memory); `pages` the 64 KiB page indices
  whose bytes it holds, ascending (every page of memory for a whole one, else the pages written since the checkpoint
  before, found as the rollback ring finds them, with the pages of any checkpoint dropped between them merged in);
  `memory` the bytes of memory it holds (its pages × 65,536); `globals` the bytes of the program's globals it holds; and
  `bytes` all it counts against the budget (at least `memory` + `globals`). A checkpoint whose store failed isn't in
  the ring. The bake's `checkpoints` (#531's) still list each checkpoint's full-state hash as the straight run took it.
- **Playback.** `playback` bakes the piece as `bake` does and keeps the bake as the logic module keeps it: each step's
  changed element ranges with their values, and every array whole at each checkpoint. `stored` is the bytes that bake
  keeps for each item's arrays. `arrays` gives, for each step k in `at`, each array as step k left it, rebuilt from the
  bake alone, never running the program: the whole arrays of the last checkpoint at or before it and the ranges of the
  steps from there through k.
- **logic.determinism's playback run.** Beside #532's runs (`twice`, `seek`, `probe`), logic.determinism plays the
  bake back as `playback` does, every step, against the arrays the straight run wrote and its step hashes; when they
  part it gives one failure `{"run": "playback", "step": the first step whose rebuilt arrays differ, "field": "array",
  "array": the first array that differs, "element": that array's first element (by index) that differs, "from", "at"
  and "checkpoint": null}`. Every failure carries `element` (null unless it names one).
- **Sessions with a cache.** `open` with `cache` opens a recorded match's replay (here, a two-player track): as the
  session steps, each item keeps its checkpoint ring as a bake does (`checkpoint.every`, `checkpoint.budget`) and a
  keyframe every 10 s of play (every 10 × `step_rate` steps: the state before steps 0, 300, 600, … at 30 Hz), spilled
  to files under `cache.dir`, which together hold at most `cache.budget` bytes. `step`'s `deep_hash` is each item's
  full-state hash once step `to` has run. `seek` restores, into fresh instances, the nearest checkpoint or keyframe the
  session holds at or before the state after step `to` (reading a keyframe from the cache), runs steps `from` to `to`
  and answers once the state after step `to` stands: `from` is the step it restored (the state before step `from`),
  `deep_hash` that state's full-state hash. The session then stands there.

### Planted twins of `deep-logic` (`--planted <name>`)

Each changes only what its row says, reachable only through this argument:

| Name | Criterion | The wrong program |
|---|---|---|
| `tracker_skips_memory_fill` | 1 | the page tracker misses the pages memory.fill writes, as #531's `tracker_skips_memory_copy` misses memory.copy's: they're in no step's `pages` and no checkpoint of pages |
| `ranges_drop_second_at_step_5000` | 2 | the bake's range writer drops the second, by index, of the changed ranges of step 5,000 from the bake; playing is unchanged |
| `ring_drops_oldest` | 3 | a ring past its budget drops its oldest checkpoint and keeps its spacing, instead of doubling it |
| `keyframes_held_in_ring` | 4 | a session with a cache keeps no keyframe there: a seek restores only from the item's checkpoint ring under its own budget (64 MiB, `checkpoint.budget`'s default), whose spacing doubles past it |
| `store_fails_at_step_120` | 5 | the store of each item's checkpoint at step 120 fails, so the ring doesn't keep it; nothing else changes. Not a wrong program but criterion 5's condition; the wrong program it shows up is a ring that clears its record of written pages before a store succeeds |

## Programs

`programs.ts` holds the logic programs as WebAssembly text; each comment says what it does and the item it's built for.
Each reads at most one control and writes one array, so its region entries sit at offset 0, which each test checks in a
`check` reply (or `open`'s) first. `pages3` (32 MiB; every step an i64 store on page 200, a 256-byte memory.fill on page
400 at slot k mod 256, and `sum` on page 0, beside its read region; globals `$knob` and `$acc`), `grid` (9,216 i32
cells; step k changes cells (7,919 k) mod 9,216 and 4,608 further on, to 4 (k + 1) + (brush & 3) and its negation: two
ranges, always real changes, 3,064 and 7,672 at step 5,000), `bytes64` (64 pages; one byte in each every step, each read
before it's written), `match` (300 units for two players at 30 Hz in 7 MiB: page 0 the regions, page 1 the units, pages
2 to 9 a map each unit stamps, pages 10 to 111 seeded noise from the start function and `init`; each step every unit
sums a serial chain of square roots over all 300 units, about 8.2 million fuel a step, then moves toward its player's
target), `intervals` (16 pages; steps 60 i to 60 i + 59 write page 4 + i, besides page 0).

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID. Host: this Mac (macOS arm64) for every test.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#547.7471f558` | `ac1-written-pages.test.ts` (2) | `pages3`, 1,440 steps on a seeded knob track, a checkpoint every 60, ring budget 256 MiB (all 25 kept): every step's `pages` are 0, 200 and 400; the ring's checkpoints 0, 480, 960 and 1,440 (its first and every eighth) are whole, 32 MiB in 512 pages; the other 21 hold 196,608 bytes (192 KiB) in pages 0, 200 and 400, and each holds globals; a seek 30 steps past each of the 24 checkpoints below the last restores it and gives playing's step hashes to the next checkpoint, that checkpoint's full-state hash and a 20-step continuation probe's; logic.determinism at 23.5 s (step 1,410) passes. `tracker_skips_memory_fill`: logic.determinism fails, its seek failures are exactly those from the 21 checkpoints of pages at or before step 1,410, each on the full-state hash of the checkpoint 60 steps after it (from 60: checkpoint 120). Fails: checkpoints all whole or all pages, a tracker that misses memory.fill, a restore from the wrong whole checkpoint, a check that names no checkpoint |
| 2 `#547.1bfe7240` | `ac2-array-ranges.test.ts` (2) | `grid`, 108,000 steps on a seeded brush track: `playback`'s `stored` for the grid is under 80 MiB, against 108,000 × 36,864 bytes (3.7 GiB) kept whole each step, and at least 864,000 bytes (the changed values); at 100 seeded steps playback gives the grid this test works out from the program's rule and the track. `ranges_drop_second_at_step_5000`: logic.determinism (sampled at 1 s) fails with exactly one playback failure: step 5,000, `grid.cells`, element 7,672; without the plant it passes. Fails: a bake that keeps arrays whole each step, playback that runs the program or loses a range, a check that never plays the bake back or names no element |
| 3 `#547.afa00681` | `ac3-ring-budget.test.ts` (2) | `bytes64`: a 60-step bake's checkpoints 0 (whole) and 60 (pages) each hold 64 pages and count the same bytes B; 7,200 steps with `checkpoint.budget` 20 × B leave the ring within it, spacing 480, its checkpoints 0, 480, …, 7,200, each B; 20 seeded seeks each restore a checkpoint the ring holds at most 480 steps back and give playing's step hashes, the next checkpoint's full-state hash and a 20-step continuation probe's. `ring_drops_oldest`: the ring keeps none before 6,060, the first seeded seek before 6,060 (to 4,497) fails naming its step, and so does every seek before 6,060. Fails: a ring that passes its budget, drops old checkpoints or thins to another spacing, a seek from a dropped checkpoint |
| 4 `#547.636c1d36` | `ac4-keyframes.test.ts` (2) | `match` on a seeded two-player order track in a session with a cache (512 MiB budget): played through 72,000 steps, the cache folder holds at least one file and at most 512 MiB; each of 20 seeded seeks lands on playing's full-state hash after its step and re-runs at most 300 steps (10 s) from what it restored; a warm-up round, then five timed rounds, and each seek's five wall-clock readings are judged against 2 s (below). `keyframes_held_in_ring`: every seek still lands on playing's state, and the rule calls at least one seek FAIL, named. Fails: keyframes kept in memory only or over the budget, a ring whose spacing passes 10 s, a seek that misses 2 s |
| 5 `#547.cb4a7b2c` | `ac5-failed-store.test.ts` (1) | `intervals`, 300 steps, with `store_fails_at_step_120`: the ring holds 0 (whole), 60, 180, 240 and 300 and no 120; checkpoint 60 holds pages 0 and 4, 180 holds 0, 5 and 6 (both intervals), 240 holds 0 and 7; a restore from 180 for 120 steps gives the straight run's full-state hashes at 180, 240 and 300, step hashes and arrays. Without the plant: the ring holds 120 (pages 0 and 5) and 180 holds 0 and 6, and playing's full-state hashes are the planted run's. Fails: a record of written pages cleared before its checkpoint is stored, a restore that loses page 5 |

Test count: 2 + 2 + 2 + 2 + 1 = 9.

### Criterion 4's timing

The criterion's 2 s is wall-clock on the reference Mac. A seek's reading is the time from its `seek` line written to its
reply read, on this test's clock. Each seek runs once as warm-up and then once in each of five rounds; the load is read
at each round's start and end. Each seek's five readings go to `judgeLimit` on `fingerprint()` from
`scripts/benchmark.mjs`, imported, not copied (design: Numbers version 0 has to hold; The reference Mac): it counts only
on a reference Mac (Mac15,7, Mac15,12 or Mac17,10), on mains power, with Low Power Mode off, the thermal state nominal
and the one-minute load at each round's start and end within the core count; PASS when all five are within 2 s, FAIL
when all five are over it by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. Criterion 4's
first test fails when any seek is FAIL, naming it, skips as INCONCLUSIVE when none is FAIL and any is INCONCLUSIVE, and
passes only when all 20 are PASS. Its planted test passes when any planted seek is FAIL (printing which), skips as
INCONCLUSIVE when none is FAIL and any is INCONCLUSIVE, and fails when all 20 are PASS.

Why the numbers fit: at the base the dev `deep-logic` steps `match` in about 2.8 ms of CPU a step on this Mac under
load (600 steps: 1.77 s user), so a seek that re-runs at most 300 steps takes under 1 s. The planted ring of 64 MiB
can't keep 76 checkpoints 960 steps apart (at least 10 of them whole at 7 MiB pass 64 MiB) and thins to 1,920 or
more; 14 of the 20 seeded seeks are over 1,000 steps past a multiple of 1,920.

## Readings where the issue leaves a choice

- **The surface.** `deep-logic` again: the criteria need checkpoint contents, a bake's sizes, playback, a check's
  failures, a session timed seek by seek and planted twins; deep-show's documents aren't driven. "Its bake" is the
  logic module's bake of the item; logic.determinism is #532's call.
- **"The first and every eighth"**: the ring's checkpoints at index 0, 8, 16, … (eight checkpoints apart), as the base
  takes them: steps 0, 480, 960 and 1,440 at every 60.
- **"Stores 192 KiB of pages plus its globals"**: `memory` 196,608 in pages 0, 200 and 400 exactly, and `globals` > 0;
  the claim leaves out the item's one-element array.
- **"A seek from each of 24 checkpoints"**: a seek 30 steps past each checkpoint below the last (0 to 1,380), which
  restores it; "the same full-state hashes and continuation probes as a straight run": #532's seek comparison.
- **"Fails logic.determinism on the full-state hash of the first checkpoint after the seek, naming that checkpoint"**:
  logic.determinism's seek failures, each `field` deep_hash and `checkpoint` the one 60 steps after the checkpoint it
  restored. A seek from a whole checkpoint restores every page, so only seeks from checkpoints of pages fail.
- **"Keeps its arrays in under 80 MiB of its bake"**: `playback`'s `stored`, the logic module's count of the bytes its
  bake keeps for the item's arrays; the test also holds it to at least the bytes of the values the steps changed, so a
  count of nothing fails. "About 3.7 GiB kept whole each step" is the test's own arithmetic: 108,000 × 9,216 × 4.
- **"The arrays the program wrote at 100 sampled steps"**: worked out by the test from the program's rule and the track
  (`written` in the test; checked against the base's own bake of the first 300 steps before this suite's base run).
- **"Fails logic.determinism at step 5,000, naming the array and the element"**: the playback run's failure; "the second
  changed range" is the second by index of step 5,000's two, 3,064 and 7,672. logic.determinism samples 1 s.
- **"Restore one at most 480 steps back"**: the seek's `from` is a checkpoint the ring holds and `to − from ≤ 480`.
- **"Fails the first seek before it, naming the step"**: the seek to the first seeded step before 6,060, in the seeds'
  order (4,497), fails by #532's seek comparison above, and the failure names that step.
- **"A recorded 72,000-step, 300-unit match"**: a two-player order track played in a session with a cache; "lands": the
  `seek` reply, once the state after its step stands; "with keyframes under a 512 MiB cache budget": the session's
  `cache.budget`, and the cache folder's files, by size, within it after the match is played. The Scope's "so a seek
  re-runs at most 10 s of steps" is asserted as `to + 1 − from ≤ 300`.
- **"A planted ring held to 64 MiB misses 2 s, naming the seek"**: the same rule calls at least one planted seek FAIL,
  and the test prints it.
- **"With one checkpoint's store planted to fail"**: the store of checkpoint 120; "the next checkpoint" is 180; "a
  restore from it gives the same deep hash as a straight run": #531's restore from 180 for 120 steps, its full-state
  hashes at 180, 240 and 300 against the straight run's.

## Harness checks at the base

Before the base run: every program assembles, and the base `deep-logic` admits and runs it without a trap: `pages3`
writes pages 0, 200 and 400 every step (313 fuel); `grid`'s arrays over its first 300 steps equal the test's own
working; `bytes64` writes all 64 pages every step; `intervals` writes pages 0 and 4 + ⌊k ÷ 60⌋; `match` takes 8,229,423
fuel a step of its 10,000,000, writes pages 0 to 9, and plays all 72,000 steps of its seeded track (1,623 orders) in a
base session without a trap, in 3.8 minutes on this Mac under a load of 30 to 130. The base's own bake seeks show its ring keeping every checkpoint of `pages3` under 256
MiB (each seek restores its checkpoint, the next 60 on) and thinning `bytes64`'s at 20 checkpoints' bytes to 480 apart
(each seek restores a multiple of 480 at most 479 back); the base's logic.determinism passes `pages3` at 23.5 s.

Not checked: anything of the surface this suite adds (the base has none of it); the 108,000-step grid in a bake (the
base can't hold it); the timing of seeks from keyframes.

## Not tested, because no criterion reaches it here

An open span's bake (Transport), mirror reads, saves and the save format's pages, the cache manifest's restart and
eviction rules, `compare: cross_machine` and `web`, the web runner, logic.budget, and rollback across a match's
network.
