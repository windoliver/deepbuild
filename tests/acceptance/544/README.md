# Acceptance tests for #544: occurrences from logic, read by Spawn and start_on

Written first, from issue #544 (its Scope, its Fields, five acceptance criteria and its Proof line: "The shot lab's
rows and voices played, seeked and exported, the trap on a fifth row, and the door clip's start"), its Oracle page
(`doneright/oracles/issues/544.md` in DeepBuildAI/deepbuild, branch `doneright`: no upstream test for any criterion),
the design sections it names and the base commit, by a job that never saw an implementation; none existed, and no
other branch or worktree was read. The base is this worktree's HEAD, `f38d2b39` ("Merge pull request #2155"), which
holds #531, #532, #492, #500 and #501. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 544 --repo windoliver/deepbuild`, and its Oracle page.
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks; Occurrences from
  logic); Dogfooding; What done means, fixed at the start.
- `docs/canvas-primitives.md`: Logic `logic@1` (its fields, exports, region map and Semantics); Logic: occurrences;
  Logic: occurrences: offsets in a step (to read the row layout); Logic: sandbox (trap kinds); Occurrence list;
  Spawn; `start_on` and `switch`; Input track; Tour; Control (kinds).
- At the base: `crates/deep-logic` (`lib.rs`: the calls, `track`, bake keys; `piece.rs`: `emits` refused as "isn't
  built yet", the region map in declaration order; `world.rs`: traps and the step record); `crates/deep-show`
  (`spawn.rs`: a spawn reads a baked list from the document's `occurrences` and answers `unbaked_list` otherwise;
  `mixdown.rs`: `media_mix`; `export.rs`: per-frame PCM hashes; `time.rs`: `determinism`'s play and seek sides;
  `frames.rs`: `eval`); `crates/deep-canvas-motion` (`doc.rs`: `start_on`'s parse; `program.rs`: a start_on list
  resolves only `markers.*`, `input.*` and a world's empty list); `crates/deep-canvas/src/document` (the envelope's
  keys, issues and their `close` names); the suites `tests/acceptance/532/`, `500/spawn/`, `492/` and `501/` (their
  READMEs and helpers, whose patterns these follow; code copied and cut down, nothing imported);
  `scripts/proof-change.mjs` (criterion IDs).

What the base already does, which these tests don't credit: `deep-logic` bakes, seeks and runs logic.determinism on
pieces without `emits`; `media_mix` plans a spawn's voices from a list given as data; `export` hashes each frame's
samples; `deep-show`'s `determinism` and `eval` compare and draw placements. It refuses a logic item's `emits` ("emits
isn't built yet in logic@1"), skips a `logic@1` item in a document (`unknown_kind`), refuses a film document's
`spawns` (`unknown_field`), and refuses a start_on on `<logic ID>.occurrences` (`ref_unresolved`).

## Run them

```sh
npm ci                          # once, if node_modules is missing
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm   # once: criterion 2's Linux x86_64 host
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/544 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/544/tsconfig.json
rm -rf tests/acceptance/544/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll`: `deep-logic` (`cargo build --locked --bin deep-logic`) and/or
`deep-show` (`cargo build --locked --bin deep-show`, the default `full` set), honoring `CARGO_TARGET_DIR`, copied into a
temporary folder; and this suite's assembler `wat/` (crate `acceptance-544-wat`, #532's copied: `wat =1.263.0`,
`wasmparser =0.263.0`, outside the workspace) into `target/acceptance-544-wat/`. Its `Cargo.lock` carries this base's
`[patch.unused]` entries from `.cargo/config.toml` (#532's lock, copied as it is, fails `--locked` here). Criterion 2's
Linux test builds `deep-logic` in `docker run --platform linux/amd64` with `rust:<rust-toolchain.toml's
channel>-slim-bookworm`, the checkout mounted read-only, caches under `target/acceptance-544-linux/`; nothing is pulled.

Every test passes an explicit 90-minute timeout (the Linux build runs under emulation). Evidence stores, export
folders and binaries are temporary and deleted. Node built-ins and vitest only; no process is started but `cargo`,
`deep-logic`, `deep-show` (and the media worker it starts) and `docker`, each waited for, none stopped by name or port.
**`scripts/lanes.mjs` needs `'tests/acceptance/544/'` in its `alone` list**: the files build cargo binaries, draw on the
GPU and start Docker. This README is the instruction; the implementer makes that edit.

Gates: a missing host is `BLOCKED:` (a failed test, never a pass): no Docker or no linux/amd64 image names the `docker
pull` command; an assembler that doesn't build names cargo's error. Nothing is INCONCLUSIVE: no reading here depends on
load, a device or a reference machine.

The harness was checked against the base's real components before the base run (a probe, not committed): every
program assembles, passes sandbox@1's check and runs on the base `deep-logic` when its piece leaves `emits` out (no
trap; `overfull` writes its fifth row past its block, which no region holds); the two door references present, their
frames at 6.000 s differ (1.000 s in against 0 s in), and the one placed at 5 s draws alike at 4.5 s and 7.5 s; the
base's `media_mix`, given the ten shot rows as data (#500's form), plans ten voices at 1 … 10 s and passes this suite's
voice judgement (`voiceFailures`) and its seek-back hash; and the base's video export of a film with one strip gives 660
per-frame PCM hashes, every one equal to this suite's hash of `media_mix`'s straight samples over that frame.

