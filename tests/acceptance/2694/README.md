# Acceptance tests for #2694: the hub's canvas side keeps only the calls that change something

Written first, blind, from issue #2694 as it reads on November 20, 2026 (its opening paragraphs, Scope, five acceptance
criteria, Proof line and dependency; no comments), the design sections it links and base commit `7a256fd4b` (`origin/main`,
whose `crates/deep-show`, `packages/hub` and `tests/acceptance/{806,393}` are those of the brief's `3f02bf52b`), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, the memory and the
suites clauses of the fifth in files of their own because each needs its own run (one file a folder, so each folder has a
file's whole time), and the two planted sides the criteria name.

## Files, one per criterion

| File | Criterion | What it runs |
|---|---|---|
| `ac1-held.test.ts` | `#2694.de4fbd51` | one side: a deep_show, 14,400 `cells` reads, a second deep_show; `held` after the second is 2; its reply equals the merge base's for the same calls, its presented revision the one the two shows alone present |
| `ac2-instructions.test.ts` | `#2694.00d72883` | one side: a deep_show, then reads; the instructions of the 100th, 1,000th and 10,000th read each within 5% of the 10th's |
| `ac3-clock.test.ts` | `#2694.5ca7dce2` | one side: `terminal_open` with a feed whose row arrives at 2 s, then 35 `cells` reads; the row shows from the 23rd read (the first at 2 s) and in none before |
| `ac4-between-writes.test.ts` | `#2694.685bdd90` | one side: a deep_show, a `revisions` read, a second deep_show; the read holds the first show's revision, current, and not the second's |
| `ac5-memory.test.ts` | `#2694.b3f057c6` | one side: a deep_show, 14,400 `cells` reads; resident memory (the physical footprint) at most 4 MB over its value after the show |
| `ac5-393.test.ts` | `#2694.b3f057c6` | `tests/acceptance/393/` as the lanes run it, every test passing |
| `ac5-806.test.ts` | `#2694.b3f057c6` | `tests/acceptance/806/` as the lanes run it, every test passing |
| `helpers.ts` | | the side's driver, the world and calls, the merge base's replies, the readers, `must` |
| `suites.ts` | | the two folders' builds and run, for the two files above |
| `twins.json`, `twins/` | criteria 3 and 4 | the two planted sides (below) |
| `BASE-FAILURE.txt` | | each file run at the base |

## What was read

- The issue (`gh issue view 2694`), and the audit it cites, `reports/hillclimb-audit-2026-11-09/10-app-show.md`,
  finding 3, for what the side does today.
- `docs/canvas-primitives.md`: Render-back. `docs/technical-design.md`: Numbers version 0 has to hold (instructions
  retired, a count that can't be read is missing, never 0); How we know version 0 works: Criteria to tests, Criteria in
  a checked shape, Wrong programs, Dogfooding. AGENTS.md.
- At the base, for surfaces only: `crates/deep-show/src/main.rs` (`CanvasSide`, `CANVAS_CLOCK`, `CANVAS_SPACING`,
  `start_args`, `planted_named`), `answer.rs` (`run`), `terminal.rs` (`terminal_open`, `cells`), `shared/calls.rs`
  (`run_calls`), `hub.rs` (`presented_revision`, `stamp`); `packages/hub/src/canvas.ts` (`Canvas`, `shape`) and
  `hub-canvas.ts` (`show`, `canvasUser`, the calls it sends); `crates/deep-app/src/views.rs` (`TERMINAL_TICK`,
  `read_terminal`); `benchmarks/process-reader.{c,mjs}`; `scripts/proof-change.mjs` (criterion IDs),
  `scripts/proof-runs.mjs` (twins, `atAssertion`), `scripts/proof-binaries.mjs` (`DEEP_BIN_DIR`), `scripts/lanes.mjs`
  (`alone`, `byHand`); the suites `393/`, `806/`, `411/` (how a test drives `deep-show canvas`), `2648/` (the reader),
  `2204/`, `2243/`, `2371/` (twins and their READMEs).

## The surface under test

The side, `deep-show canvas`: the hub's long-lived canvas core (#806). It reads one JSON line at a time on stdin,
`{"world": {...}}` or `{"call": {...}}`, and answers each with one line, as `packages/hub/src/canvas.ts` sends them. The
tests send what the hub sends: the world `shape` builds (one session, one document on the panel `main`, an empty record,
an evidence folder of the test's own), deep_show as `hub-canvas.ts` sends it (`{"call": "deep_show", "session", "doc",
"document", "include": ["issues"]}`), the app's Terminal tab's read through `canvas.user` (`{"call": "cells", "session",
"tab": "terminal"}`, every 250 ms in the app), the hub's `revisions` read, and `terminal_open` with a recorded `feed`.
No hub runs: the side is the issue's subject, and a hub in between adds nothing the criteria read.

### Invented here: `held`

The issue names no wire for "the side holds N calls". This suite asks for the smallest one: **every answer line to a
`{"call": ...}` line carries `held`, a whole number: how many calls the side holds after answering that one** (the calls
it keeps to play again, or otherwise holds for the state it answers from). Beside `ok`, `reply` and `presented`, e.g.
`{"ok": true, "reply": {...}, "presented": null, "held": 1}`. The hub ignores fields it doesn't read. The merge base
has no `held`, so criterion 1's test fails there at the first answer, naming the missing count; the merge base's own
count can't be read, so the test can't name the 14,402 the criterion says it holds there (BASE-FAILURE.txt).

Nothing else is invented. The twins are files, not names the program has to know.

### The merge base's replies for the same calls

Criterion 1 compares the second show's reply with the merge base's "for the same calls". The merge base's side answers
a call by building one scenario from the world, the clock and every call it holds, the n-th at n spacings
(`scenario_of_world`), and playing it through a new hub (`run_calls`), keeping the last reply. That is exactly what
`deep-show run` does with the same scenario (`answer.rs`; no background jobs here), once, and this issue doesn't change
`run`. So `helpers.ts` `baseReplies` builds that scenario (`baseScenario`: `at`, or `arrives` for `deep_query`,
`geometry`, `fn` and `deep_kinds`, at `(i + 1) × CANVAS_SPACING`) and runs it, and the test compares with its last
reply. At the base this job checked that the side's own reply to the second show equals `run`'s for the same calls
(BASE-FAILURE.txt, Readings).

The presented revision isn't in `run`'s answer: the side adds it from the hub it played. It names the document's
revision, hash, writer, layer, items, panel, rect and layers with their pictures, and no time, so the merge base's for
the same calls is the one a fresh side presents for the two shows alone, which the test reads. At the base this job
checked that the two are equal (Readings).

### The clock

"Replies are the ones given today for the same calls in the same order" keeps the side's clock where the merge base
has it: 120 Hz, the latch 2 ms before vsync, half a millisecond a check (`CANVAS_CLOCK`), and each call ten frames
(1/12 s, 58,800,000 flicks) after the one before, the first at ten frames (`CANVAS_SPACING`). With the issue's "the
clock still moves with every call, a read included", criterion 3's terminal opened by the first call shows a row that
arrives at 2 s from the 23rd read (the 24th call, at 2 s) on. `helpers.ts` holds those numbers as the base's.

### Instructions

Criterion 2's counts are the side's own instructions retired, read from the kernel around one read with the benchmarks'
reader (`benchmarks/process-reader.mjs`, #2698): the side waits on its next line before and after, so the span holds that
read and nothing else. A host that can't read the counter is INCONCLUSIVE, never 0. One read's count moves a little
with the schedule, so "the 10th" is the median of the 10th to the 18th read, and likewise for each read named. The 100th
and the 1,000th are judged on the way to the 10,000th by the same 5%, both ways: a side whose reads cost what came
before them fails where that first shows, in seconds at the base rather than the better part of an hour. A side whose
reads cost the same every time passes all three, which is what "within 5% of the 10th" at the 10,000th asks.

### Memory

"Resident memory" is read as the side's physical footprint, what macOS counts as a process's memory (Activity
Monitor's Memory column, the design's footprint row), from the kernel by the benchmarks' reader
(`benchmarks/process-reader.mjs`, `footprintBytes`), once the first show is answered and after reads. Not the resident
set (`ps -o rss=`): at the base it was 121.9 MB right after the show and 71.4 MB 500 reads later, as the kernel took back
pages the show had freed, so a resident set against its value after the show can't see a side grow; the footprint over
the same span went from 56.4 MB to 56.8 MB (BASE-FAILURE.txt, Readings). "Within 4 MB of its value after the first show"
is read as at most 4 MB (4 × 1,024 × 1,024 bytes) over it: the clause guards against a side that keeps its reads, and a
fall isn't that. It is read every 1,000 reads as well as after the 14,400th, and a side already more than 4 MB over
fails there, since what a side keeps of its reads only grows.

A test whose reads haven't finished 14 minutes in (`READS_MS`) stops INCONCLUSIVE, naming how far the side got, so the
rest of its 18 minutes is left for what follows them; a side that slows with every read, as the base does, never
reaches the 14,400th in that time on a loaded machine.

### The suites clause

`ac5-393.test.ts` and `ac5-806.test.ts` (through `suites.ts`) run `tests/acceptance/393/` and `tests/acceptance/806/`
as they are, with this checkout's Vitest and the root's config, files one at a time, leaving out what
`scripts/lanes.mjs` `byHand` names (#806's `live.test.ts`, and `unbound.test.ts`, whose blind redraft
`806-redraft-ac3/` runs in its place). Each reads Vitest's JSON report: every
test of every file passes, or the test fails naming each that didn't. A failure `scripts/known-failures.json` lists by
its key (`<file> › <describe> › <test>`) is main's, set apart and printed, as `scripts/affected.mjs` sets it apart. Each
file first builds what the folders' runs need, as they build it (`cargo build --locked --bin deep-show`, `--bin
deep-hook`, without which #806's hub doesn't start, and on macOS `--bin deep-replica-canvas`), so each folder's own run
finds it fresh; each folder must then finish within its test's 18 minutes, else INCONCLUSIVE.

At the base, one test of #393's folder fails, and it is not in `scripts/known-failures.json`: `writer.test.ts`'s "AC4 a
deep_show call bound to no session is refused: it draws nothing, makes no revision and attaches no evidence" finds 8
objects in its evidence store, which `deep-show run` writes before every scenario since #2363 (the fixtures' assets,
`answer.rs`). It is main's and has nothing to do with this issue, but "pass unchanged" can't hold while it fails:
`ac5-393.test.ts` fails on it at the base and will on the change until it is fixed or listed as main's
(BASE-FAILURE.txt).

## The planted sides (twins)

Criteria 3 and 4 pass at the base (its reads move the clock, and it keeps every write), so each names a planted side,
and `twins.json` names its twin for the proof lanes (`scripts/proof-runs.mjs`): files laid over the program being
judged. Each is the base's `crates/deep-show/src/main.rs` (`7a256fd4b`) with one place changed.

| Criterion | Twin | The wrong program |
|---|---|---|
| `#2694.5ca7dce2` | `reads_hold_the_clock` | In `CanvasSide::scenario_of_world`, a call's time is the count of calls before it, itself included, that aren't reads (`cells`, `cell`, `updates`, `revisions`, `deep_query`, `deep_kinds`), times the spacing; a read plays at the time of the call before it. Reads never move the clock, so the feed's row never arrives |
| `#2694.685bdd90` | `drops_kept_write` | In `CanvasSide::line`, where `deep_kinds` is taken off after its answer, a `deep_show` is taken off too: the side drops the write it just played, so the read after it finds no revision |

At the base each twin fails its criterion's test at its assertion, naming what the criterion says (BASE-FAILURE.txt):
`reads_hold_the_clock` fails ac3 naming the row, `drops_kept_write` fails ac4 naming the revision. This job built each
by laying its file over the checkout's `main.rs` for the build only, into a copy of `target/`, and put the base's file
back after.

Laid over the change, each whole file replaces the change's `main.rs` with the base's plus the plant. That is still the
wrong program the criterion names, and it builds as long as the change's other files don't need what the change added
to `main.rs`. If the change moves the side out of `main.rs`, or the twin no longer builds beside the change's files, make
the same one-place change in the change's own side (reads don't move the clock; a played `deep_show` is dropped) and
replace the twin's file with it, at the same path or at the path the side now lives at; the tests stay as they are.

## Run them

```sh
npm ci --ignore-scripts                     # once, if node_modules is missing
npm run build --workspaces                  # once: #806's suite runs the built CLI (ac5-806.test.ts)
PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run tests/acceptance/2694/ --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2694/tsconfig.json     # type-check
```

Each file that drives the side builds `deep-show` once (`cargo build --locked --bin deep-show`, debug, as #393's suite
does, in the environment as given) unless the proof run supplies `DEEP_BIN_DIR`, and runs the side from there. Its
folders are under `/tmp/dh2694-*`; it stops only the sides it started, by PID, and removes its folders after the file.
Those files start no hub and no app and use no network; `ac5-806.test.ts` runs #806's folder, which starts its own hubs
and, on macOS, the app's replica, as its README says. The instruction counter and the footprint are read on macOS only
(elsewhere criteria 2 and 5's memory clause are INCONCLUSIVE); the rest runs where `deep-show` builds.

## Lanes

The implementer adds `tests/acceptance/2694/` to `scripts/lanes.mjs` `alone` (or lands a `lane.json` beside these
files): its files each hold a side for minutes, and `ac5-393.test.ts` and `ac5-806.test.ts` run folders that are
themselves `alone`. Its files' recorded runs pass two minutes, so they belong in the list of slow files too.

## What the base does

`BASE-FAILURE.txt` has each file's run at the base, with the readings below them.
