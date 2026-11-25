# Acceptance tests for #3336: a unit lane run leaves the tree as it found it

These tests were written before any implementation existed, by a job that never saw one. It had issue #3336, #1941
for context, AGENTS.md, `docs/technical-design.md` (Dogfooding), `docs/parallel-proof.md` (lanes, evidence records)
and base commit `3c564bbdd`: `scripts/lanes.mjs` (`checks`, `runLanes`, `exactTree`, `writeRecord`),
`scripts/lanes-lists.mjs`, and `tests/acceptance/1941/` (the taste test that writes into the checkout). The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## Criteria → tests

| Criterion | Test | File |
|---|---|---|
| `#3336.f7adc8c8` A unit lane run leaves `git status` clean: the tree after the lane's commands is the tree it started on. | `#3336.f7adc8c8 after #1941's taste test runs as the unit lane runs it, git status of the copy is clean` | `taste.test.ts` |
| `#3336.7d4ab4ab` Whatever the run writes goes to a temp or run folder: #1941's screenshots are written outside the checkout, and the run names where. | `#3336.7d4ab4ab #1941's taste run writes nothing into the checkout, its screenshots land outside it, and the run names where` | `taste.test.ts` |
| `#3336.f0336513` A planted writer that targets `docs/evidence` fails: a test that writes a tracked file under `docs/evidence/` makes the unit lane FAIL, naming the path. | `#3336.f0336513 a planted test that writes a tracked file under docs/evidence/ makes the unit lane FAIL, naming the path; its twin writing to a temp folder passes` | `planted-writer.test.ts` |

## The taste run (criteria 1 and 2)

The issue's Proof: "it runs #1941's taste test from a clean copy and reads `git status` after". `helpers.ts`
`tasteRun` does that once for both tests:

1. **A clean copy.** Every top-level entry of this checkout but `.git` is cloned (`cp -cpR`, APFS clones, mtimes
   kept, so `target/` and `node_modules` come along) into a sandbox under the OS temp folder, and committed as one
   fresh git repository. Its `git status` is clean before the run, or the helper throws.
2. **The placeholder screenshots.** Before that commit, each tracked `docs/evidence/1941/*.png` in the copy holds a
   fixed placeholder text. The issue saw the tree change only where render-back's bytes differ from the committed ones
   (`contrast-muted-*` on one Mac); with placeholders committed, any drawn screenshot written into the checkout
   changes a tracked file on every Mac, so the test doesn't depend on which Mac it runs on.