## The surface under test

The issue names the logic item's `emits`, the emit region at `emits_at`, the list `<logic ID>.occurrences`, the trap
kind `occurrences`, the check code `occurrence.undeclared`, logic.determinism and the readers, but no command line. As
in #531's and #532's suites, the logic module is driven through `deep-logic`; as in #500's and #501's, the readers are
driven through `deep-show run`. **Every call, field and planted name below that the issue or the design doesn't give is
this job's invention**, the smallest surface the criteria need; the implementer builds exactly these, or a dispute goes
to a blind redraft. Calls and fields not named here stay as those suites' READMEs define them.

| Surface | What the tests send and read | Source |
|---|---|---|
| A logic item's `emits` | `params.emits: {kind: {fields: {name: type}, max_per_step?}}` in a `deep-logic` piece and in a document's logic item | the issue's field |
| `emits_at` | the program's immutable i32 global export; the emit region laid out as the design gives it (Programs, below) | the issue and the design |
| `deep-logic` `bake`: **`occurrences`** | the reply gains `occurrences: {<logic ID>: [Row]}`, each item's occurrence list after the bake, in list order (an item with no `emits` may be left out or null) | invention |
| **Row** | `{"step": k, "t": flicks, "kind": name, "a": u32, "b": u32, "fields": {name: value}}`: `t` is k × the step length; a field reads as a number (i32, f64), a bool, or an array (vec2, vec3) | invention (the design's columns, as JSON) |
| `deep-logic` `bake` `seeks` (#532's): **`occurrences`** | each SeekResult gains `occurrences: {<logic ID>: [Row]}`: the list as the seek leaves it, the bake's rows of steps before `from`, the rows of the steps the seek ran again as that run wrote them (in their place), and the bake's rows after its last step | invention |
| A trap of kind `occurrences` | #531's trap `{item, step, t, kind, …}` with `kind: "occurrences"` and **`occurrence`** (the kind's name) and **`count`** (the rows the step wrote) | trap kind: the design; field names: invention |
| logic.determinism's failure (#532's DetFailure) | `step` is the first step whose step hash, arrays **or occurrences** differ; `field` may also be **`"occurrences"`**, after `array` in #532's order | invention (extends #532's) |
| A `deep-logic` piece's controls | `controls: {fire: {kind: "press"}}`; an entry `{t, seq, control, value: 1, writer: "you", player: 1}` on `track` | #531's, the design's `press` kind |
| A document's logic item | `items.<id>: {id, kind: "logic@1", name, order, params: {program: <SHA-256 of the module in the evidence store>, step_rate: 60, reads?, emits}}`, the program listed in `assets` (`{sha256, license}`) as #501's film lists a strip's asset | the design's fields; the item's form: the canvas's |
| A film document's **`spawns`** | `spawns: {ID: Spawn}` in the envelope, each a Spawn as #500's `media_mix` reads it: `{on: {list, kinds}, play: {src: {asset}, in, out}, gain?}` | #500's Spawn; the envelope key: extension |
| `<logic ID>.occurrences` | a Spawn's `on.list` and a placement's `start_on.on.list`, filtered by `kinds` (`{on: {list, kinds}, policy}`, as the base parses start_on) | the design |
| A Spawn's `gain` expression | text over its occurrence's declared fields by name, in dB: `"power - 1"` | the design (Spawn: gain, pitch, pan expressions; "Spawn's expressions read its declared fields"); the syntax: choice |
| `media_mix` and `export`: **`track`** | the input track the document's logic items read: `track: [Entry]`, stamped entries as `deep-logic`'s | invention |
| `occurrence.undeclared` | the `deep show` reply is `refused` with an error issue of that code whose `ids` hold the reader's ID or whose `path` names it, whose other fields name the name it read, and whose `close` (≤ 3; `{name}` objects as the canvas gives them for an unknown kind, or strings) holds the declared name | the code: the issue; `close`: the core's |
| `deep-logic --planted <name>` | the three names below | invention |
| `deep-show run`'s scenario **`planted`** | the three names below (#500's form for a module's wrong program) | invention |

Existing calls driven unchanged: `deep-logic` `check`, `bake` (with `track`, `steps`, `seeks`) and `determinism` (with
`at_times`, `compare: "same_machine"`); `deep-show run`'s scenario, `deep show` from your shell (#501's `present`),
`eval` with `pixels: true` (`snapshots[0].sha256`), `determinism` with `display_hz: 60` and `at_times` (each side's
`pixels`), `media_mix` (`segments` with `write: true`; `mix.segments[].sha256`, `wav`, `mix.voices`), and `export`
with an `out` (`receipt.frame_rate`, `duration`, `pcm_hashes`).

