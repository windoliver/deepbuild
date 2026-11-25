# Acceptance tests for #2060: a carried result's key reads the programs its check's command names

A result made under one version of a program no longer carries once the program's file is replaced or gone.

Written first, blind, by a job that never saw an implementation of #2060. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Sources

Only these were read:

- Issue #2060's body: its scope, four acceptance criteria and Proof.
- `node scripts/design-section.mjs --issue 2060`: `docs/technical-design.md`, How runs become one of five verdicts
  (Carried across sessions, Pinned to a commit), Sessions that know about each other, An agent says it's done. Also
  Dogfooding, Repo guards. `AGENTS.md`.
- Base commit `a2cbc50d9` (main), for where to enter, never for an expected value: `packages/hub/src/shared-runs.ts`,
  `gate-runner.ts` (`keyed`, `carry`, `onBase`), `stop-judging.ts` (`judged`, `runApproved`), `plant.ts`,
  `packages/checks-command/src` (`linkPrograms`, `traced`), `packages/gate/src` (`maskIn`, `ownRead`),
  `packages/verdicts/src` (what a verdict records).
- The suites `1018`, `1018-redraft-1830`, `3229`, `29`, `31` and `875` for conventions. `helpers.ts` imports
  `../3229/helpers.ts`: its world, followed record, sessions (a hook is fired again until the record holds its event),
  bound and cleanup.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # every test starts `deep hub run` from packages/cli/dist
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease cargo build --locked -p deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/2060/carry.test.ts --testTimeout=600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/2060/tsconfig.json
```

Nine tests, each a hub and two sessions of its own, one after another (`lane.json`), three to fifteen seconds each at a
load of 60 to 200 on 18 cores. No network, no model, no real `claude`, no sign-in and no runner job: every definition is handed
(`DEEP_HUB_TEST_DRAFTS`). Folders are under that helper's `/tmp/dh3229-*`, removed after each test; HOME is the test's
own; a process is stopped by the PID it was started with. No test waits for time to pass.

## Criteria to tests

IDs are `criterionId` in `scripts/proof-change.mjs`. All are in `carry.test.ts`.

| AC | ID | What it proves | Wrong program |
|---|---|---|---|
| AC1 | `#2060.6d14b8db` | A reads PASS under version 1; the file is replaced by version 2; of B's claim on the same files nothing is marked carried, its result names B's own run, and no verdict of it is PASS | the merge base; plant `key-leaves-out-programs`, named by `fixture-tool` |
| AC2 | `#2060.df8e51b3` | the file left as it is: one run of the check between the two claims, A's, which B's result marks carried and names | plant `key-holds-program-link` |
| AC3 | `#2060.e0ef1360` | a fix check, the file left as it is: the one base run is A's, which B's result marks carried and names. The file replaced by version 2: A's base run is not carried to B, and B runs the check on the merge base itself | the merge base (the second part); plant `program-readings-head-only`, named by the check |
| AC4 | `#2060.ad981d1d` | `fixture-tool` removed after A's PASS: nothing of B's claim is marked carried, and no verdict of it is PASS | the merge base; plant `skips-absent-program`, named by `fixture-tool` |

What the base already holds: AC2's right leg and the first of AC3's (the file left as it is) pass there, so on their own
they prove only that the change doesn't stop what carries today; their plants are what show they can fail. AC1, AC3's
second leg and AC4 fail on the base at their first assertion, where B reads A's result as carried (`BASE-FAILURE.txt`).

## The surface under test

Names marked *(chosen)* are this job's choices where the issue and the design name none; a dispute starts there.

- **The hub, the hook, the sessions.** `deep hub run` with `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS`,
  `DEEP_HUB_TEST_SECRETS` and `DEEP_HUB_PLANT`, its PATH the program's folder, Node's and the system's; the real
  deep-hook; a Claude Code stand-in process per session. A hub that can't start is BLOCKED (thrown), never a pass.