3. **The files the unit lane runs.** `tests/acceptance/1941/taste.test.ts` while the copy has it, and every
   `*.test.ts` under `tests/acceptance/1941-redraft-3336/` (issue: Scope), less any the copy's lanes leave out of the
   unit lane (`byHand`, `ownLane`, read with lanes.mjs's own `listed`). So a first draft retired by deletion or by
   listing runs no more, and one still run by the lane is judged.
4. **The run.** `node node_modules/vitest/vitest.mjs run --no-file-parallelism <files>` from the copy's root, the
   unit lane's runner, with `TMPDIR` a folder of the run outside the copy and `CARGO_TARGET_DIR` unset, so the copy
   builds into its own `target/`. It is stopped (its own process group, by PID) once 18.5 minutes since the copy
   began are spent, under the lanes' 20-minute file cap.
5. **What is read after.** The copy's `git status --porcelain --untracked-files=all`; every file under the copy
   (tracked, untracked and ignored, outside `.git`, `node_modules` and `target/`, the tools' caches and builds) that
   the run created, rewrote (size or mtime) or removed; every `.png` outside the copy under the run's `TMPDIR` or under
   a temp folder (or a `.png` file) the output names by absolute path; and which of those lie under a path the output
   names.

Neither test judges whether #1941's own test passes (it fails at the base on `texture-missing`, and reads
INCONCLUSIVE with no `TASTE.json`): only where its files land and whether the tree changed.

- **`#3336.f7adc8c8`** fails when no #1941 taste file is run by the unit lane, or when `git status` of the copy lists
  any line after the run. A clean tree after a run that drew no screenshot outside the copy (or was stopped) reads
  INCONCLUSIVE, never PASS: nothing was drawn, so nothing was proven.
- **`#3336.7d4ab4ab`** fails when the run created, rewrote or removed any file under the copy, or when it wrote
  screenshots outside the copy but its output names no folder or file holding them. A run that drew none anywhere
  reads INCONCLUSIVE.
- Off macOS both skip at once with `INCONCLUSIVE (platform)`: #1941's taste test draws on Metal and draws nothing
  elsewhere (issue: Runs on), so a clean tree there would prove nothing.

## The lane run (criterion 3)

The issue's Proof: "it runs the unit lane's tree check on a planted test that writes under `docs/evidence/` and
expects FAIL naming the path". `helpers.ts` `laneRun` builds a fixture git repository: this checkout's root files and
`scripts/` (tracked and untracked files git doesn't ignore), `tests/vitest-setup.ts`, `node_modules` linked to the
checkout's (ignored by an added `.gitignore` line), a tracked `docs/evidence/3336-planted/scene-before.png`, and one
planted vitest file `tests/planted-3336.test.ts`; committed, clean. In a child process with cwd at the fixture and a
sandbox HOME and TMPDIR it imports the fixture's own `scripts/lanes.mjs`, takes the `unit` entry of `checks`, and calls
`runLanes([{ ...unit, commands: [unit.commands[0]] }])`: the unit lane with its parallel vitest block, the only one
with a file to run here (the alone block, cargo and node's tests have nothing in the fixture and would take the run
past its cap). The lane's printed lines, exit status, its evidence record under the sandbox HOME
(`~/.deepbuild/lanes/<tree>-unit.json`) and the fixture's `git status` are read.

- **The clean twin** writes the same screenshot to a temp folder and passes: the lane must read `PASS unit`, exit 0,
  record `PASS`, tree clean. So a FAIL below is the tree's, not one any lane run gets.
- **The planted writer** rewrites the tracked screenshot and passes (its tree reads ` M docs/evidence/3336-planted/scene-before.png`,
  checked, so the writer did write): the lane must print a `FAIL unit…` verdict whose text (up to its `Fix:` line)
  names `docs/evidence/3336-planted/scene-before.png`, exit 1, and its record must read `FAIL`.

## How each test fails on the wrong program

All three fail on the merge base itself (`BASE-FAILURE.txt`), so no twin is needed; the issue's twins are covered by
the base:

- **A taste test writing into the checkout** (the base's `tests/acceptance/1941/taste.test.ts`, run by the unit lane,
  with no redraft): it writes `docs/evidence/1941/<scene>-{before,after}.png` into the copy, so `#3336.f7adc8c8`
  fails at `git status` (` M docs/evidence/1941/…`) and `#3336.7d4ab4ab` at the files written under the copy.
  The placeholder screenshots make this so on every Mac, not only where render-back's bytes differ.
- **A lane that never reads the tree again** (the base's `runLanes`, which reads `exactTree` once when the lane
  starts): the planted writer's lane reads `PASS unit` and records `PASS`, so `#3336.f0336513` fails at its FAIL
  assertion.
- A taste redraft that writes outside the checkout but prints nowhere fails `#3336.7d4ab4ab` at its naming assertion;
  a lane that FAILs every run fails `#3336.f0336513` at its clean twin.

## What isn't tested

- A full unit lane run that ends with `git status` clean on the real repository: a reading by hand (issue: Proof).
  `#3336.f7adc8c8` judges the one writer the issue found, #1941's taste test, run as the lane runs it; the lane's own
  tree re-read (criterion 3) is what catches any other writer.
- Whether the tree check covers every lane, not only `unit`: the issue names the unit lane.
- The retirement commit's signed approval tag and `scripts/lanes.mjs`'s guard: the guard lane's, not a test's.
- Whether #1941's screenshots look right, or #1941's own test passes: #1941's criteria, not this issue's.
- What the redraft prints besides the folder: only that its output names a path that holds the screenshots.

## Running

`npx vitest run tests/acceptance/3336` (Node 24, cargo on PATH). The taste file copies the checkout (about 5 GB of
APFS clones, seconds to a minute), commits it (minutes under load), and builds `deep-show` in the copy before the
taste run: with this checkout's `target/` cloned along, only the crates whose build paths moved rebuild. Off macOS the
taste file's tests skip INCONCLUSIVE at once; the lane file runs everywhere.