### Planted twins

Each is one criterion's wrong program, reachable only through its argument, and changes nothing else.

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `seek_repeats_occurrences` | `deep-logic --planted` | 1 | a seek or a restore (a bake's `seeks`, logic.determinism's seek runs) keeps the occurrence list as the run it restores from left it and appends the rows of each step it runs again, instead of replacing that step's rows, so each such step holds its rows twice; the straight run is unchanged |
| `occurrences_keep_cap` | `deep-logic --planted` | 2 | a count over `max_per_step` doesn't trap: the module copies the first `max_per_step` rows and drops the rest, and the item steps on |
| `occurrences_sort_ties_by_payload` | `deep-logic --planted` | 2 | the list sorts rows with the same (step, kind, a, b) by their first field's value, ascending, instead of keeping the order the program wrote them |
| `start_on_at_first_frame` | scenario `planted` | 3 | a placement's `start_on` on a logic item's occurrences starts each run at the time of the first frame its session evaluates at or after the occurrence's time, not at the occurrence's time; a play through every frame is unchanged, a seek past the occurrence starts the run at the seek |
| `undeclared_kind_accepted` | scenario `planted` | 4 | the check passes a reader of a logic item's occurrences whose filter names a kind the item doesn't declare; the reader's filter then matches nothing |
| `undeclared_field_reads_zero` | scenario `planted` | 5 | the check passes a Spawn expression that reads a field its occurrence's kind doesn't declare, and the field reads as 0 |

## Programs

