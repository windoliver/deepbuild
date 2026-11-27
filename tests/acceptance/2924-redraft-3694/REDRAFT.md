# Blind redraft of #2924's test-grant, BLOCKED and log tests under #3694

#3694 changes what `scripts/throttle.mjs` does with a plain test request: a `test` request from a chain under no grant that isn't an `affected.mjs` run's (`throttle.mjs test -- <cmd>`). Today a second one beside a held test grant needs the readings' load under their cores as well as the memory rule. Under #3694 it is admitted as a run is, by the test ceiling, the memory rule and a pending timed request's drain, without the load. Then it takes a turn on the pool as a run of one job, as #3549 made builds do, so its command starts only once it holds a pool token. On a test's own table the pool is the readings' cores less one, at least one. Four of #2924's tests set their scene on a second plain request waiting on the load. On a right program for #3694 that request is granted, so those tests fail. This folder redrafts them from #2924's criteria (AC2, AC3, AC5, AC6), #3694's body and the base `894a293f2`.

The originals are not edited or deleted; a person approves the swap. Run with:

```
node --test tests/acceptance/2924-redraft-3694/test-grants.test.mjs
node --test tests/acceptance/2924-redraft-3694/blocked.test.mjs
node --test tests/acceptance/2924-redraft-3694/log.test.mjs
```

Each file imports `tests/acceptance/2924/helpers.mjs` unchanged. There are no helpers of this folder's own.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `2924/test-grants.test.mjs` › #2924.AC2 with one test grant held, a second request waits while the readings show load equal to the cores | #2924.AC2, its load clause | It reads load 8 on 8 cores with 1024 GiB. Under #3694 a plain second request doesn't read the load, and the pool has 7 tokens, so the request is granted at once and its command starts | `test-grants.test.mjs` › same name. The only change is the readings: load 1 on 1 core, still load equal to the cores. On the base the second request waits on the load, as before. Under #3694 it waits because the pool has one token and the holder's command holds it. **The criterion's own words can't hold under #3694**; see below |
| `2924/test-grants.test.mjs` › #2924.AC3 a request waiting on load is granted without a restart once its readings file is rewritten to allow it | #2924.AC3, its load clause | It waits on load 100 on 8 cores. Under #3694 it doesn't wait at all | `test-grants.test.mjs` › same name. It now waits on load 100 on 1 core, and the file is rewritten to load 1 on 8 cores. On the base the rewrite ends the wait on the load; under #3694 it ends the wait for a token, since the pool grows to 7. The waits, the rewrite, the assertions and the expected values are the original's. **The criterion's own words can't hold under #3694**; see below |
| `2924/blocked.test.mjs` › #2924.AC5 a readings file rewritten to not-JSON while a request waits is BLOCKED throttle at the next read, exit 2 | #2924.AC5, "whenever it is read" | It waits on load 100 on 8 cores. Under #3694 it is granted at once, so it never reads the rewritten file while waiting | `blocked.test.mjs` › same name. The request waits on memory instead: readings of 0 bytes, load 1 on 8 cores. On both programs a second test grant needs memory for a run, and the first is granted whatever the readings. The rewrite to `not json`, the 15 s bound, the BLOCKED line, the variable's name and exit 2 are the original's |
| `2924/log.test.mjs` › #2924.AC6 each test grant's granted entry carries the readings it was decided on, the rewritten ones for a request that waited | #2924.AC6 | The second request waits on load 9 on 8 cores; under #3694 it is granted at once on those readings | `log.test.mjs` › same name. The second request's first readings are `{ memory: 0, load: 2.5, cores: 8 }`: it waits on memory on both programs. The holder's readings, the `allowing` readings the second is granted on and both `deepEqual`s are the original's |

### Where #2924's words can't hold under #3694

#2924 AC2 says a second test request waits while the readings show load equal to the cores. AC3 says a request waiting on load is granted once its readings are rewritten. For a plain test request, #3694 supersedes both clauses: such a request "is admitted as a run is (memory, ceiling, a pending timed request's drain), without the load". So under #3694 no test request under no grant waits on the readings' load. #3221 had already done this for a run's request. The two tests keep their titles, expected values ("waits", then "granted without a restart, the holder still running") and assertions. The new scenes hold on both programs, but on #3694 they pass for a different reason. They make the request wait on a pool of one token, which the holder's turn takes, not on the load. Under #3694 they no longer prove the load clause, which is gone. They prove the pool clause instead.

