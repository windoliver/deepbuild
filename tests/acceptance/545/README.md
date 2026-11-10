# Acceptance tests for #545: a turn clock that sleeps between turns, interpolated writes, and an open span

Written first, from issue #545 (its Scope, Fields, seven acceptance criteria, Proof line and its one comment), its
Oracle page (`doneright/oracles/issues/545.md` in DeepBuildAI/deepbuild, branch `doneright`), the design sections it
links and the base commit `f38d2b398` ("Merge pull request #2155 …"), by a job that never saw an implementation; none
existed, and no other branch, PR or worktree was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 545 --repo windoliver/deepbuild --comments`, and its Oracle page: one upstream
  test, for criterion 3, Bevy `12a94e0cd6` `crates/bevy_time/src/fixed.rs` (`Time<Fixed>`'s overstep_fraction: the
  time past the last fixed step over the step, 0.5 halfway through a step and 0 once it is spent), used here as the
  formula for α; the other six criteria have none. The comment: on main a write that declares `interpolate: linear`
  passes check on any type and the setting is dropped; this task refuses linear on i32 and bool, naming the write, and
  carries linear on f64, vec2, vec3 and quat through to drawing.
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks; Turn clock;
  Interpolated writes); Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Logic `logic@1`; Logic: turn clock; Logic: interpolated writes; Logic: checkpoints and
  bake; Transport; Check input: logic kinds; Shot: poses from logic; Instance `instance@1`: logic columns; Mark set:
  logic columns.
- At the base: `crates/deep-logic` (`Logic::handle` in `src/lib.rs`: `about`, `check`, `bake` with restores, probes,
  seeks and peeks, `determinism`, `budget`, `golden`, `golden_verify`, `view`, `frame`, `open`, `step`; `src/piece.rs`;
  `src/world.rs`; `src/live.rs`; `src/main.rs`'s repeatable `--planted`); `crates/deep-show/src/export.rs` (a range
  form `Span::Whole` reads `transport.span` and is refused `no_span` when it isn't a time); `crates/deep-show/src/main.rs`
  ("`full` holds no logic module yet"); `crates/deep-canvas-motion/src/doc.rs` (Transport: `span: "open"` read as
  `auto`; `loop: wrap` without a span refused `bad_time` at `transport/span`); `crates/deep-canvas/src/document/check.rs`
  (`check_transport`); `crates/deep-codecs` (h264 at 64 × 64, PCM by default); and the suites `tests/acceptance/532/`
  and `531/` (the pattern this one follows: README, helpers.ts, programs.ts, assembler, BASE-FAILURE.txt; copied and
  cut down, nothing imported), `501/` (`taste.test.ts`, `deep-show run` scenarios, exports) and `488/` (refusals at
  `deep show`).

What the base already does, which these tests don't credit: a logic item steps on a fixed clock with its seed
hash(document seed, logic ID, k); other logic items, step hashes and full-state hashes read the stored arrays; a write
may declare `interpolate: hold | linear` on any type (and the setting is dropped). It refuses `clock` and `due`
("isn't built yet"), admits linear on i32 and bool, has no `draws`, `valid_until` or `play` in a frame, takes no
`span: "open"` in a view, raises no issue at check, reports no array ranges in a bake, and has none of this suite's
planted names. deep-show refuses a whole export of an open span as `no_span`, and refuses `loop: wrap` with an open
span at `transport/span`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/545 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/545/tsconfig.json
rm -rf tests/acceptance/545/node_modules/.vite
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set;
helpers.ts puts Homebrew's rustup on PATH when present):

- **The assembler** `tests/acceptance/545/wat/` (crate `acceptance-545-wat`, a copy of #532's; `wat =1.263.0`,
  `wasmparser =0.263.0`; outside the workspace, its own `Cargo.lock`, which records the checkout's
  `.cargo/config.toml` patches as unused so `--locked` builds) into `target/acceptance-545-wat/`.
- **`deep-logic`**: `cargo build --locked --bin deep-logic` in the checkout, before each file's tests.
- **`deep-show`** with `full` (criterion 4's export half only): `cargo build --locked --bin deep-show
  --no-default-features --features full`, built when the test reaches it, after its live legs pass. It draws and
  hashes on the GPU and writes h264 through VideoToolbox, so that leg needs this Mac's GPU.

Every test passes an explicit timeout (90 minutes, over `--testTimeout`). Temporary folders (binaries, assembler
output, the evidence store and the export folder) are deleted. Node built-ins and vitest only. **`scripts/lanes.mjs`
needs `'tests/acceptance/545/'` in its `alone` list**: the files build cargo binaries (deep-show among them) and
drive long-lived processes frame by frame. This README is the instruction; the implementer makes that edit.

No test reads a CPU time, so none is INCONCLUSIVE by load. Criterion 7 is INCONCLUSIVE without its pictures and the
recorded call (The taste call, below), never PASS.

`BASE-FAILURE.txt` is the run at the base: all 17 tests fail, each on a surface the base lacks (its first lines give
why). The harness was checked against real components before that run, at the base: every program assembles, and
the base `deep-logic` runs them on a fixed clock as programs.ts says (the turn game over the 40 moves: every move's
step writes `move_at`, then W = 8 + (m mod 8) steps of the AI's turn with `due` = k + 1 and `turn_done` 0, the last
writing `turn_done` 1 and `due` 0, at all 40 moves; the first move falls at step 830, the last at 36,000; the mover
writes [k, 0, 0]; the reader reads [1, 0, 0] at its step 9; `blend` writes its f64, vec2 and quat). The export leg's
document and calls were run on the base `deep-show` (`full`): the figure with a 10 s span instead of an open one is
presented and its whole export, h264 at 64 × 64 and 8 fps with 8 kHz PCM, is exported with 80 frame hashes and
`duration` 7,056,000,000; with the open span it is presented, `loop: wrap` is refused with `bad_time` at
`transport/span`, the export with no range is refused `no_span`, and the one with a range is refused `bad_media` ("not
a time: \"open\"", the mix reading the span).

## The surface under test

The issue names fields (`clock`, `due`, `interpolate`, Transport's `span: open`), an issue kind (`logic.judder`), the
brief's `hold` list, a video export and planted modules, but no call. As in #531's and #532's suites, the logic module's
surface is `deep-logic`, extended; the video export is deep-show's. **Every call, field, reply key and planted name below
that the issue or the design doesn't give is this job's invention**, the smallest surface the criteria need; the
implementer builds exactly these, or a dispute goes to a blind redraft. Calls and fields of #531's and #532's READMEs not
named here stay as they define them. `view`'s `span` and `frame`'s `seek` and `play` are seconds; every other time (a
frame's `t` and `valid_until`, an entry's `t`, an export's `range` and `receipt.duration`) is flicks, 705,600,000 a
second; steps are step numbers.

### `deep-logic`: what this suite adds

**Logic item params** (the issue's fields):

- `clock: "fixed" | "on_input"` (default `"fixed"`) and `due: <write name>` (with `on_input`: one of the item's own i32
  writes of count 1). With `on_input`, step 0 runs, and step k runs only for an entry of a control the item reads with
  `t` in ((k − 1) × length, k × length], a reading recorded at step k, or when the last step that ran left its `due`
  array at k (a value at or before that step asks for none). A step that doesn't run writes, emits, hashes and bakes
  nothing; a step that runs keeps its number and its seed hash(document seed, logic ID, k).
- `writes.<name>.interpolate: "linear" | "hold"` (default `"hold"`). Linear on an `i32` or `bool` write is refused at
  check: `{"ok": false, "code": "logic_refused", "item": <logic ID>, "refusals": [{"rule", "what", "write": <name>}]}`,
  one refusal per such write (`rule` and `what` are the implementer's), and no refusal for a write that may be linear.

**Piece** (on `check`, `bake`, `view`), for criterion 6:

- `live: true`: the piece is played live, so drawn at 120 Hz (no brief displays are given here).
- `readers: {<reader ID>: Reader}`: the document's items that read logic arrays, as their own fields name them:
  - a shot: `{"kind": "shot", "move": {"logic": {"position": "<logic ID>.<name>", "target": "<logic ID>.<name>"}}}`
  - an instancer: `{"kind": "instance@1", "columns": {<column>: {"array": "<logic ID>.<name>", "as"?: dtype}}}`,
    columns among `pos`, `rot`, `proto`, `live`, `gen`
- `brief: {"hold": [<write name>]}`: the brief's `hold` list, by the write's name as its item declares it (the issue's
  `hold: [position]`); a name listed marks that write's hold as meant.

**`check`** answers `{"ok": true, "items": {…}, "issues": [Issue]}`, `issues` always present (`[]` with none). The one
kind this suite reads:

```text
Issue = {"kind": "logic.judder", "item": <logic ID>, "array": "<logic ID>.<name>", "reader": <reader ID>,
         "step_rate": Hz (the item's), "frame_rate": Hz (the rate it's drawn at)}