`programs.ts` holds the logic programs as WebAssembly text; each comment says what it does and the item it's built
for. All export `memory` (one page, maximum equal to minimum), `init`, `step`, `reads_at` (0), `writes_at` (4096) and
`emits_at` (8192) (`ticker`, which emits nothing, has no `emits_at`). The emit region is the design's, read literally:
for each kind in declaration order a u32 count, then `max_per_step` rows of `{a: u32, b: u32, fields in declaration
order}`, little-endian, each field at its type's size, with nothing between (each item here declares one kind, so its
count is at 8192 and row i at 8196 + i × (8 + its fields' bytes)). The read region is filled in declaration order, so
an item's first control's slot starts at 0 (a u32 count of the step's entries).

- `shot` (the lab): one shot row per Fire entry: a the press's number from 1, b 0, power the press's number.
- `overfull`: 3 shot rows at step 30, 4 at step 60, 5 at step 90 (max_per_step 4), row i of step k (a k, b i, power
  k); k into `last` every step, after its rows. `ticker`: k into `n` every step.
- `ties`: at step 30 (a 9, b 9, 9.0); at step 75 (a 7, b 1, 3.0), (a 2, b 9, 2.0), (a 2, b 9, 1.0), in that order.
- `latch` (the door): one door_open row (a 1, b 0, no fields) at step 300.

## Fixtures

`fixtures.ts` builds each criterion's fixture twice where it needs it: as a `deep-logic` piece (the logic item alone)
and as a `deep-show` film document (#501's envelope: a 2D camera, a ground rect, its items), presented from your shell.

- **The shot lab**: 64 × 36, 11 s at 60 fps and 48 kHz; the logic item `lab` (`shot`, reads `fire`, emits
  `shot {power: f64}`); the press control `fire` (`{kind: "press", class: "document", label: "Fire", role: "button"}`);
  the spawn `shots` on `lab.occurrences` filtered to shot, playing a 0.25 s mono 1 kHz cosine at 0.5 (12,000 samples,
  audible from its first sample; a 16-bit WAV written to the evidence store). The track: Fire pressed at steps 60,
  120 … 600, stamped at 1.000 … 10.000 s. Baked over 660 steps.
- **The door**: 160 × 90, 8 s at 60 fps; the logic item `latch` (`latch`, emits `door_open {}`); the panel, a rect at
  rest at x = 140; the 2 s clip `door` whose channel sets the panel's x to 50 × its own time; the placement `swing` of
  `door` on the panel with `start_on: {on: {list: "latch.occurrences", kinds: [door_open]}, policy: restart}`. Its
  references, with no logic: the same clip placed with `start: "5s"` (1.000 s in at 6 s) and `start: "6s"` (0 s in).

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with `AC<n> #544.<id>`. Hosts: this Mac for every test; criterion 2's fourth
test also needs Docker with the linux/amd64 image.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#544.090a698b` | `ac1-shot-lab.test.ts` (4) | The lab baked with the ten presses holds exactly 10 rows, (step 60n, t n s, shot, a n, b 0, power n) for n = 1 … 10, and the same 10 after a seek to step 330 (5.5 s); logic.determinism at 5.5 s passes with no failure. `media_mix` of the lab document: 10 voices of `shots`, occurrence n − 1, pair [n, 0], starting at n s, none stolen; over [0, 11 s) every sample before each voice is silent and its 12,000 samples from sample 48,000 n are the template's (one gain a channel, relative residual ≤ 1e-4, gain > 0.1); seeked back to 5.5 s in the same play and seeked cold to 5.5 s, [5.5 s, 11 s) hashes as the straight play's, with the same voices. The presented lab's h264 export at 60 fps with pcm audio: 11 s, 660 per-frame PCM hashes, each the straight play's samples over that frame. `seek_repeats_occurrences`: logic.determinism at 5.5 s FAIL, with a failing seek run, each naming as `step` the first step it ran again that holds a row (60 from checkpoint 0, c from checkpoint c). Fails: no list, a row missing, doubled or at the wrong step or time, a voice early, late or missing, a seek or an export whose sound differs, a check that names no step or another |
| AC2 `#544.c031896f` | `ac2-trap-and-ties.test.ts` (4) | `overfull` with `ticker`, 150 steps: one trap, `{item: lab, step: 90, kind: occurrences, occurrence: shot, count: 5}`; the list is the 7 rows of steps 30 and 60, none from 90 on; `lab.last` is k to step 89 and 89 from step 90, the lab marked failed from 90; `ticker.n` is k at every step, never failed, no ticker trap. `occurrences_keep_cap`: no trap, and the check fails naming step 90. `ties` on this Mac, after a seek to step 80 (from checkpoint 60, so step 75 runs again) and on Linux x86_64 (played and after the same seek): the list reads (30, 9, 9, 9.0), (75, 2, 9, 2.0), (75, 2, 9, 1.0), (75, 7, 1, 3.0). `occurrences_sort_ties_by_payload`: fails naming step 75. Fails: a dropped row, a trap that names no kind or count, a list or array that keeps the trapping step's, a piece that stops, ties sorted by payload or reordered on another host or a seek |
| AC3 `#544.35794d75` | `ac3-door-start.test.ts` (3) | The latch's bake holds one row, door_open at step 300, 5.000 s. At 6.000 s the door's frame, played straight (`determinism`'s play side, every 60 Hz frame from 0) and after a seek (`eval` at 6 s as the presented door's first frame, and `determinism`'s seek side), is the reference placed at 5 s (1.000 s in), which differs from the one placed at 6 s (0 s in). `start_on_at_first_frame`: the check fails naming 6.000 s, and the door's frame after the seek is the 0 s in reference. Fails: a run started late or early, at the frame that reads the occurrence, or not at all |
| AC4 `#544.3039445f` | `ac4-door-undeclared.test.ts` (2) | The door with kinds [door_opne] is refused with `occurrence.undeclared` naming `swing`, door_opne and, among ≤ 3 close names, door_open; spelled right it is presented. `undeclared_kind_accepted`: the check fails naming `swing`, and the misspelled door's frame at 6.000 s is its frame at 4.5 s (its clip never starts). Fails: a check that passes the typo, names no reader or no close name |
| AC5 `#544.e6e1fd57` | `ac5-spawn-undeclared.test.ts` (2) | The lab whose spawn's gain is `powr - 1` is refused with `occurrence.undeclared` naming `shots`, powr and, among ≤ 3 close names, power; with `power - 1` it is presented. `undeclared_field_reads_zero`: the check fails naming `shots`. Fails: a check that passes the typo, reads it as 0, or refuses every expression |

Test count: 4 + 4 + 3 + 2 + 2 = 15.

## Readings where the issue leaves a choice

- **The surface.** The logic module through `deep-logic`, because criterion 2 needs a Linux x86_64 host and planted
  twins of the module, and #532 left logic.determinism there. The readers through `deep-show run`, the one binary at
  the base that holds the media mixer, the export, the motion module, the document check and `deep-logic`'s crate; a
  reader reads the logic item's list of the same document, so the document carries the logic item and its readers.
- **The emit region.** Read literally (Programs): a u32 count, then the rows, no padding. Its fields here are one f64
  or none, so bool's size isn't read.
- **"Fed presses stamped at 1.000 … 10.000 s".** Entries on the input track whose `t` is already the stamp, given as
  `track` (as #532's tests give `deep-logic`'s), so no tour and no input lead is read; an entry at a step's time is read
  by that step (the base's rule), so press n is read by step 60n.
- **"Holds exactly 10 rows … played straight, after a seek to 5.5 s".** The bake's list, and the list as a seek to
  step 330 leaves it. **"Starts 10 voices … played straight, after a seek to 5.5 s and in a video export".** `media_mix`
  played straight and seeked (back in the same play, and cold, #499's and #500's form), judged by samples and by
  `voices`; the export's sound by its per-frame PCM hashes (#501's), which must be the straight play's frame by frame,
  so it starts the same voices at the same samples. No surface shows an export's rows, so none is read there.
- **"Each at its step's time to the sample".** Voice n's first sample is sample 48,000 n (n s), with silence before.
- **"Naming the first step whose occurrences differ from the straight run's".** Each failing seek run's `step`; a seek
  restoring checkpoint c runs steps c, c + 1 … again, so the first that holds a row is the first multiple of 60 at or
  after c (60 for c = 0). Its `field` isn't pinned: a doubled row may show first in the step hash.
- **"Naming shot, the count 5 and the step".** The trap's `occurrence`, `count` and `step`. **"Keep the last good
  step's".** Arrays as step 89 left them (`overfull` writes `last` in the trapping step too, so a copied write region
  shows); no row from step 90 on. **"The rest of the piece plays on".** A second item steps on to the end.
- **The ties.** One step with three rows, two of them tied, so the sort by (step, kind, a, b) is exercised too; "read
  in that order" is the whole list's order. "On Linux" is a linux/amd64 container, as #532's suite runs it.
- **"Shows the clip 1.000 s in at t = 6.000 s".** The frame equals, by its canonical render's SHA-256, the frame of the
  same clip placed to start at 5 s; the reference placed at 6 s shows that 0 s in draws differently. **"Played
  straight"** is `determinism`'s play side at a 60 Hz display (its frames include 5.000 s); **"after a seek to 6.000
  s"** is `eval` at 6 s as the first frame of the presented door, and `determinism`'s seek side. **"Fails the frame
  comparison at 6.000 s"**: this suite's comparison fails, naming 6.000 s.
- **"Starts a run when a frame first reads the occurrence"** (the plant): the first frame of the session at or after the
  occurrence's time; a play through every 60 Hz frame reads it at 5.000 s, a seek to 6 s at 6 s.
- **"Refused at check".** `deep show`'s check: the reply is `refused`. "Before any step runs" isn't observed. **"Naming
  the placement / the Spawn"**: the issue's `ids` or `path`; for a planted check, this suite's failure names it.
- **"Spelled right it checks"** is criterion 4's; criterion 5's test checks the spelled-right lab too, since the issue
  says "Spawn's expressions read its declared fields", so a check that refused every expression would fail.
- **"The door clip never starts"** under the planted check: the misspelled door's frame at 6.000 s is its frame at 4.5 s.

## Not tested, because no criterion reaches it here

Particle bursts, mark-set rows and expressions outside a Spawn reading a logic item's list; a field named `point` as a
Spawn's point; `last(list).field`; the limits (64 kinds, 8 fields, `max_per_step` ≤ 1,024) and the default 16 as a cap;
a rollback dropping replaced steps' rows (Net); offsets in a step; a turn clock's emits; the rows in the bake key, a
golden or the web runner; `occurrence.undeclared` for a burst, a row or an expression. They are follow-ups for the
implementer's own tests.

`BASE-FAILURE.txt` is the run at the base.
