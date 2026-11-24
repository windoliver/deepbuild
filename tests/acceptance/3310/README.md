# Acceptance tests for #3310: the before lane runs no by-hand test file

Written first, blind, from issue #3310 (its Scope and two acceptance criteria), `docs/technical-design.md` (How we know version 0 works), `AGENTS.md`, and the base commit `0a875355b`. The approach and helpers are #569's (`tests/acceptance/569/helpers.mjs`, imported as is). The implementing agent doesn't edit these files; a dispute goes to a blind redraft by this job.

## Run

```sh
node --test 'tests/acceptance/3310/*.test.mjs'
```

Node 24.22 or newer, git, and this checkout's `node_modules` (`npm ci`). No network, no `gh` login. Each test builds its own scratch git repository under the system temporary folder and removes it afterwards. The three tests take about 13 s on the base and all fail at their assertions (`BASE-FAILURE.txt`, local paths redacted).

## Surfaces

- **`node scripts/proof.mjs before`** and **`node scripts/proof.mjs before trace`**, run as a process from this checkout with its cwd at a scratch repository (#569's `proof()`).
- **The scratch repository's own `scripts/lanes.mjs`**, committed on the merge base so the change doesn't touch it, exporting `byHand` (one path entry, or one folder entry ending `/`) and an empty `timed`.
- **Tagged test files** under `tests/acceptance/93101/`, and commits saying `Part of #93101` or `Closes #93101`.
- **`DEEP_PROOF_ISSUES`**: the planted issue's body, three criteria, tags built at runtime from their text.

The planted issue is `#93101`. Its tags begin `#93101.`, which no real issue's tag begins with, and no file here holds a literal tag of it. Scratch repositories aren't worktrees of this checkout, so the proof gets no bay pair and uses temporary copies; with `timed` empty no timed grant is asked for.

## Tests

| Test | ID | Criterion |
|---|---|---|
| a by-hand file listed by its path | `#3310.b5cddbf4` | Before runs no by-hand file (path entry) |
| a by-hand file under a folder entry ending in `/` | `#3310.b5cddbf4` | Before runs no by-hand file (folder entry) |
| Closes, with one criterion tagged only by a by-hand file | `#3310.5f3438ea` | A criterion that only a by-hand file tags stays open |

Criterion 1's scene: the by-hand test tags criterion 1 and fails on the change at its assertion. Two tests of #93101 not on the list sit beside it: one that passes on the change and fails on the merge base at its assertion (must print `PASS before: … failed on the merge base at its assertion`), and one that fails on the change (must print `FAIL before: … fails on the change`, so the run exits 1). On the base the by-hand file prints `FAIL before: … fails on the change`, and the test fails at its assertion that no problem line names it.

Criterion 2's scene: `Closes #93101`; the by-hand file is the only test of criterion 1, passes on the change and fails on the merge base at its assertion; criteria 2 and 3 have unlisted tests that are proven. On the base trace prints `PASS trace: Closes #93101: …`, and the test fails at its assertion that a `FAIL trace:` line names `Closes #93101`.

A sketch of the fix (leave out the listed files in `prepareRuns`, print a `before:` line for each) was tried in a throwaway copy outside this checkout: all three tests passed there. It is not part of this commit.

## Readings

1. **"A before line names the file as by hand."** Any stdout line starting `before: ` or `<STATE> before: ` that holds the file's repo path and the words `by hand` (any case). Its state is free, but criterion 1 forbids it being FAIL, BLOCKED or INCONCLUSIVE.
2. **"No line … FAIL, BLOCKED or INCONCLUSIVE for that file."** Read with INVALID too, the fourth state that fails a run (invariant 2): no FAIL, BLOCKED, INVALID or INCONCLUSIVE before line holds the file's path or its test's name. Not running the file also means no `PASS before:` line names its test.
3. **"Run and judged as today."** Shown by one unlisted test proven on the merge base (PASS) and one failing on the change (FAIL), both with today's wording.
4. **"Refusing `Closes #n` with that criterion open."** A `FAIL trace:` line holding `Closes #93101` and the by-hand criterion's ID, and neither ID whose unlisted test is proven, as #569's trace tests read `Part of`. The test also requires no problem line from before, so the refusal comes from the open criterion and not from before.
5. **Where `byHand` is read.** From the repository under proof's `scripts/lanes.mjs`, as `timed` is today. The scratch file is identical on the merge base and the change.

## Not covered

- The Proof's run in a fresh clone with an empty `Closes #1841` commit: that is the implementer's evidence, not a test here.
- "Nothing else changes" for the guard and mutation lanes: no lane but before and trace is run.