```

raised once per (array, reader) pair where a write declared `hold` on an f64, vec2, vec3 or quat array is read by a
shot's `move: logic` (`position` or `target`), an instancer's `pos` or `rot` column (or a skinned item's `pose`), in an
item whose `step_rate` is below the rate the piece is drawn at, unless the brief's `hold` names the write. It changes no
write and no draw.

**`bake`**, on a turn clock:

- `steps`: a StepRecord for each step any item ran, whose `items` and `arrays` hold only the items that ran it (on a
  fixed clock every item runs every step, as before). A step no item ran has no record: no step hash, no arrays.
- `checkpoints`: the first, `step: 0`, before step 0; then one after every `checkpoint.every`-th step that ran, whose
  `step` is that step's number + 1 (on a fixed clock, every `checkpoint.every` steps, as before). Restores and seeks
  carry the count of steps that ran, so a restore's checkpoints are playing's.
- `ranges` (new): `{<logic ID>: [{"step": k, "array": <write name>, "start": i, "end": j, "values": [value]}]}`, each
  step's changed element ranges, in step order: elements [start, end) of the write whose values step k changed (the
  arrays are zero before step 0), with their new values. A step that didn't run has none.
- `seeks` (#532's `{to}`) and `restores` (#531's `{from, steps}`) work on a turn clock: a seek's `hashes` list the step
  hashes of the steps that ran from `to` to its checkpoint; a restore's `steps` the records of the steps that ran.

**`view`** takes `span: "open"` beside a number of seconds. With an open span the view has no end: `play` (below) runs
on as far as it's asked, and a `seek` reaches only what has been played: a seek past the furthest time played lands
there, on the last step played. **`frame`** takes, beside #532's `seek` and `set`, `play: s`: live play, the playhead
moves on by s seconds (on a finite span, at most to its end). Its reply adds:

- `draws: {"<logic ID>.<name>": [value]}`: every write of every item as drawing reads it at the frame's `t` (values as
  a bake's `arrays` lay them out): a `hold` write as the last step at or before t left it; a `linear` write from step
  k − 1's value toward step k's by α = (t − t(k)) ÷ the step length, k the last step at or before t, f64 and vectors
  by lerp and quats by nlerp; on a turn clock step k − 1's value is the array as it stood before step k ran.
- `valid_until: flick | null`: until when the frame shown stays valid, so the app sleeps until then: no later than the
  time of the next step that will run (the step `due` names, or the first step at or after the next entry on the
  track) and no earlier than that entry's stamp; `null` when nothing on the track or in `due` will run a step, so the
  app submits no frame until an entry arrives.

A frame that doesn't land (`stale`) is followed by frames with no input until one does; the tests read `t`, `steps`,
`deep_hash`, `draws` and `valid_until` from the landed frame and sum `steps` over them.

### The export document (deep-show, criterion 4)

deep-show's `full` build seals no logic module, so no document it opens can hold a logic item. The export half
therefore runs on a figure with an open span, `{"profile": "figure", "size": [64, 64], "transport": {"span": "open",
"frame_rate": [8, 1]}}`, a ground rect and a block sliding across over 600 s, through `deep-show run` as #501's suite
drives it. This suite's reading: in deep-show an open span is presented and exported by range whatever the document
steps; the design's "only for live play of a piece with stepping carried state" is not a refusal any criterion asks of
deep-show. Calls and what each must answer:

| Call | Answer |
|---|---|
| `deep show` of the figure with `transport.loop: "wrap"` | `outcome: "refused"`, with an error issue whose `path` is `transport/loop` |
| `deep show` of the figure (no loop) | `outcome: "presented"` |
| `export` with `out`, `video: {codec: "h264"}`, `audio: {sample_rate: 8000}`, `size: [64, 64]`, no `range` | `{"outcome": "refused", "code": "span_open"}` (new code), and no file at `out` |
| the same with `range: [0, 423360000000]` (flicks: the recorded track's range, 0 to its last entry at 600 s) | `outcome: "exported"`, `receipt.duration` 423,360,000,000 flicks, 4,800 `receipt.frame_hashes`, the file at `out` |

### Planted twins of `deep-logic` (`--planted <name>`)

Each is one criterion's wrong program, reachable only through this argument, and changes nothing else:

| Name | Criterion | The wrong program |
|---|---|---|
| `turn_runs_at_frame_boundary` | 1 | on a turn clock an entry runs at the step of the next 30 fps frame boundary at or after its stamp (the first step at or after ⌈t × 30⌉ ÷ 30 s), not the first step at or after the stamp: the entry at 30.008 s runs step 1,802 |
| `turn_ignores_due` | 2 | on a turn clock the `due` array never runs a step: only step 0 and the steps an entry or a reading calls for |
| `linear_blends_forward` | 3 | drawing a linear write blends from step k's value toward step k + 1's by α, as a physics output blends: 1.5 m at 0.15 s |
| `open_span_reads_zero` | 4 | a view's open span is read as a span of 0: play and seeks hold the playhead at 0 s |
| `seek_restores_arrays_only` | 5 | a seek that restores a checkpoint restores its arrays (with memory, globals and input position) but not the values the linear writes held at the step before it, so drawing after it reads them unblended: seeked to 6.05 s the 10 Hz item draws 60 m |
| `judder_checks_shots_only` | 6 | logic.judder looks only at shots' `move: logic`, never at an instancer's columns |

Each twin's test runs the real program on the same input first and asserts it passes, then asserts the twin's run
fails this suite's judgement of the criterion with a failure naming what the criterion says it names: the entry
(30.008 s, flick 21,173,644,800, control `choice`) and steps 1,801 and 1,802 (1); `turn.turn_done` and the step `due`
named after the first move (2); 0.15 s, 0.5 m and 1.5 m (3); play stopped at 0 s (4); 6.05 s, 60 m and 59.5 m (5); the
instancer `swarm` (6).

## Programs

`programs.ts` holds the logic programs as WebAssembly text; each comment says what it does and the item it's built for.
Those that read or write region entries are built against the item's layout as `check` reports it, read first with
`layout_probe` (with no clock fields, which the layout doesn't depend on).

- `turn` (criteria 1, 2, 4): a turn game against an AI, reading one control `choice` (kind `choice`; the program reads
  only each step's entry count). Writes, all i32: `k`, `ran` (steps it ran), `seed` (two i32s: this step's seed),
  `moves`, `move_at` (the step that read the last move), `move_seed` (that step's seed), `due`, `turn_done`, `score`.
  A move at step m starts the AI's turn of W = 8 + (m mod 8) steps: it writes `due` = k + 1 at m to m + W − 1 and, at
  m + W, `turn_done` = 1 and `due` = 0. Its state is memory and an init-seeded xorshift64 global.
- `mover` (criteria 3, 5): 10 Hz, step k writes [k, 0, 0] into the vec3 `pos`. `reader` (criterion 3): 60 Hz, reads
  `mover.pos` and copies it into its own vec3 `seen`. `blend` (criterion 3, the comment): 10 Hz, f64 `x` = k, vec2
  `xy` = [k, 0], quat `q` = [0, 0, 0, 1] at step 0 and [0, 0, √½, √½] after. `still` (criterion 6): an empty step.
- `fortyMoves`: the 40 moves, move i near 15 i s pulled back by a seeded flick of up to 5 s, the last at exactly 600 s.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each describe and test name starts with its criterion's ID. Host: this Mac (macOS arm64), with its GPU
for criterion 4's export.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#545.f3d39699` | `ac01-turn-clock.test.ts` (3) | Idle 60 s (3,601 steps, no entry): one step record (step 0, `ran` 1), no range after step 0, checkpoints only at 0; a view's frame at 0 s shows step 0 with `valid_until` null, and frames played to 30 s and 59.9 s run 0 steps and show the same full-state hash, still null; with the entry on the track the frame at 0 s is valid from 30.008 s to step 1,801's time at most. The entry at 30.008 s: the steps that run are 0 and 1,801 to 1,810 exactly, each once (`ran` 1 to 11), step 1,801 reads it with `move_seed` equal to the seed a fixed clock gives step 1,801 (not 1,802's), every step keeps its number and fixed-clock seed, checkpoints only at 0, ranges only at steps that ran with `move_at` = [1,801] at step 1,801. `turn_runs_at_frame_boundary` reads it at step 1,802 and fails, naming the entry and both steps. Fails: a fixed clock, a step that runs without a call, a renumbered step or reseeded step, a frame valid only one step, a bake that records unrun steps |
| 2 `#545.f3b004c6` | `ac02-turns-and-due.test.ts` (3) | The 40 moves, 36,060 steps: exactly step 0 and each move's steps m to m + W run (507 steps), with `due` and `turn_done` as the AI writes them; checkpoints at 0 and after every 60th step that ran (steps 0, 4,330, 8,724, 12,528, 17,091, 20,453, 25,205, 29,632, 33,127); 20 bake seeks (ten inside AI turns) give playing's first checkpoint after them, its full-state hash and the step hashes before it; restores from every checkpoint but the last give playing's records and checkpoints. A live view played forward through 605 s and then sought to the same 20 times shows, at each, the bake's stored arrays and the same arrays and full-state hash played and seeked. `turn_ignores_due` leaves `turn_done` 0 and fails, naming `turn.turn_done` and the step after the first move. Fails: due ignored, extra or missing steps, checkpoints by step number, a seek or restore that differs from playing |
| 3 `#545.10859a3c` | `ac03-linear-writes.test.ts` (2), with `tests/acceptance/545-redraft-ac3/` (2) | An i32 and a bool declared linear are refused naming the write (and only it); f64, vec2, vec3, quat linear admitted. (The comment) f64, vec2 and quat linear draw 0.5, [0.5, 0] and nlerp([0,0,0,1], [0,0,√½,√½], 0.5) at 0.15 s and their step-0 values at 0.1 s, played and sought. The 10 Hz mover drawn played and seeked, the reader, the hashes and `linear_blends_forward` are proven by the blind redraft `tests/acceptance/545-redraft-ac3/`, which replaced this file's first two tests: they compared `draws["mover.pos"]` as one flat vector, while `draws` is laid out as a bake's arrays, a list of elements. Fails: no blend, a blend from the wrong step, a blend that reaches a reader or a hash, linear admitted on i32 or bool |
| 4 `#545.ef12c43a` | `ac04-open-span.test.ts` (2) | A view with `span: "open"` of the turn game on a fixed clock with the 40 moves plays to 600 s a second a frame, each frame landing at its time; 20 seeded seconds sought land there with playing's full-state hash; a seek to 700 s lands at 600 s with playing's state there. deep-show: loop wrap refused at `transport/loop`; no-range export refused `span_open`; the export over [0, 600 s] lasts 600 s, 4,800 frames. `open_span_reads_zero` holds play at 0 s and fails ("play stopped at 0 s, short of 1 s"). Fails: an end at any span, a seek past what was played, loop wrap admitted, a whole export of an open span |
| 5 `#545.fd1e802b` | `tests/acceptance/545-redraft-ac5/` (2) | Proven by the blind redraft, which replaced this suite's `ac05-seek-blend.test.ts` for the same reason as criterion 3's first two tests. Fails: a checkpoint without the values held a step earlier |
| 6 `#545.c54e53c9` | `ac06-judder.test.ts` (2) | Five checks of a live piece: the 60 Hz `cam.position` held and read by the shot `follow` raises exactly one logic.judder {cam, cam.position, follow, 60, 120}; linear, the brief's `hold: ["position"]` and the item at 120 Hz raise none; with the instancer `swarm` (pos from cam.position, proto from the i32 cam.kind, live and gen) exactly two, for follow and swarm, none for kind. `judder_checks_shots_only` misses swarm and fails, naming the instancer. Fails: a check of shots alone, an issue for an i32 or a linear write, no silencing by the brief |
| 7 `#545.f348ec28` | `ac07-taste.test.ts` (1) | The recorded taste call on exactly the check run's pictures (The taste call); INCONCLUSIVE without them or the call, FAIL on `looks_wrong` |

Test count here: 3 + 3 + 2 + 2 + 0 + 2 + 1 = 13, with 2 + 2 in the redrafts: 17.

## Readings where the issue leaves a choice

- **"That game"** (criterion 2) is criterion 1's turn game, with the AI's turn in the same program; criterion 1's entry
  at step 1,801 therefore also runs the AI's turn, steps 1,802 to 1,810, through `due`. "Runs step 1,801 exactly once"
  is read from the step record and the program's own count of the steps it ran.
- **"hash(document seed, logic ID, 1,801)"**: the seed the same item gets at step 1,801 on a fixed clock, which #531
  already holds to that hash; the test reads both through the program (`seed`, `move_seed`).
- **"Adds no step hash, array range or checkpoint to its bake"**: no step record after step 0, no entry in `ranges`
  after step 0, and no checkpoint but the first.
- **"Its view submits no frame in those 60 s"**: the frame's `valid_until` is null (valid until an entry arrives), and
  frames played to 30 s and 59.9 s run no step and show the same full-state hash. The contrast, a frame valid only until
  the entry when one is on the track, keeps a view that always answers null from passing.
- **"Played straight and seeked"** (criteria 2, 3, 5): played is a view moved forward by `play` one frame at a time from
  0 s, never restoring; seeked is the same view sought to the time after play has passed it (a restore), and for
  criterion 3 also a fresh view sought once. Criterion 2's checkpoint comparisons use the bake's `seeks` and
  `restores`; its "same arrays" use the view's `draws` (all held, so the stored values).
- **"The checkpoint at step 60"** (criterion 5): the checkpoint a seek to 6.05 s restores. A checkpoint taken before
  step 60 runs (#531's convention) holds step 59's arrays and runs step 60 after the restore; one taken after holds step
  60's. Either way the seek runs at most one step and must draw 59.5 m; the planted seek draws 60 m.
- **"Plays live past any authored end"** (criterion 4): with an open span the view has no end; play runs the 10 minutes
  and stops only where the test stops. "Seeks anywhere in the 10 minutes played": 20 seeded whole seconds below 600.
  "The last step played": step 36,000 at 600 s, where play stopped.
- **"A recorded track of 10 minutes"**: the 40 moves, the last at 600 s. **"One over the recorded track's range"**: an
  export whose own `range` is [0, the track's last entry], since deep-show holds no input track of this piece.
- **"A live piece … 120 Hz unless the brief names its displays"**: `live: true` with no displays given, so 120 Hz.
- **"Fails, naming …"** for a twin: this suite's judgement of the twin's output fails and a failure's text names what
  the criterion says (#532's criteria 5 and 6 did the same).

## Not tested, because no criterion reaches it here

A reading that runs a step on a turn clock; net draws completing a step; `cut` on a linear write; the `alive`, `gen` and
`live` cases where a step's value shows unblended; `logic.judder` for an instancer's `rot`, a skinned item's `pose`, a
piece that isn't live (the document's frame rate) and the brief's displays; Transport's `ping_pong` with an open span; a
golden or a check taking its range from the recorded track; bakes that grow as an open span is played; the web player.

## The taste call

The check run puts `linear-0.15s.png` and `linear-6.05s.png` (the 10 Hz item's linear write drawn at 0.15 s and
6.05 s), `follow-hold.png` (the follow camera's held pose) and `linear.apng` (a recording of the interpolated item),
each taken from the canvas's own frames, in `docs/evidence/545/`, attaches them to the PR and shows them in the session.
The call is recorded in `tests/acceptance/545/TASTE.json`: `{issue: 545, criterion: "#545.f348ec28", verdict:
"looks_right" | "looks_wrong", who, when (ISO 8601), screenshots: {<name>: sha256}, note?}`. This job writes no
TASTE.json.