The swap needs the owner's ruling. The owner can (a) take these two tests as they are, (b) drop them, or (c) strike the load clauses from #2924 AC2 and AC3. #3694's criteria now cover the clauses. AC1 (load 57 on 18 cores, a planted `roomForTest()` that still reads the load for a plain request fails) covers the second request being granted whatever the load. AC2 (the command doesn't start until a token is free) covers the wait these scenes now show on #3694. This redraft invents no expected value for them.

## Kept as they are

Carried unchanged into the files here, because the swap is by file and each file holds the original's tests in the original's order:

- `test-grants.test.mjs`: AC1 (no grant held, granted at once under load 50 on 4 cores and 0 bytes), AC2's two memory cases (16 GiB less one byte waits, exactly 16 GiB is granted; 48 GiB on Linux), and AC3's memory case.
- `blocked.test.mjs`: the five malformed-file cases, and the two machine-table cases, which need bwrap and are skipped `INCONCLUSIVE` without it, as in the original.
- `log.test.mjs`: AC6 without `DEEP_THROTTLE_READINGS` (readings `null`).

Their names, scenes, waits, assertions and expected values are the original's, line for line. Under #3694 each still holds: none has a second plain request wait on load, and each holder's readings leave the pool a token for its turn. The original files' header comments and JSDoc lines are not carried; test files here have no comments. `ceiling.test.mjs`, `other-classes.test.mjs` and `design.test.mjs` are not in this redraft's brief. They are not reviewed or run here.

## Runs

Each file ran once per program with `node --test --test-reporter=spec <file>`, with no throttle grant, as the owner asked for today. Each run's `throttle.mjs` processes used the test's own table (`DEEP_THROTTLE_TABLE` in its sandbox), never the machine's. Before each file the runner read `~/.deepbuild/throttle/table.json`: no `timed` grant was held at any start, so none was waited for. The machine is macOS on 18 cores with node 24.22.2. The base run and the throwaway run went at the same time, one file after another on each side, in two streams. Load is the 1-minute load at each run's start and end; the machine was far above its cores throughout.

- **Base**: this checkout at `894a293f2`, the redraft files uncommitted on it.
- **Throwaway #3694**: `git archive 894a293f2` unpacked in a scratch folder outside the worktree (no `.git`), with the redraft folders copied in. Its `scripts/throttle.mjs` differs from the base's in five lines, which do four things. (1) `grantable()` admits every test request in the table by `roomForTest(slots, seen, now, true)`, without the load. (2) A test grant that isn't a run's is marked `plain`, gets `used: 0`, and asks for its turn in the same write, as an admitted build does. (3) Its turn counts it as a run, so its turn isn't released as orphaned. (4) Its own turn is no job's, as a build's is: a request under it passes through, and a run asked there is admitted, nested. Nothing else changed. It is a guess, never committed, and is deleted after this job.

| File | Program | UTC start | UTC end | Load start → end | Result |
|---|---|---|---|---|---|
| `2924-redraft-3694/test-grants.test.mjs` | base | 2026-11-27T14:56:19Z | 2026-11-27T14:56:54Z | 86.2 → 79.0 | 6 pass, 0 fail, exit 0 |
| `2924-redraft-3694/blocked.test.mjs` | base | 2026-11-27T14:56:54Z | 2026-11-27T14:57:05Z | 79.0 → 86.9 | 6 pass, 0 fail, 2 skipped (bwrap absent), exit 0 |
| `2924-redraft-3694/log.test.mjs` | base | 2026-11-27T14:57:05Z | 2026-11-27T14:57:14Z | 86.9 → 86.2 | 2 pass, 0 fail, exit 0 |
| `2924-redraft-3694/test-grants.test.mjs` | throwaway #3694 | 2026-11-27T14:56:22Z | 2026-11-27T14:56:58Z | 84.6 → 81.3 | 6 pass, 0 fail, exit 0 |
| `2924-redraft-3694/blocked.test.mjs` | throwaway #3694 | 2026-11-27T14:56:58Z | 2026-11-27T14:57:09Z | 81.3 → 86.9 | 6 pass, 0 fail, 2 skipped (bwrap absent), exit 0 |
| `2924-redraft-3694/log.test.mjs` | throwaway #3694 | 2026-11-27T14:57:09Z | 2026-11-27T14:57:18Z | 86.9 → 92.0 | 2 pass, 0 fail, exit 0 |

Every redraft test passed on both programs.

To show the throwaway is a program on which the old scenes fail, each original file was also run once on the throwaway, with `--test-name-pattern` naming only its listed tests. Each failed at its scene, as the brief predicts:

| Original file (listed tests only) | UTC start | UTC end | Load start → end | Result | Failed at |
|---|---|---|---|---|---|
| `2924/test-grants.test.mjs` | 2026-11-27T14:58:30Z | 2026-11-27T14:58:47Z | 85.4 → 84.8 | 0 pass, 2 fail | both: "second's command started while the readings show load 8 on 8 cores" / "… load 100 on 8 cores" |
| `2924/blocked.test.mjs` | 2026-11-27T14:58:47Z | 2026-11-27T14:58:56Z | 84.8 → 81.2 | 0 pass, 1 fail | "second's command started while the readings show load 100 on 8 cores" |
| `2924/log.test.mjs` | 2026-11-27T14:58:56Z | 2026-11-27T14:59:04Z | 81.2 → 83.2 | 0 pass, 1 fail | "second's command started while the readings show load 9 on 8 cores" |

No planted twin was run against the redraft files, and no other test file was run; `scripts/repo-rules.mjs` ran before the commit and passed. Run records here write the sandbox and home folders as `<sandbox>` and `~`; the raw outputs stayed in the scratch folder and are not committed.
