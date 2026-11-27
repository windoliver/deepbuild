# Blind redraft of #3549's pass-through, drain and window tests under #3694

#3694 changes what `scripts/throttle.mjs` does with a plain test request: a `test` request from a chain under no grant that isn't an `affected.mjs` run's. Under #3694 it is admitted as a run is, then takes a turn on the machine's pool of job tokens as a run of one job, as #3549 made builds do. Its command starts only once it holds a token. On a test's own table the pool is the readings' cores less one, at least one. Four of #3549's tests count the pool's tokens with plain test grants in the scene that took no token, as on the base. Under #3694 each such grant takes one, so the count no longer adds up. Either the plain grant's command never starts, or a build stays admitted and waiting where the test expects it refused. This folder redrafts the four from #3549's criteria (#3549.c607aa63, #3549.7ba8246d), #3694's body and the base `894a293f2`.

The originals are not edited or deleted; a person approves the swap. Run with:

```
node --test tests/acceptance/3549-redraft-3694/passes.test.mjs
node --test tests/acceptance/3549-redraft-3694/timed.test.mjs
node --test tests/acceptance/3549-redraft-3694/window.test.mjs
```

Each file imports `tests/acceptance/3549/helpers.mjs` unchanged. `helpers.mjs` here holds `turnsOf(box, ...names)`, the number of `turn` entries in the table's log whose `run` is the grant the named stubs' `DEEP_THROTTLE` names. Section 6 states that log line: `turn` when a token is dealt, naming its run's grant as `run`, for builds as for runs. #3694 AC4 asks that the log name a plain request's turn as it names an admitted build's. `turnsOf` is 0 for a plain test grant on the base and 1 under #3694. The redraft assumes #3694 writes the same `turn` line for a plain request's turn as for a build's. If #3694 named the turn only on the `granted` line, `turnsOf` would read 0 there and these scenes would leave one token too few.

## How the scenes are kept

Each redrafted test needs every token of the pool held at one point: by builds alone on the base, and by those builds and the plain test grants under #3694. A fixed `cores` can't give both, since the plain grants take tokens on one program and not on the other. So each test starts with a pool large enough for every grant in it to get its token. Once the plain test grants' commands have started, it rewrites the readings (`readings(box, …)`, whole, by rename; read again at each look, #2924 AC3) to the cores that leave the original's count of tokens for builds: the original's cores plus `turnsOf` the plain grants. On the base that is the original's own readings, so the scene is the original's from that point on. Under #3694 it is the same scene, with one more token for each plain grant's turn.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `3549/passes.test.mjs` › #3549.c607aa63 with every build slot and every token of the pool held, a build request under a build grant of the caller and one under a test grant of the caller start at once on that grant, with no grant, turn or jobserver of their own | #3549.c607aa63 | Cores `CEILING + 1` give `CEILING` tokens. Under #3694 the test caller, a plain test grant, takes one. Builds are then admitted up to the ceiling, but the last waits for a turn instead of being refused, so the loop finds no refused build: "no build request was refused" | `passes.test.mjs` › same name. It starts with cores `CEILING + 2`. Once both callers' commands run, the readings are rewritten to cores `CEILING + 1 + turnsOf(test-caller)`. On the base that is `CEILING` tokens, all taken by the `CEILING` builds. Under #3694 it is `CEILING + 1`, taken by those builds and the test caller's turn. Either way every build slot and every token is held when the inner requests ask, and the next build is refused by the ceiling. The callers, the loop, the inner requests and every assertion and expected value are the original's |
| `3549/timed.test.mjs` › #3549.7ba8246d with a timed request pending no turn is dealt: an admitted build that waits for the one token of the pool is not given it when it frees, and starts once the timed request is over | #3549.7ba8246d | Cores 2 give one token, and the build `holds-the-token` takes it. Under #3694 the scene's two plain test grants (`chain`, which asks for timed, and `blocker`, which it waits on) wait for a token, so their commands never start | `timed.test.mjs` › same name. It starts with cores 4 (3 tokens). Once the three commands run, the readings are rewritten to cores `2 + turnsOf(chain, blocker)`. On the base that is the original's 2: one token, held by the build. Under #3694 it is 4: three tokens, held by the build and the two test grants' turns. Either way the build `waits-its-turn` waits for the token `holds-the-token` frees. The probes, the drain, the three refusals, the order of starts and every assertion and expected value are the original's |
| `3549/window.test.mjs` › #3549.7ba8246d a window opens only once every admitted build has ended: one that waited for its turn when the window asked is dealt the token, runs and ends first | #3549.7ba8246d | Cores 2, one token, held by the build. Under #3694 the plain test grant `chain`, which asks for the window, waits for a token, so its command never starts | `window.test.mjs` › same name. It starts with cores 3. Once both commands run, the readings are rewritten to cores `2 + turnsOf(chain)`: the original's 2 on the base, 3 under #3694, every token held by the build and `chain`. The rest is the original's |
| `3549/window.test.mjs` › #3549.7ba8246d a window does not open while an admitted build still waits for its turn: asked under the build that holds the one token of the pool, its request runs out its wait | #3549.7ba8246d | Cores 2 and load 1000, one token held by the build. Under #3694 the plain test grant `test-holder` waits for a token and never starts. Its witness, a second plain test request that was to wait out its 0.1 min "kept out by the load", is admitted under #3694 and waits for a turn with no limit, so it is never refused | `window.test.mjs` › same name. It starts with cores 3 and load 1000. Once both commands run, the readings are rewritten to cores `2 + turnsOf(test-holder)`. The witness is given a readings file of its own, `{ memory: 0, load: 1000, cores: 2 }`, so it is kept out by memory on both programs and runs out its 0.1 min. Before `test-holder` is let end, the readings are rewritten to cores 2: the original's on the base, and under #3694 a pool of one token, still held by the build. So the token `test-holder`'s turn gives back doesn't go to `waits-its-turn`. The witness's failure message says "on readings with no memory for a second run" where it said "at a load above the cores"; every assertion and expected value is the original's |

