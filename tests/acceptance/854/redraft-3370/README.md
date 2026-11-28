# Blind redraft for #3370: #854's idle test reads a never-shown window as INCONCLUSIVE

A blind redraft of `tests/acceptance/854/redraft-3300/idle.test.ts`, written for #3370 (its section 2, "canvas-idle
reads a window AppKit never showed as a failure, not INCONCLUSIVE") from the issue, the design and base commit
`254bdc87c` ("Merge pull request #3751 …"). It runs in that file's place: it carries every test of the file, each name
with its IDs (`#854.022ea575`, `#854.926cdce7`) unchanged and every assertion as written, and adds one test. The first
draft (`../idle.test.ts`) and #3300's redraft (`../redraft-3300/`) stay as they were, frozen.

## Why

#854's idle test was written before #1551 gave `deep-show live` its `no_display` answer. When AppKit never shows the
window (a locked screen, a sleeping display, a covered or hidden window), `node benchmarks/canvas.mjs idle` records the
run with `opened_frames: 0` and no frame drawn, and the judge reads the run's window as not shown. The test asserts
`opened_frames >= 1` first, so it fails such a reading (the issue: "run 1: the window drew the document when it opened,
before the still minute: expected 0 to be greater than or equal to 1", the judge reading `run 1: headless, ... run 5:
headless`). Invariant 2 (AGENTS.md) and the design (How we know version 0 works: a run that can't be read "counts neither
way") say such a reading is INCONCLUSIVE, never FAIL, and never PASS: the shipped test's "0 frames in every run" would
otherwise pass on runs that drew nothing because nothing was shown.

## How a run's window is read

The tests read it as the lane's judge does, by asking it: `requireShownWindow` (`helpers.ts`) hands the report to `node
benchmarks/canvas.mjs judge` (the first draft's `judged`) and reads the verdict's `window`. Traced to the writers:

- `crates/deep-show/src/watch.rs`: on no first frame within `SHOW_DEADLINE` (10 s) the answer is `no_display` with
  `reply["window"] = json!({"state": shown, "shown_ms": 0})`, `shown` from `idle::window_state` (`hidden`,
  `display_asleep`, `covered` or `shown`, `crates/deep-show/src/idle.rs`), plus `process` and `request_frames`. On a
  shown window, `live["window"] = track.json()`: `state` is the first state other than `shown` the window took, else
  `shown`, and `shown_ms`.
- `benchmarks/canvas.mjs` `workloads.idle`: a `no_display` answer with `window` and `process` becomes the run
  `{ opened_frames: 0, frames: 0, drawn: [], ...spent(answer.process), request_frames, window: answer.window }`; a shown
  run is `{ opened_frames: 1, frames, drawn, ...spent(p), request_frames, window }` with `window` from `answer.live`.
- `benchmarks/canvas-judge.mjs` `shownWindow(runs)`: each run's `r.window?.state ?? 'headless'`; PASS only when all five
  are `shown`, else INCONCLUSIVE with the reason `run <i>: <state>` for each run that wasn't (and a run count other than
  five). `judgeEfficiency` in canvas.mjs puts it in the verdict as `window` and in `reason` as `window: <reason>`.

So a mix (some runs shown, some not) is what the judge makes it: its window reading is INCONCLUSIVE, naming the runs not
shown. A measured test whose runs' window the judge reads INCONCLUSIVE skips with `INCONCLUSIVE (the window was not shown
throughout every run, …): <task>: window: <the judge's reason>` before it reads a run; one it reads PASS goes on with
every assertion as written, and `requireShownWindow` also checks each run's own `window.state` says `shown`. Any other
window status, or a verdict with no `window`, fails. For the planted clock in a mix the judge's overall verdict can still
be FAIL on frames, but the test's claims are about every run (each drew at least 60 frames), which a run with no shown
window can't answer, so it reads INCONCLUSIVE too.

## What was read

- AGENTS.md; issue #3370's body (section 2 only).
- `docs/technical-design.md`: How we know version 0 works and Dogfooding.
- `tests/acceptance/854/` at the base: `idle.test.ts`, `helpers.ts`, `README.md`; `redraft-3300/` (`idle.test.ts`,
  `helpers.ts`, `README.md`, `tsconfig.json`); `tests/acceptance/1551/lane.test.ts` for the shape of window readings.
- `benchmarks/canvas.mjs` (`workloads.idle`, `judgeEfficiency`), `benchmarks/canvas-judge.mjs` (`shownWindow`),
  `crates/deep-show/src/watch.rs` and `idle.rs` (the `window` deep-show writes), `scripts/lanes-lists.mjs` (`redrafted`,
  `byHand`, `timed`, lane files), `scripts/alone-lint.mjs`, `scripts/loads-lint.mjs`, `docs/adr/0010-lane-lists-reasons.md`.

## What changed

| File | What |
|---|---|
| `helpers.ts` | `export *` of `../redraft-3300/helpers.ts`, plus `requireShownWindow` and the `Skipper` type |
| `idle.test.ts` | `runsOf` takes the test's context and calls `requireShownWindow` after the report checks and before any run is read; one test added |
| `lane.json` | alone, `timing`, with `idle.test.ts` timed |
| `tsconfig.json` | #3300's, including the two helpers files it imports through |

The added test, "a reading whose window AppKit never showed reads INCONCLUSIVE with the judge's reason, …", proves the
change without a locked screen: made-up readings, each run as canvas.mjs records a `no_display` answer, go through the
measured tests' own `runsOf`: five runs with no `window` (`headless`), five `hidden`, and a shown reading with run 3
`covered`. Each skips with a note starting `INCONCLUSIVE` that holds `window: <the judge's own reason>` and names each run
not shown, and only those; the shown twin (`synthetic('idle')`) is read on, every run's `opened_frames` 1. On a wrong
program that asserts `opened_frames >= 1` before asking about the window, it fails with the issue's own message ("made-up:
run 1: the window drew the document when it opened, before the still minute: expected 0 to be greater than or equal to
1"); on one that always skips, the twin fails.

## Run it

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/854/redraft-3370 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/854/redraft-3370/tsconfig.json
```

The measured tests build and time exactly as the first draft's do (`../README.md`): a release `deep-show`, five 60 s
runs holding a real window. Here only the two made-up-reading tests were run (`-t "the lane's judge fails a reading that
drew frames|a reading whose window AppKit never showed"`); the measured ones were not. In `scripts/lanes-lists.mjs`
`redrafted` sends `tests/acceptance/854/redraft-3300/idle.test.ts` to this folder and `byHand` holds it, so it runs by
hand only; this folder runs alone with `tests/acceptance/854/`, and its `lane.json` times `idle.test.ts` as its
predecessor was timed. Delete Vitest's cache in `tests/acceptance/854/redraft-3370/node_modules/.vite` after a run.
