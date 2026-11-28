# Acceptance tests for #3590: a proof's bay-pair claim waits on a stall, not a fixed 30 minutes

A blind job wrote these tests before any work on #3590 existed, from these inputs only:

- issue #3590, as `gh issue view 3590` printed it on 2026-11-26: its Why, Scope, six acceptance criteria, Proof and
  Not in scope;
- `docs/parallel-proof.md`, section 4 (bays, claimed in pairs through the throttle's `bay pair` class) and section 6
  (the class table, the grant-wait table, "A wait bounded by a stall (#3334)", Drain, a stuck drain, Inherited grants,
  Tables of a test's own), and 7a's "The hour"; the Dogfooding and Repo guards parts of `docs/technical-design.md`;
  `AGENTS.md`;
- the base commit `5f95d82bb`, where `claimPair` asks `acquire('bay-pair', { wait: 30 })`. There I read
  `scripts/bays.mjs`, `scripts/throttle.mjs`, `scripts/proof-change.mjs` (the criterion tag), `scripts/proof-runs.mjs`
  (twins in the line form), `scripts/twins-lint.mjs` and `scripts/wait-ratchet.mjs`; and `tests/bays.test.mjs`,
  `tests/acceptance/1117/`, `3334/`, `2835/helpers.mjs` and `3567/` for their fixtures and conventions.

Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind redraft by this job.

## Run

```sh
node --test 'tests/acceptance/3590/*.test.mjs'
```

They must run under `node --test`: only inside a test run does a request keep a table of its own (section 6). They
are offline and use real processes: the checkout's own `scripts/bays.mjs` and `scripts/throttle.mjs`, copied into a
fixture repository, and real `throttle.mjs bay-pair` holders. Nothing is stubbed.

On the Spark (20 cores, 1-minute load 270 to 315) the suite took 27 to 38 s in three runs on a throwaway implementation
(below), with the files side by side, and 306 s on the merge base, where criterion 3's run is still waiting at its 5-minute limit
and is stopped by its process group.

**No test reads or writes the machine's `~/.deepbuild/throttle/` or `~/deepbuild-bays/`.** Each test makes a sandbox
(`../1117/helpers.mjs`, `sandbox`) whose temporary `HOME` holds the fixture repository, the bays
(`<HOME>/deepbuild-bays/`) and the throttle table (`<HOME>/.deepbuild/throttle/`), with `DEEP_THROTTLE`,
`DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `CARGO_TARGET_DIR`, `DEEP_TEST_GRANT_STALL`, `DEEP_TEST_GRANT_WAIT`,
`DEEP_THROTTLE_TABLE`, `DEEP_THROTTLE_READINGS` and `DEEP_THROTTLE_RUN` unset unless a test sets one. Every process a
test starts has a process group of its own and is stopped after the test by that group's PID; the sandbox is
removed. Nothing is stopped by name or port.

## The setup (`helpers.mjs`)

Reused by import, not edited:

- **The repository whose worktree gets a bay**: `machineRepo` from `../1117/helpers.mjs`, the setup
  `tests/bays.test.mjs` uses. The repository is `<HOME>/deepbuild`, holding this checkout's `scripts/` and the
  fixture, with a worktree at `<HOME>/deepbuild/.claude/worktrees/w` made by `git worktree add`. Its
  `scripts/bays.mjs` is the one claimed through, so its refusal sees the fixture's worktrees.
- **A copy of the repository** (criterion 4): the worktree copied beside itself, to `.claude/worktrees/copy`, and
  claimed through the copy's own `scripts/bays.mjs`, as `tests/bays.test.mjs`'s refusal does. It sits beside the
  worktree so node finds the scripts' packages from it as it does from the worktree.
- **`bays()`, `finished()`, `probe()`** from `../1117/helpers.mjs` for the CLI run: `node scripts/bays.mjs change --
  node probe.mjs <spec>` from the worktree; the probe writes a file once it starts, so "the command never ran" is that
  file's absence.
- **`start()`, `within()`, `THROTTLE`, `HOLD`** from `../3334/helpers.mjs`: a process in its own group, a bound on a
  wait, the throttle script and the 1.5 s a holder of a moving line holds its grant.

Written here:

- **A claim** (`claim`): `node --input-type=module -e <script> <bays.mjs URL>` with its cwd at the root, which
  imports `claimPair` from that `bays.mjs`, calls `claimPair(process.cwd(), print)` and prints one `CLAIM <json>` line:
  its pid, whether it got a pair (an object with `close`) and its index, its `refused` and its `blocked`. A pair is
  closed at once. Its pid is the requester's pid in the table and the log.
- **Every pair held still** (`holdEveryPair`): one `throttle.mjs bay-pair --wait 10` holder a pair (1 on the Mac, 3
  elsewhere: section 6's table), each printing `GRANTED bay-pair:<id>` and sleeping ten minutes.
- **The moving line** (`movingLine`): 11 holders a pair (33 on the Spark, 11 on the Mac), `throttle.mjs bay-pair --wait
  10`, each of whose commands waits for a gate file and then holds `HOLD` (1.5) s. While the gate is shut the first
  wave holds and the rest wait, so every holder is in the table at once; the test waits for that, starts the claim,
  waits until the claim's request is in the table behind them all, and opens the gate. From then on the grants change
  hands a wave about every 2 s, for 10 waves after the first: 20 s.
- **The log and the table**: `<HOME>/.deepbuild/throttle/log` (one JSON object a line) and `table.json`.

## Criteria to tests

The ID is `#3590.<first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed>`, as
`scripts/proof-change.mjs` works it out; each test's name starts with its ID.

| Criterion | Test (file) | What it holds | Wrong program, and the test's message on it |
|---|---|---|---|
| 1 `#3590.14b452d8` | `claim.test.mjs`, first | On a free table, `DEEP_TEST_GRANT_STALL` unset, the claim from the worktree returns a pair with an index 1..pairs; the log holds exactly one `granted` entry of class `bay-pair`, `grant: "top-level"`, of the claim's pid, and it carries `stall: 720` (the number) and no `wait` key | The merge base: "the claim's granted entry carries {"wait":30}, not stall: 720" |
| 2 `#3590.e0489985` | `claim.test.mjs`, second | `DEEP_TEST_GRANT_STALL=0.05`; the claim joins behind the whole moving line and returns a pair, not `{ blocked }`, and its grant is logged after the grants of every holder that was ahead of it | Twin **`fixed-wait`** (`twins/README.md`): "claimPair returned { blocked: "INCONCLUSIVE no grant: no bay pair came within 0.05 min" } behind a line whose grants changed hands every 2 s". The merge base passes: its 30 minutes outlast the line |
| 3 `#3590.e8f50f42` | `stall.test.mjs` | Every pair held still; `DEEP_TEST_GRANT_STALL=0.05`; `node scripts/bays.mjs change -- <probe>` from the worktree, given at most 5 minutes from its start, prints a line starting `INCONCLUSIVE no grant: no bay pair changed hands within 0.05 min` (its first line starting `INCONCLUSIVE`), exits 3, its command never ran; the log holds exactly one bay-pair `timeout` entry of its pid, carrying `stall: 0.05`; every holder still holds its pair | The merge base: "bays.mjs did not end within 300 s" (it waits 30 minutes), stopped by its group's PID |
| 4 `#3590.da82cdc0` | `refusal.test.mjs` | Every pair held still; `DEEP_TEST_GRANT_STALL` unset, so a claim that asked would wait 720 minutes (30 on the base). The claim from a copy of the worktree, through the copy's `bays.mjs`, returns `{ refused }` (a string) and no pair within 3 minutes; the log holds no bay-pair entry of its pid, and the table no request of it | Regression protection: passes on the merge base, as the issue says. Seen failing on a planted `claimPair` that asks `acquire('bay-pair', { wait: 0.05 })` before its refusal: "the log holds bay-pair entries of the refused claim's process" |
| 5 `#3590.71c9d39f` | none | `tests/bays.test.mjs`, `tests/acceptance/1113/drain.test.mjs` and `tests/acceptance/2835/` pass unchanged | No new test: those suites are the check, run as they are on the change. Not run by this job |
| 6 `#3590.3ac615f7` | none | Section 6's grant-wait table has a row for a proof's bay pair (`claimPair`) | No test: the criterion says by diff review |

## The surfaces assumed where the issue is silent

1. **"Returns a pair"** is an object with a `close` method, as the base's `Pair` is, and a numeric `index` 1..pairs.
   `{ refused }` and `{ blocked }` are read as plain fields. Nothing about the pair's use (`use`, `build`) is held.
2. **"The table's log entry `granted` for its top-level bay-pair request"** is the entry with `event: "granted"`,
   `class: "bay-pair"`, `grant: "top-level"` and `pid` the claiming process's pid. `stall: 720` and `stall: 0.05` are
   read as JSON numbers; a string `"720"` would fail. "No `wait`" is no `wait` key at all.
3. **"The log's `timeout` entry for the request"** is the entry with `event: "timeout"`, `class: "bay-pair"` and `pid`
   the `bays.mjs` process's pid (the test starts `bays.mjs` itself, so its pid is the requester's).
4. **"Prints a line starting ..."**: the first stdout line starting `INCONCLUSIVE` starts with the issue's words. What
   follows them (the base's `Fix:` line, any `; blocked by` holders) is not held.
5. **"Within 5 minutes"** is from the moment the test starts `bays.mjs` to its exit; a run still going then is stopped
   by its group's PID and fails.
6. **"Every bay pair held for longer than the bound with nothing else changing"**: one holder a pair, granted before
   the run starts and holding ten minutes; nothing else asks. That the holders still hold after the run is checked.
7. **"Behind a line whose grants change hands every 2 s for 20 s"**: the claim's request is in the table behind every
   holder before the line moves, and it is granted after all of them, so after 10 waves of hand-overs. The 2 s is the
   holders' 1.5 s and their hand-over, as in #3334's moving line; it isn't measured, so a slower machine makes the
   line slower, never the test stricter.
8. **"At once, with no wait"** (criterion 4) is read by the log and the table: no request of the process is logged or
   left. The 3-minute bound only turns a wait of 720 or 30 minutes into a failure; no clock is asserted.
9. **The bound of a test's own** is the bound of `DEEP_TEST_GRANT_STALL` alone. That an unset bound waits 720
   minutes is held only by the log's `stall: 720`, never by waiting.

## On the base

`BASE-FAILURE.txt` holds `node --test 'tests/acceptance/3590/*.test.mjs'` at `5f95d82bb`, on the Spark, paths redacted.
Criteria 1 and 3 fail at their assertions for the expected reasons: the granted entry carries `wait: 30`, and
`bays.mjs` is still waiting when its 5 minutes run out. Criterion 2 passes there (the base's 30 minutes outlast the
line), so its twin is its proof of failing first. Criterion 4 passes, as regression protection must.

To tell a test's fault from a program's, I wrote a throwaway guess at the change in a scratch folder outside the
checkout: `claimPair` asking `acquire('bay-pair', { stall })` with `stall` from `DEEP_TEST_GRANT_STALL`, else 720, and
returning `INCONCLUSIVE no grant: no bay pair changed hands within <stall> min`. All four tests passed on it, three times.
With `fixed-wait` laid over it from its `lines.json`, criterion 2's test failed with the message above (and criteria 1
and 3 failed too). `BASE-FAILURE.txt` ends with the result lines of two of those runs, the twin's, and the planted claim of criterion 4's row. The guess is deleted and proves nothing about
the real change.

## What the tests can't see, and what I left out

- **720 real minutes.** Only the logged `stall: 720` is held; no test waits out the bound unset.
- **A proof's copies.** The issue's surface is `claimPair` and the CLI; `proof-runs.mjs`'s `bayPair` reading the
  `{ blocked }` line "as today" is not run here.
- **The drain** (Scope: "the drain is unchanged") has no criterion here; criterion 5 names `tests/acceptance/1113/
  drain.test.mjs` for it.
- **A refused root under another's pair, or a test-started proof** (Scope: who gets a pair): only the copy, which the
  criterion names, is run.
- **`; blocked by` holders on the CLI's line**, and the `timeout` entry's `blockers`: not asked by the criterion, not
  held.
- **The Mac.** Drafted and run on the Spark (Linux, three pairs). The Mac's one pair is provided for (`PAIRS` from
  `../1117/helpers.mjs`), but nothing ran there.
- **Fixed waits**: none in these files. The bounds that turn a hang into a failure are `within()` (marked `// deadline:`
  in `../3334/helpers.mjs`), `finished()` and `until()` in `../1117/helpers.mjs`.

## Files

- `helpers.mjs`: the fixture, the claim, the holders, the moving line, the log and the table.
- `claim.test.mjs` (criteria 1 and 2), `stall.test.mjs` (criterion 3), `refusal.test.mjs` (criterion 4).
- `twins.json`, `twins/README.md`, `twins/fixed-wait/lines.json`: criterion 2's twin, in the line form.
- `BASE-FAILURE.txt`: the run on the base, and the guess's and the twin's result lines.

No fixture holds a secret or personal data.