## Kept as they are

Carried unchanged into the files here, because the swap is by file and each file holds the original's tests in the original's order:

- `passes.test.mjs`: #3549.c607aa63 inside an admitted run whose job holds the one token of the pool, a command scripts/lease runs starts at once with no turn, while a build request of the run waits for its turn. Its run is an `affected.mjs` run (`DEEP_THROTTLE_RUN=0`), not a plain request, so #3694 changes nothing in it.
- `timed.test.mjs`: #3549.7ba8246d with a timed request pending no build is admitted, … Cores 5 give 4 tokens, enough for its two plain test grants' turns and the builds after them.
- `window.test.mjs`: #3549.7ba8246d a window opens only once an admitted build that is under way has ended. Cores 5, enough for the build and `chain`.

Their names, scenes, waits, assertions and expected values are the original's, line for line. The original files' header comments, JSDoc lines and inline comments are not carried; test files here have no comments. `admission`, `compiles`, `design`, `log` and `turn` and `twins.json` with the twins are not in this redraft's brief. They are not reviewed or run here.

No twins here: `tests/acceptance/3549/twins.json` maps #3549.c607aa63 to `turn-under-a-build` and #3549.7ba8246d to `deals-turns-in-a-drain`, and the files keep both IDs.

## Runs

Each file ran once per program with `node --test --test-reporter=spec <file>`, with no throttle grant, as the owner asked for today. Each run's `throttle.mjs` processes used the test's own table (`DEEP_THROTTLE_TABLE` in its sandbox), never the machine's. Before each file the runner read `~/.deepbuild/throttle/table.json`: no `timed` grant was held at any start, so none was waited for. The machine is macOS on 18 cores with node 24.22.2. The base run and the throwaway run went at the same time, one file after another on each side, in two streams. Load is the 1-minute load at each run's start and end; the machine was far above its cores throughout.

- **Base**: this checkout at `894a293f2`, the redraft files uncommitted on it.
- **Throwaway #3694**: `git archive 894a293f2` unpacked in a scratch folder outside the worktree (no `.git`), with the redraft folders copied in. Its `scripts/throttle.mjs` differs from the base's in five lines, which do four things. (1) `grantable()` admits every test request in the table by `roomForTest(slots, seen, now, true)`, without the load. (2) A test grant that isn't a run's is marked `plain`, gets `used: 0`, and asks for its turn in the same write, as an admitted build does. (3) Its turn counts it as a run, so its turn isn't released as orphaned. (4) Its own turn is no job's, as a build's is: a request under it passes through, and a run asked there is admitted, nested. Nothing else changed. It is a guess, never committed, and is deleted after this job.

| File | Program | UTC start | UTC end | Load start → end | Result |
|---|---|---|---|---|---|
| `3549-redraft-3694/passes.test.mjs` | base | 2026-11-27T14:57:16Z | 2026-11-27T14:57:22Z | 92.0 → 92.3 | 2 pass, 0 fail, exit 0 |
| `3549-redraft-3694/timed.test.mjs` | base | 2026-11-27T14:57:22Z | 2026-11-27T14:57:27Z | 92.3 → 96.9 | 2 pass, 0 fail, exit 0 |
| `3549-redraft-3694/window.test.mjs` | base | 2026-11-27T14:57:27Z | 2026-11-27T14:57:50Z | 96.9 → 95.9 | 3 pass, 0 fail, exit 0 |
| `3549-redraft-3694/passes.test.mjs` | throwaway #3694 | 2026-11-27T14:57:20Z | 2026-11-27T14:57:25Z | 92.3 → 96.9 | 2 pass, 0 fail, exit 0 |
| `3549-redraft-3694/timed.test.mjs` | throwaway #3694 | 2026-11-27T14:57:25Z | 2026-11-27T14:57:33Z | 96.9 → 96.6 | 2 pass, 0 fail, exit 0 |
| `3549-redraft-3694/window.test.mjs` | throwaway #3694 | 2026-11-27T14:57:33Z | 2026-11-27T14:57:57Z | 96.6 → 93.2 | 3 pass, 0 fail, exit 0 |

Every redraft test passed on both programs.

To show the throwaway is a program on which the old scenes fail, each original file was also run once on the throwaway, with `--test-name-pattern` naming only its listed tests. Each failed at its scene, as the brief predicts:

| Original file (listed tests only) | UTC start | UTC end | Load start → end | Result | Failed at |
|---|---|---|---|---|---|
| `3549/passes.test.mjs` | 2026-11-27T15:02:05Z | 2026-11-27T15:04:07Z | 109.7 → 95.9 | 0 pass, 1 fail | "no build request was refused: 3 builds are held at once on a table whose ceiling is 4" |
| `3549/timed.test.mjs` | 2026-11-27T15:04:07Z | 2026-11-27T15:06:08Z | 95.9 → 81.4 | 0 pass, 1 fail | "the build that holds the pool's token, or one of the two test grants' commands, never started" |
| `3549/window.test.mjs` | 2026-11-27T15:06:08Z | 2026-11-27T15:10:09Z | 81.4 → 81.2 | 0 pass, 2 fail | "the build that holds the pool's token, or the test grant's command, never started" and "… or the test grant's holder, never started" |

No planted twin was run against the redraft files, and no other test file was run; `scripts/repo-rules.mjs` ran before the commit and passed. Run records here write the sandbox and home folders as `<sandbox>` and `~`; the raw outputs stayed in the scratch folder and are not committed.