- **The program.** `fixture-tool`, an executable script whose `#!` line is `/usr/bin/env node`, outside the system's
  folders. On the hub's PATH it is a link to its file in another folder *(chosen)*, as a package manager's commands are:
  the Scope reads "the program's real file", and a reading of the link alone stays the same when the file is replaced.
  Version 1 reads `src/a.txt` from the working directory and exits 0. Version 2 is a longer file that reads it and exits
  1. A replacement is a new file renamed over the old one; a removal takes the link and the file.
- **The checks.** `.deepbuild/checks/tool.sh` is the one line `fixture-tool` (AC1, AC2, AC4), `on_base: passes`.
  `.deepbuild/checks/fix.sh` is `fixture-tool && node --test test/cart.test.mjs` (AC3), `on_base: fails`, naming the
  assertion `test/cart.test.mjs:6`, which the cart fails on the merge base and passes on the fix.
- **AC3's version 2** *(chosen)*: a longer file that exits 0. The gate makes a fix check's base run only once its head
  run passed, so under a version 2 that exits 1 no base run is due on any program, and the criterion's "B's base run runs
  again" could never hold. Where B's own run on its snapshot doesn't pass, the test is BLOCKED.
- **The sessions.** A and B, each in a linked worktree of one repo cut from one commit, type the same prompt, make the
  same one edit (`src/cart.mjs`) and stop, B after A's verdict. Nothing the check reads differs between them. The program
  is left, replaced or removed after A's verdict and before B's stop. A that doesn't read PASS is BLOCKED.
- **What a claim reads**: every string of each `verdict.made` about it, and its line and second line from
  `changes.read`. *Marked carried* is the word `carried` in one of them; a string that marks a run carried names it by
  its handle. A run's claim and commit are `run.started`'s; a base run is one on the merge base's commit.
- **"Reads no carried result"** (AC4): nothing marked carried. Which verdict B gets instead is left open, as the issue
  leaves it; only PASS is ruled out.
- **What isn't judged.** A run of B's that ended as neither a pass nor a fail (AC1, AC2's plant), a snapshot past the
  gate's own budget, a stop that made no claim and a claim with no verdict in ten minutes are BLOCKED.

## Proof on a wrong program

The implementer adds each name to `packages/hub/src/plant.ts`. The base's hub refuses each (`names no planted program`)
and doesn't start, so those legs read BLOCKED there, never a pass.

| `DEEP_HUB_PLANT` | AC | The wrong behaviour |
|---|---|---|
| `key-leaves-out-programs` | AC1 | No key, head or base, holds any reading of a program, as on the merge base: B reads A's PASS as carried after the file is replaced. |
| `key-holds-program-link` | AC2 | A program's reading in a key also holds the path of the run's own link to it (`<the run's folder>/bin/fixture-tool`), which no two runs share: no key equals another's, so nothing carries and B runs its own. |
| `program-readings-head-only` | AC3 | A head run's key holds the readings and a base run's holds none: after the file is replaced B's own run runs again, and A's base run carries to B. |
| `skips-absent-program` | AC4 | A named program the hub no longer finds is skipped instead of read as absent, and takes no part in whether two keys are equal: with `fixture-tool` gone, B's key equals A's and A's PASS carries. How it skips is the implementer's (a stem that only drops the reading isn't equal to A's; keeping the last reading taken is one way); the test needs only that A's PASS carries. |

Each planted leg first checks that the plant is the program the criterion names (B reads PASS, carries nothing, or has its
own head run), then that the criterion's judgement fails on it, naming what the criterion says it names.

Before the recorded run, this job ran the nine tests outside Vitest, on the base's hub with a throwaway version of the
rule and of the four plants patched into its modules as they load (kept nowhere): all nine held, and with a reading of
the link in place of its file AC1 failed.

## Open points

1. The Scope's other lines have no criterion and no test here: that the reading is one file status per program per claim
   and reads no bytes, a program replaced by one of the same size, a program named by a path, and what a version
   manager's launcher picks.
2. A reading of the program's size alone passes these tests, since the issue makes version 2 a longer file.
