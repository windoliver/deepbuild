# Acceptance tests for #3441: a window's rate caps count its display's ticks

A blind job wrote these tests before any work on #3441 existed, from the issue, the design and the base commit
`fc09a09cb` (main, whose last merge is #3718). The implementing agent doesn't edit them (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #3441 as saved on November 27, 2026: its opening paragraph, its `Runs on:` line, the five Scope lines, the six
  criteria, the Proof line and the owner's two comments, which read two upstream rules and change no criterion. The
  counts in those comments are not expected values here.
- The issues it names or that name it: #241, #140, #2686, #1426, #3502, #400, #1551, #1609.
- The design: `docs/canvas-primitives.md` (Frame clock and scheduler; Window and display placement; Frame callback and
  presentation feedback); `docs/technical-design.md` (Numbers version 0 has to hold; How we know version 0 works:
  Criteria to tests, Closed issues stay proven, Criteria in a checked shape, Wrong programs, The edit guard, Dogfooding,
  Tests written first, Repo guards; Decided: The app's toolkit); `docs/parallel-proof.md` sections 5 to 7 and 12a;
  `docs/adr/0001-code-carries-no-comments.md`; `AGENTS.md`, `GLOSSARY.md`.
- The base, for names and shapes only: `vendor/gpui-pre/src/window.rs` (the request-frame closure and its own tests of
  the cap), `vendor/gpui-pre/src/platform.rs` (`RequestFrameOptions`, `inactive_frame_interval`),
  `vendor/gpui-pre/src/app/headless_app_context/`, `vendor/gpui-pre-apple/upstream/README.md`, `.cargo/config.toml`;
  `crates/deep-show/src/placement.rs` (`slots`, `cap`, `Planted`), `input.rs` (`presented`), `main.rs` (the scenario
  and its calls), `shared.rs`; `tests/acceptance/400/` and `400/caps/` (the scenario this suite's is), `1551/`, `3440/`,
  `3544/`, `3529/` (a criterion held through `benchmarks/budgets.json`), `3467/` (`DEEP_BIN_DIR`), `1426/` and `3622/`
  (the carried-patch table as a suite reads it); `benchmarks/budgets.json`, `benchmarks/canvas.mjs`,
  `scripts/benchmark.mjs`, `scripts/budget-window.mjs`, `scripts/budget-table.mjs`, `scripts/lanes.mjs`,
  `scripts/proof-change.mjs`, `scripts/proof-runs.mjs`.

Nothing outside those was read: no other checkout, no other git ref, no forge, and neither the pull request nor the
suite of #3502's that the issue's second comment names.

## Run them

```sh
npx tsc -p tests/acceptance/3441/tsconfig.json
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3441 --no-file-parallelism counts.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3441 --no-file-parallelism model.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3441 --no-file-parallelism forced.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3441 --no-file-parallelism uncapped.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3441 --no-file-parallelism budgets.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3441 --no-file-parallelism patch.test.ts
```

| File | Needs | Takes |
|---|---|---|
| `counts.test.ts`, `model.test.ts`, `forced.test.ts`, `uncapped.test.ts` | `deep-show`: from `DEEP_BIN_DIR` when it is set, else each file runs `cargo build --locked --bin deep-show` once (with `CARGO_INCREMENTAL` and `CARGO_PROFILE_DEV_DEBUG` at 0 unless the run sets them) and reads `target/debug/deep-show`, or `$CARGO_TARGET_DIR/debug/deep-show` | once the binary is built: 74, 14, 22 and 13 runs of `deep-show run`, each one scenario of at most 1,202 calls. A scenario of ticks alone is 600 calls. A scenario with 599 patches took 6.7 to 17.2 s on the base's debug build at a load of 19 to 25 (six of them, with the ticks left out), and `model.test.ts` runs ten, so that file takes two to three minutes there |
| `budgets.test.ts` | git, `origin/main`, and for a pass a budget window's record under `benchmarks/windows/` | under a second |
| `patch.test.ts` | nothing | under a second |

A run with `--root` may leave Vitest's cache in `tests/acceptance/3441/node_modules/`; delete it. The suite needs no
`lane.json`: it reads its binary from `DEEP_BIN_DIR` in the lanes, every play is on the virtual display clock, nothing
is timed and nothing is shared. Nothing of it goes in `scripts/lanes-lists.mjs`.

Every scenario writes into its own temporary evidence folder and removes it; the only processes started are `cargo`,
`deep-show run` and `git`, each waited for and bounded by a deadline (`BUILD_DEADLINE_MS`, `RUN_DEADLINE_MS`,
`TEST_DEADLINE_MS`), and no test waits for time.

Nothing missing passes. A binary that isn't there is `BLOCKED`. A scenario answered `bad_input`, a reply without a
boolean `presented`, a refused report or a patch that isn't applied fails the test, naming it. The merge base's
budgets that can't be read are `BLOCKED`; the two tasks with no window's record are `INCONCLUSIVE`. Each of those is a
failure whose message starts with the word, as `scripts/lanes.mjs` reads a state. No test skips.

## The surface under test

Names marked **new** are this suite's, and the implementation provides each exactly as written. Everything else is the
base's and is read as it stands.

### The scenario: `deep-show run`, as #400's suites drive it

One JSON line in, one out: `{"ok": true, "replies": [Reply]}`, a reply for each call in `at` order, or
`{"ok": false, "code": "bad_input"}`. Every time is in flicks, 705,600,000 a second. Each scenario here has one
display, the main window on it and one panel:

```json
{"evidence": "<tmp>", "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "agent alpha", "process": {"pid": 4100, "start": 1000}}},
 "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 3001, "ppid": 1, "start": 110}, {"pid": 4100, "ppid": 3001, "start": 1000}],
 "clock": {"lead": 1411200, "check": 352800},
 "displays": [{"uuid": "3441D060-0000-4000-8000-000000000060", "bounds": [0, 0, 1920, 1080], "scale": 1, "refresh_hz": 60, "next_vsync": 2822400, "color_space": "srgb"}],
 "window": [1200, 700], "panels": {"x": {"rect": [0, 0, 600, 350]}}, "docs": {"01JB3441D00000000000000001": {"panel": "x", "document": Board}},
 "planted": "window_cap_time_threshold", "calls": [Call]}
```

The display is at 60 Hz or at 120 Hz (`3441D120-…`, 1512 × 982 at scale 2, `p3`), its first vsync at 4 ms and its latch
2 ms before each vsync. The base's calls the suite makes, unchanged: `windows` (for the main window's ID), `thermal`
with `serious`, `activate` with a window's ID or `null`, `deep_show` with a patch, and `presented`.

A window is **under the thermal cap** after `{"call": "thermal", "at": 2, "state": "serious"}`, and is **a window that
isn't active** after `{"call": "activate", "at": 1, "window": ID}` then `{"call": "activate", "at": 2, "window": null}`,
as #400's caps suite has them. Both come before the window's first tick, so a cap holds for a whole play. With neither,
the window is under no cap.

### **new**: the `tick` call

```json
{"call": "tick", "at": 1411200, "window": "<the main window's ID>"}                              → {"presented": true}
{"call": "tick", "at": 7291200, "window": "<the main window's ID>", "force_render": true}         → {"presented": true}
{"call": "tick", "at": 13171200, "window": "<the main window's ID>", "require_presentation": true} → {"presented": true}
```

- **What it is.** The display's tick for that window at `at`: one frame request delivered to the window's request-frame
  callback, as the platform delivers one each refresh. The decision is made by the rule that callback runs, the carried
  GPUI patch in `vendor/gpui-pre/src/window.rs` and what it calls. A second copy of the rule kept in `deep-show` does
  not meet this, and no test here can tell: `patch.test.ts` holds the row, and the row's own test and the mutation
  lane hold the rest.
- **The demand for a frame.** At every tick the window wants a frame: a next-frame callback is pending and leaves it
  with something to draw, as a running animation does. So every tick is one a cap may hold, and a tick the rule lets
  through draws and presents.
- **`force_render`, `require_presentation`.** GPUI's `RequestFrameOptions` fields of those names; absent is false.
- **The cap that applies** is what the scenario's reports say as of `at`, read as the model reads them: the inactive
  cap, 30 Hz, for a window you switched away from; otherwise the thermal cap, 60 Hz, while the state is `serious` or
  `critical`; otherwise none. The pacing display is the window's, d its `refresh_hz`. Under a cap of r Hz the window
  presents on every ⌈d ÷ r⌉th tick, counted in ticks.
- **Time.** The time between two ticks is the difference of their `at`. The shipped rule holds no such time against a
  threshold; the planted `window_cap_time_threshold` does.
- **Reply.** `{"presented": true | false}`: whether the window presented a frame on this tick. Nothing else is read.
  A reply with a `code`, as for an unknown window, is a refusal, and the suite fails on one.

### **new**: three planted programs

Each is reached only through the scenario's `planted`, one name a scenario, and an unknown name answers `bad_input` as
at the base. A microsecond is 705.6 flicks, so "f flicks are under m µs" is 10 f < 7,056 m in whole numbers; nothing is
rounded.

| `planted` | The wrong program | Its test |
|---|---|---|
| `window_cap_time_threshold` | The merge base's rule, in the window. A tick that doesn't require presentation is skipped when the time from the last tick that wasn't skipped is under 16,667 µs under the thermal cap, or under 33,333 µs for a window that isn't active. A forced render on a skipped tick is kept for the next tick that isn't. Under no cap nothing is skipped | AC1, AC2, AC3; AC6 plays it under no cap, where it presents on every tick |
| `model_cap_time_threshold` | The model (`slots` in `placement.rs`) opens a vsync under a cap only when the time from the last vsync it opened is at least 16,667 µs under the thermal cap, or 33,333 µs for a window that isn't active, where the model holds one cap period on the display's grid. The window's rule is the shipped one | AC4 |
| `window_cap_defers_forced` | The shipped window's rule, except that a tick with `force_render` or `require_presentation` is held to the cap as any other tick: where the cap skips, the frame isn't presented and is kept for the next tick the cap lets through | AC5 |

### `benchmarks/budgets.json`, the two tasks' `criteria`

`budgets.test.ts` reads `tasks[].id`, each task's `criteria` and the rest of its fields. The implementer adds this
criterion to both tasks and changes nothing else of them:

```json
{"id": "terminal-60hz", "…": "…", "criteria": ["#3441.e80d0654"]}
{"id": "canvas-idle", "…": "…", "criteria": ["#854.022ea575", "#3441.e80d0654"]}
```

### A budget window's record of a commit

The base's own, as `scripts/budget-window.mjs` writes it and `node scripts/budget-table.mjs collect` copies it into the
repository: `benchmarks/windows/<window's start>/<commit>.json`. `window.json` beside it is the window's own and isn't
read. The fields read:

```json
{"lane": "budget-window 0123abc…", "commit": "0123abc…", "base": "4567def…", "notReached": [],
 "tests": [{"id": "terminal-60hz", "state": "PASS", "sides": {"change": {"p50Ms": 900}, "base": {"p50Ms": 880}}},
           {"id": "canvas-idle", "state": "PASS", "sides": {"change": {"p50Ms": 400000}, "base": {"p50Ms": 400000}}}]}
```

A record is this change's when `benchmarks/budgets.json` at its `commit` names `#3441.e80d0654` in both tasks and at
its `base` doesn't, read with `git show`. No environment variable names a record.

### The carried-patch table

`vendor/gpui-pre-apple/upstream/README.md`, the table under `## Carried patches`, read by its header's names as
#1426's judges read it: the cells of `Issue`, `Files` (paths in backticks), `Test` (`` `path › name` `` in backticks)
and `Removal`. The mark read in a listed file is `DeepBuild patch (windoliver/deepbuild#3441)`. A well-formed row:

```
| A window's caps are whole numbers of its display's ticks | #3441 | `vendor/gpui-pre/src/window.rs`, `vendor/gpui-fast/src/window.rs` | `<path> › <name>` | — | <the upstream change that would retire it, or none: reason> |
```

### Environment variables

Only the base's, each carrying a path or cargo's own setting: `DEEP_BIN_DIR`, `CARGO_TARGET_DIR`, `CARGO_INCREMENTAL`,
`CARGO_PROFILE_DEV_DEBUG`. No variable picks a wrong program.

## The tick lists, the generator and the seeds

A play is 600 ticks, one for each of the display's first 600 vsyncs, delivered at its latch:

```
tick k at  2,822,400 + k × (705,600,000 ÷ hz) − 1,411,200 + offset k     flicks, k = 0 … 599
```

Exactly spaced, every offset is 0 and the ticks are 11,760,000 flicks apart at 60 Hz and 5,880,000 at 120 Hz, which
are 1/60 s and 1/120 s with nothing rounded. The unit is the flick because it holds both, and holds 200 µs (141,120
flicks) and each offset whole. The two thresholds are no whole number of flicks (11,760,235.2 and 23,519,764.8), so the
planted programs compare in whole numbers as above, and no tick difference here comes nearer a threshold than a third
of a microsecond.

Jittered, tick k is moved by seed s's kth offset, a whole number of 25 µs steps from −200 µs to +200 µs:

```
state = s, as an unsigned 32-bit number
for each tick:  state = (state + 0x6D2B79F5) mod 2^32
                m = imul(state xor (state >>> 15), state or 1)
                m = (m + imul(m xor (m >>> 7), m or 61)) xor m
                draw = (m xor (m >>> 14)), as an unsigned 32-bit number
                offset = ((draw mod 17) − 8) × 17,640 flicks
```

`imul` is the low 32 bits of a product and `>>>` an unsigned shift. Seed 1's first six offsets are −25, 75, 75, −125,
175 and 0 µs. The seeds are 1 to 8. Steps of 25 µs make the bound of 200 µs a value the lists reach: every seed holds
both −200 and +200, and across the seeds two neighbouring ticks come 400 µs closer than a refresh and 400 µs further
apart. That is the most the criterion's "up to 200 µs either way" lets a list reach, so a rule that holds time against
a threshold within 400 µs of a whole number of refreshes is caught: by a port made by hand, a thermal threshold of
16,267 µs or more presents fewer than 600 frames at 60 Hz for at least one seed, and one of 16,266 µs presents 600 for
all eight.

## Criteria to tests

Each ID is the first eight hex digits of the SHA-256 of the criterion's text, as `scripts/proof-change.mjs` computes it,
checked against the issue's body.

| Criterion | Test | Holds | What fails it |
|---|---|---|---|
| `#3441.fe33f0e7` (1) | `counts.test.ts`, AC1 | Under the thermal cap, exactly spaced: 600 frames at 60 Hz and 300 at 120 Hz | The merge base: no `tick` call, `bad_input`. Planted `window_cap_time_threshold`: 300 and 200, and the failure names both ("presented 300 frames, not 600", "presented 200 frames, not 300") |
| `#3441.84feca42` (2) | `counts.test.ts`, AC2 | The same two plays jittered, for each of the eight seeds: 600 and 300, and no two neighbouring presented frames more than one cap period plus one refresh apart (33.33 ms at 60 Hz, 25 ms at 120 Hz) | The merge base as above. The planted rule at each rate: its counts differ between two seeds, named with their counts, and its longest gap is past the bound |
| `#3441.5ba15fef` (3) | `counts.test.ts`, AC3 | For a window that isn't active, exactly spaced and jittered for each seed: 300 frames at 60 Hz and 150 at 120 Hz, within the gap bound (50 ms and 41.67 ms) | The merge base as above. The planted rule, jittered, at each rate: fewer frames for every seed, and a failure naming its longest gap, its two ticks and the bound |
| `#3441.e809f907` (4) | `model.test.ts`, AC4 | At 60 and at 120 Hz, under each cap, with the ticks exactly at their latches and with seed 1's offsets: the vsyncs of the `presented` reply's frames are every ⌈d ÷ r⌉th vsync, and they equal the vsyncs of the ticks whose reply is `presented: true` | The merge base as above. Planted `model_cap_time_threshold` under the thermal cap at each rate: the lists differ first at entry 1, where the window presents tick ⌈d ÷ r⌉, and the failure names the entry, the vsync and the tick |
| `#3441.68159139` (5) | `forced.test.ts`, AC5 | Under the thermal cap at 120 Hz and the inactive cap at 60 and at 120 Hz: on a tick the cap skips in the same play without flags, a tick with `force_render` presents, and in a play of its own a tick with `require_presentation` presents | The merge base as above. Planted `window_cap_defers_forced`: neither presents, and each failure names the frame, its tick and the next tick that presented |
| `#3441.e80d0654` (6), the ticks | `uncapped.test.ts`, AC6 | Under no cap, at 60 and at 120 Hz, exactly spaced and with seed 1's offsets: every one of 600 ticks presents, and the same holds with the merge base's rule planted | The merge base as above. What shows the check can fail: in the same test it fails the play under the thermal cap at 120 Hz, naming how many ticks presented nothing; and a mutant that skips an uncapped tick fails it |
| `#3441.e80d0654` (6), the two tasks | `budgets.test.ts`, two tests | That `terminal-60hz` and `canvas-idle` each name the criterion and keep the merge base's definition; and that a budget window's record of this change reads both `PASS` beside their merge base's numbers | The merge base: neither task names the criterion. With no record: `INCONCLUSIVE`, naming both tasks. A record with either task `FAIL`: a failure with its note |
| Scope, line 2 | `patch.test.ts` | The carried-patch table has a row of `#3441` that lists `vendor/gpui-pre/src/window.rs`; every file it lists is there and holds the mark; it names a test and a removal condition | The merge base: no row |

## Readings where the issue and design leave a choice

- **"The kit case that plays the caps on the virtual display clock"** is read as the play of a window's caps through
  `deep-show run`, which #400's caps suite drives at the base: `thermal` and `activate` reports and the `presented`
  frames that `slots` leaves. No case of the canvas conformance kit (`crates/deep-show/src/kit/`) plays a cap at the
  base. `model.test.ts` is that case with the window's rule beside the model. Whether the kit's own `kit` call gains a
  case isn't read.
- **Playing a list through the window's rule.** The base's rule reads the wall clock inside a closure, so the least a
  test needs is one call that delivers one tick with its time and its two flags and says whether it presented. The
  cap comes from the reports the model already reads, so one scenario feeds both rules. A tick's demand for a frame is
  not a field: every tick has it, since a tick with nothing to draw decides nothing.
- **A tick's time** is its vsync's latch, and a jittered tick is moved off it. The virtual display clock's vsyncs
  stay on their grid.
- **A cap holds from before the first tick.** No play starts or lifts a cap midway, so no test depends on which tick
  a cap first holds. The counts would be the same either way.
- **"The same counts for every seed"** is read as the exactly spaced runs' counts, 600 and 300, for each seed. A
  rule with one wrong count for every seed fails on its counts, and one whose counts differ fails naming two seeds.
- **"No two presented frames are further apart than one cap period plus one refresh"** is read over neighbouring
  presented frames, by their ticks' `at`, and a gap of exactly that length passes. "Naming its longest gap" in
  criterion 3 is read as the same bound under the inactive cap.
- **Where the merge base's rule is planted.** In the window, behind the scenario's `planted`, as #400's and #1551's
  wrong programs are, so that it answers the same `tick` calls as the shipped rule. A copy in the test would show only
  that the judges can fail.
- **What the model's opened vsyncs are read from.** The `presented` reply's frames, with a patch made current 0.5 ms
  before the latch of every vsync but the first, whose latch sees the seeded document, so that the model presents at
  every vsync its cap allows, as #400's caps suite arranges. The test first holds that list to every ⌈d ÷ r⌉th vsync,
  which the base's model already gives, so two short or empty lists can't pass as equal.
- **"The same list"** compares vsync times: tick k stands for vsync k, exactly spaced or jittered. The jittered play
  is the Scope's fourth line, "exact and jittered".
- **"The first capped tick"** is read as the first tick the rule presents after the play's first frame, tick ⌈d ÷ r⌉:
  tick 1 at 60 Hz and tick 2 at 120 Hz under the thermal cap. The first tick of a play has no frame before it, so no
  cap can hold it. The planted model is run under the thermal cap only: on the display's exact grid its 33,333 µs sits
  under two 60 Hz ticks, so under the inactive cap it opens the model's own vsyncs.
- **Criterion 5 against the base.** At the base a tick that requires presentation is never held, and a tick that
  forces a render is held to the cap and its render kept for the next tick that passes. The Scope says both pass a cap
  "as they do today"; the criterion says both present on their own tick, and the test holds the criterion. Each flag is
  played alone, in a play of its own, on a tick the unflagged play skips.
- **"A planted cap that defers one"** is one program that holds both kinds of frame to the cap, so that each half of
  the check is shown to fail.
- **Criterion 6, the ticks.** "As before" is read as: the merge base's rule, planted, presents on the same ticks under
  no cap.
- **Criterion 6, the two tasks.** Their budgets are judged by the budget window (`scripts/budget-window.mjs`, with
  `judgeTask` and `judgeTargets` of `scripts/benchmark.mjs`): the commit and its merge base, 20 samples a side, the
  merge base's margin, on a reference Mac. This suite takes no sample and builds no judge. It holds that the window
  will judge both for this criterion, and it reads the window's verdict from its record. Outside a window, and until a
  record of this change is under `benchmarks/windows/`, the second test reads `INCONCLUSIVE`. The earlier suites that
  hold such a criterion (#3440, #3544, #3529) stop at the first test; this one doesn't, since a task that names a
  criterion has not yet been judged.
- **The row.** The second Scope line is reached by no criterion. `patch.test.ts` holds it all the same, untagged,
  because every criterion plays "the cap's rule" and nothing else in the suite ties that rule to the window's own file.

## Not asserted, since no criterion says so

- Which ticks present under a cap in criteria 1 to 3, beyond their count and their gaps. Criterion 4 holds the list.
- The cadence after a forced render or a frame that requires presentation.
- A run longer than 600 ticks. The issue's first comment says a run of 6,000 would tell counting from a pacer with a
  tolerance; the criteria state 600, so a rule that holds time against a threshold more than 400 µs under a whole
  number of refreshes, or one that drifts by less than its tolerance over 600 ticks, passes this suite.
- The planted rule's counts on the jittered lists, and its exactly spaced plays under the inactive cap, which present
  300 and 150 as the shipped rule's do.
- The hidden cap, the state `fair`, input arriving at a high rate, a cap that starts or lifts during a play, and a
  window on two displays.
- The Scope's last line: the caps' values, whether a hot Mac should draw slower or step the degrade ladder, the display
  link, and a display that changes its rate.
- The second tree: whether the row lists a `vendor/gpui-fast` file, and what its pacer does. The table's own rule and
  `node scripts/vendor-rebase.mjs check` hold that, with the hunk marks and the size budgets.
- The two tasks' commands being run, and any time or memory of theirs.
- The Proof line's record, `docs/evidence/3441/`: a test can't reach the pull request.
- A machine where `deep-show` has no GPUI. The call must answer there too, or the plays fail.

## What the implementer adds outside this folder

1. In `deep-show run`: the `tick` call and the three `planted` names, as above.
2. In `benchmarks/budgets.json`: `"#3441.e80d0654"` in the `criteria` of `terminal-60hz` (a new list) and of
   `canvas-idle` (after `#854.022ea575`), and nothing else of either task.
3. In `vendor/gpui-pre-apple/upstream/README.md`: the row of `#3441`, as above.
4. Nothing in `scripts/lanes-lists.mjs`, and no `lane.json`.

The record that turns `budgets.test.ts`'s second test from `INCONCLUSIVE` to a verdict is the owner's to bring: a
budget window measures the merged commit on a reference Mac, and `node scripts/budget-table.mjs collect` copies its
record under `benchmarks/windows/`. Agents never run the window.

## At the base

`BASE-FAILURE.txt` holds the run at `fc09a09cb`: each file once, through `node scripts/throttle.mjs test --wait 30 --`.
All 9 tests fail there, each at an assertion of the suite's own. The six that play ticks fail where `deep-show run`
answers the scenario `bad_input`, since the base has no `tick` call; the first budgets test because neither task names
the criterion; the second reads `INCONCLUSIVE`, since no window's record exists; the Scope test because the table has
no row of `#3441`. The same file holds what the base's `deep-show` does with the suite's scenario when the ticks are
left out: every patch applies, and the model opens every ⌈d ÷ r⌉th vsync from the first under each cap, at both rates.

What was not run at the base, or anywhere: the three planted programs and the shipped rule, which don't exist yet. The
judges were run on ports of those rules made by hand, and the four files that play ticks on a stand-in for `deep-show`
that answers from the same ports; both stay outside the tree and are no part of the suite.
