# Acceptance tests for #2699: a stop whose checks all carry makes no checkout

Written first and blind, at base commit `6a2b68d44dd4dee8eeb2dea46f412fd632b1718d` (origin/main, "Merge pull request
#2838 …"), from issue #2699 (its account of the bug, Scope, all five acceptance criteria and Proof), the design and the
base, before any implementation. The drafting job saw no fix, diff, other branch, other worktree or pull request. The
implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). There is no taste criterion, so no `TASTE.json`.

## What was read

- **The issue**: #2699, as handed to this job.
- **The design**, `docs/technical-design.md`: An agent says it's done (a claim's checks run on its snapshot in a
  temporary checkout, never the live worktree); How runs become one of five verdicts, Pinned to a commit and Carried
  across sessions; in How we know version 0 works, Criteria to tests, Wrong programs ("for a fix, the merge base is that
  program … for new code it is the planted twin the criterion names … a planted wrong program lives in test code") and
  Dogfooding.
- **The base code, to learn how to drive it**: `packages/hub/src/gate-runner.ts` (`stop`: the snapshot, `reuse`, the
  checkout, the carry by tree, `verdictOf`), `packages/gate/src/checkouts.ts` (the base-commit service: `snapshot`,
  `checkout`, its `root` folder of `c-*` checkouts) and `packages/hub/src/stop-judging.ts` (`same` is the hooks' word: no
  call but reads since the session's last claim, so a turn that ran a command hands the gate no `same`).
- **Sibling suites, for their conventions and helpers**: tests/acceptance/2118 (`gate.ts`, the gate runner on a bench
  with #31's real base-commit service), 2078 (reuse after a reads-only turn), 31 (the world and git helpers), 45 (its
  `twins.json` and `twins/<name>/<repo path>` overlays) and `packages/hub/test/snapshot-sibling.test.ts`.

## The surface under test

The criteria count checkouts made, files written under the checkouts' folder and processes started, so the tests drive
the smallest real stack where those can be counted honestly: **the hub's own `GateRunner`**
(`packages/hub/src/gate-runner.ts`, through its public `stop` and `verdictOf`), given what `core.ts` gives it, on a bench
(`bench.ts`) built as #2118's is:

- **Real**: the gate runner; the base-commit service (`openCheckouts` through #31's `openWorld`), so every snapshot and
  every checkout is real git into the service's real checkouts' folder (`<tmp>/checkouts`); the record; real repos; each
  check's program, a node script run in the folder the gate names.
- **Standing in**: only the hub's run service, at `start` and `ended` (as in #2118 and `snapshot-sibling.test.ts`). A
  start in no folder rejects, as the hub's own run service can't run a command nowhere; otherwise the check's program
  runs in the folder the gate named, and the run is recorded and keyed as `runs.ts` does (`recorded`, then `keyed`).
- **What the bench counts, outside the code under test**:
  - *checkouts made*: each top-level folder that appears under the checkouts' folder while counting, seen by a recursive
    `fs.watch` on it, or named by a git process that works there (`checkout-index --prefix=<root>/c-…`); folders already
    there when counting starts (an earlier claim's checkout, still in use or being given back) are left out;
  - *files written under the checkouts' folder*: every path there the watcher reports;
  - *processes started*: a `git` first on `PATH` that writes one record per process (its folder and whole command line)
    and then execs the real git. On this bench every process the gate and the service start is git: the repo has no
    ignored dependency folder, so no copy of one is started.
  Counting starts once what came before has settled (1.5 s with no write there and no git process) and ends once every
  run has ended and nothing was written or started for 1.5 s.

No mock of anything DeepBuild owns.

## The scenario

One session on a repo whose `main` holds `src/price.cjs` (`total` takes the discount off), three check programs
(`price`, `sum`, and `state`, which reads the workspace's `state/now.json`) and nothing ignored. The session works on a
branch cut from `main`; the merge base is `main`. Each check is a definition check (`on_base: passes`, `expected_ms: 1`),
so it runs in the fast lane and no merge-base run is made.

1. **The first claim**: the stop's checks run in a checkout of its snapshot and pass, so the claim is PASS. Anything else
   is BLOCKED (thrown): the scenario never reached the criterion.
2. **The turn**: `git status` and one shell command (`ls -la src`) in the worktree, which change no file. The hub hands
   the next stop to the gate with no `same` (the turn did work); the tests do the same.
3. **The second stop**, counted.

## Criteria to tests

| Criterion | ID | Test | What it asserts, in order | On the base |
|---|---|---|---|---|
| AC1 | `#2699.de6fa40e` | `unchanged.test.ts` `AC1 …` | no run starts for the second claim; its verdict (outcome, commit, each check's result, counted runs, staleness and inheritance, send-backs) equals the first claim's, which is what the merge base carries; **no checkout is made** | **fails**, naming the checkout: `yet 1 checkout(s) were made under the checkouts' folder … (c-…)` |
| AC2 | `#2699.aefbe26c` | `unchanged.test.ts` `AC2 …` | the stop writes no file under the checkouts' folder; no process it starts works in or names that folder; every process it starts is matched, by folder and whole command line, by one a stop after reads alone (`same`) on the same tree starts — what is left over is "beyond the snapshot's" | **fails**: the checkout's files (`c-…/src/price.cjs`, …) were written |
| AC3 | `#2699.d256b2af` | `changed-byte.test.ts` | with `src/price.cjs` changed by one byte (`-` to `+`): `price` runs for the second claim in a checkout under the checkouts' folder holding the changed file and fails; `sum` runs there too and passes; one checkout is made; the claim is FAIL | passes |
| AC4 | `#2699.2f2544a1` | `inputs-changed.test.ts` `AC4 not ended …` | the first claim's stop is held 3 s and the bench holds `price`'s run past it and past the second stop, so `price` has not ended on the last claim; on the unchanged tree the second stop runs `price` in a checkout and it passes; one checkout is made | passes |
| AC4 | `#2699.2f2544a1` | `inputs-changed.test.ts` `AC4 recorded reads changed …` | a workspace claim (#67) whose check `state` reads `state/now.json`: the first claim pins one open item and passes; on the unchanged tree the second pins two; `state` runs in a checkout on the new reading and fails; one checkout is made; the claim is FAIL | passes |
| AC5 | `#2699.2f6ad804` | none here | `tests/acceptance/45/` and `tests/acceptance/33/` pass unchanged: run by the implementer on the change (`node scripts/affected.mjs tests/acceptance/45 tests/acceptance/33`, or `npx vitest run` on both folders), no copy of them here | not run by this job |

Each ID is `#2699.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`), checked against the issue's body.

**Why AC2's reference is a reads-only stop.** "The snapshot's" processes are the stop's reading of the worktree: the
snapshot and the reads beside it (`git diff`, `ls-files`, the repo's common dir). A stop after reads alone (`same`) on
the same tree already reuses with no checkout on the base (#2078), on the base and on the change alike, so what it
starts is exactly that reading. On the base the stop under test starts seven git processes beyond it (`read-tree`,
`ls-tree`, `checkout-index --prefix=<root>/c-…/` and the checkout's own reads of the worktree).

## The wrong programs

- **AC1 and AC2: the merge base.** On `6a2b68d44` the stop takes its snapshot, `reuse` fails on `r.same`, and it makes a
  checkout of the unchanged snapshot (`gate-runner.ts`, the `checkouts().checkout` call after `reuse`), carries every
  result and gives the checkout back. AC1 fails at its last assertion, naming the checkout; its verdict and runs
  assertions pass there, so they hold the merge base's values. AC2 fails at its first assertion, on the checkout's files.
- **AC3: the planted runner `skips-checkout-when-passed`** (`twins/skips-checkout-when-passed/packages/hub/src/gate-runner.ts`):
  the base's gate runner, which skips the checkout whenever the last claim passed and carries that claim's results as if
  its tree were this one's. AC3 fails at its first assertion, naming the file: "src/price.cjs changed by one byte since
  the last claim, so price must run … holding the changed src/price.cjs; no run of it started there, so the claim
  carries a result from before src/price.cjs changed" (the claim carries PASS).
- **AC4: the planted runner `looks-at-tree-alone`** (`twins/looks-at-tree-alone/packages/hub/src/gate-runner.ts`): the
  base's gate runner, which skips the checkout whenever the tree and HEAD equal the last claim's, whatever ended there,
  and leaves the claim's state reading (#67) out of the tree it compares. Both AC4 tests fail at their first assertion,
  naming the check: `price` has no folder to run in (the start rejects; the claim is BLOCKED), and `state` is carried
  from the old reading (the claim is PASS).

`twins.json` maps AC3 and AC4 to their twins. Each twin is a whole copy of the base's `gate-runner.ts` with the planted
lines marked `#2699's planted runner`; laid over the change by the proof lane it replaces the fixed file with the wrong
program. Should the change move what `gate-runner.ts` exports or imports, a twin may need a blind redraft; it is a wrong
program that compiles and runs on the base (the record below).

`BASE-FAILURE.txt` holds the run on the base (2 failed, 3 passed, as above) and, for the record, the two twins laid over
the same base's `gate-runner.ts` with a scratch vitest config aliasing that one file (AC3 fails on its twin; both AC4
tests fail on theirs). Machine paths are redacted.

## How to run

With Node 24.22 first on `PATH` and the workspaces built (`npm run build --workspaces`, for the packages the gate runner
imports by name):

```sh
npx vitest run tests/acceptance/2699 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/2699/tsconfig.json
```

- No hub, no hook and no Rust build: the tests start only git and node.
- Every folder is #31's, under `/tmp/dh31-*`, removed after the file; `HOME` is a temp folder (#31's helpers); the
  counting git lives in one of those folders and is first on `PATH` only for the test's own process, restored at close.
- No network, no model. Fixtures use synthetic identities only (`T <t@example.test>`, #31's).
- A snapshot or checkout the base-commit service can't make inside its budget (#31) is INCONCLUSIVE (a skip, never a
  pass).

## Where the issue leaves the interface open

- **How the runner decides.** The issue says the runner asks "what the carry asks" after the snapshot; the tests assert
  only what the stop does (checkouts, writes, processes, runs, verdict), never how it decides.
- **Join and release checks.** Scope names a join and a release check due on this head as still getting their checkout;
  no criterion does, and the tests encode neither (a join and a release check need the definition's lock and a pinned
  commit, beyond this bench).
- **"Recorded reads".** Read here as the claim's pinned state reading (#67), which the gate folds into the tree it
  compares: on an unchanged git tree it is the only read a check records that can change. A different reading (for
  example ignored files a run read) is not encoded; the base carries such a result today, so it isn't "a check whose
  inputs changed" that the base runs.
- **"Not ended"** is played by a fast-lane run still going when the next stop comes. A slow check never started is not
  encoded separately.
- **"Counted by the test"** counts at git and the file system, not inside the service: a fix that made a checkout by some
  other path would still be counted.

## Files

- `bench.ts`: the bench (the gate runner, the real base-commit service, the run service's stand-in, the counting git and
  the watcher), the repo and checks, and the readings shown in failure messages.
- `unchanged.test.ts`: AC1 and AC2.
- `changed-byte.test.ts`: AC3.
- `inputs-changed.test.ts`: both AC4 tests.
- `twins.json`, `twins/`: the two planted runners.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`, twins left out.
- `BASE-FAILURE.txt`: the run on the base commit and the twins' runs.
