# Blind redraft of #3238's inherited-grant test under #3694

#3694 changes what `scripts/throttle.mjs` does with a plain test request: a `test` request from a chain under no grant that isn't an `affected.mjs` run's. Under #3694 it is admitted as a run is, without the load, then takes a turn on the machine's pool of job tokens as a run of one job, as #3549 made builds do. Its command starts only once it holds a token. On a test's own table the pool is the readings' cores less one, at least one. `tests/acceptance/3238/inherited.test.mjs` gives its table readings of `{ memory: 2 ** 40, load: 1000, cores: 1 }`, a pool of one token. It holds `BUILD_SLOTS` build grants first, and each admitted build takes a turn (#3549), so the pool's one token is held. The run's own test grant, a plain one, then waits for a token that never frees, so the job never starts and the test fails on a right program. This folder redrafts the test from #3238's AC2, #3694's body and the base `894a293f2`.

The original is not edited or deleted; a person approves the swap. Run with:

```
node --test tests/acceptance/3238-redraft-3694/inherited.test.mjs
```

It imports `tests/acceptance/3238/helpers.mjs` unchanged. There are no helpers of this folder's own.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `3238/inherited.test.mjs` › #3238.664c776d a command scripts/lease runs under an ancestor's test grant starts at once, the log showing passed for it and no build request | #3238.664c776d | Readings of 1 core give a pool of one token, and the build holder's turn takes it. Under #3694 the run's plain test grant waits for a token, so its command, the job through `scripts/lease`, never starts. Its scene also kept a second test grant out by the load alone (load 1000 on 1 core), which #3694 no longer reads for a plain request | `inherited.test.mjs` › same name. Two changes to the readings, nothing else. (1) `cores: BUILD_SLOTS + 2`, a pool with a token for each build holder and one for the run. (2) Once the holders hold their grants, the file is rewritten whole (by rename) to `memory: 0`, keeping `load: 1000`. Each holder's grant is a build admission, which needs memory for a second build, so the memory goes only after they are held. The run's grant is the first test grant, granted whatever the readings. From then on a second test grant, or another build, finds no memory for a run on either program. So the twins `own-test-grant` and `own-grant` still have a request of their own that can only wait. The holders, the run, the job, the 3 min bound, the assertions and the expected values are the original's, line for line |

The original's header says a second test grant is kept out by "the readings leave no room". Under #3694 load can't do that for a plain request; memory does, on both programs. "Every build slot is held" in that header was already not literal on the base: `BUILD_SLOTS` is 1 on the Mac where the build ceiling is 4 since #3549. That is unchanged here, and the `own-grant` twin's build is kept out by memory 0.

## Kept as they are

`3238/inherited.test.mjs` holds one test, so `inherited.test.mjs` here holds the whole file. Its header comment and its inline comments are not carried; test files here have no comments. `admitted`, `cli`, `design`, `no-grant`, `serial` and `hub.test.ts`, `twins.json` with the twins, and `3238-redraft-3549/` are not in this redraft's brief. They are not reviewed or run here. `3238/lane.json` says the folder runs alone because `hub.test.ts` starts a hub from the checkout's `target/`. The test here starts no hub and no binary, so there is no lane file here.

No twins here: `tests/acceptance/3238/twins.json` maps #3238.664c776d to `own-test-grant` and `own-grant`, and the redraft keeps the ID.

## Runs

Each file ran once per program with `node --test --test-reporter=spec <file>`, with no throttle grant, as the owner asked for today. Each run's `throttle.mjs` processes used the test's own table (`DEEP_THROTTLE_TABLE` in its sandbox), never the machine's. Before each file the runner read `~/.deepbuild/throttle/table.json`: no `timed` grant was held at any start, so none was waited for. The machine is macOS on 18 cores with node 24.22.2. The base run and the throwaway run went at the same time, one file after another on each side, in two streams. Load is the 1-minute load at each run's start and end; the machine was far above its cores throughout.

- **Base**: this checkout at `894a293f2`, the redraft files uncommitted on it.
- **Throwaway #3694**: `git archive 894a293f2` unpacked in a scratch folder outside the worktree (no `.git`), with the redraft folders copied in. Its `scripts/throttle.mjs` differs from the base's in five lines, which do four things. (1) `grantable()` admits every test request in the table by `roomForTest(slots, seen, now, true)`, without the load. (2) A test grant that isn't a run's is marked `plain`, gets `used: 0`, and asks for its turn in the same write, as an admitted build does. (3) Its turn counts it as a run, so its turn isn't released as orphaned. (4) Its own turn is no job's, as a build's is: a request under it passes through, and a run asked there is admitted, nested. Nothing else changed. It is a guess, never committed, and is deleted after this job.

| File | Program | UTC start | UTC end | Load start → end | Result |
|---|---|---|---|---|---|
| `3238-redraft-3694/inherited.test.mjs` | base | 2026-11-27T14:57:14Z | 2026-11-27T14:57:16Z | 86.2 → 92.0 | 1 pass, 0 fail, exit 0 |
| `3238-redraft-3694/inherited.test.mjs` | throwaway #3694 | 2026-11-27T14:57:18Z | 2026-11-27T14:57:20Z | 92.0 → 92.3 | 1 pass, 0 fail, exit 0 |

Every redraft test passed on both programs.

To show the throwaway is a program on which the old scenes fail, each original file was also run once on the throwaway, with `--test-name-pattern` naming only its listed tests. Each failed at its scene, as the brief predicts:

| Original file (listed tests only) | UTC start | UTC end | Load start → end | Result | Failed at |
|---|---|---|---|---|---|
| `3238/inherited.test.mjs` | 2026-11-27T14:59:04Z | 2026-11-27T15:02:05Z | 83.2 → 109.7 | 0 pass, 1 fail | "the job `node stub.mjs repo-rules-lint` didn't start at once under its run's test grant: nothing happened in 3 min" |

No planted twin was run against the redraft files, and no other test file was run; `scripts/repo-rules.mjs` ran before the commit and passed. Run records here write the sandbox and home folders as `<sandbox>` and `~`; the raw outputs stayed in the scratch folder and are not committed.
