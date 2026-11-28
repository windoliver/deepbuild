# Blind redraft of #1113's measured tests under #3296/#3297

Since #3296/#3297 (`efddeb94d`), `scripts/preflight.mjs` in a git tree runs a fill before it asks for `timed`: the unit lane of `scripts/lanes.mjs` (`runLanes` of `checks` named `unit`, with `fill: true`), each job kept by tree in `~/.deepbuild/preflight/<tree>.jsonl` (`scripts/proof-kept.mjs`). Then `unrunOf` lists every unit-lane test file (Vitest's own `vitest list --filesOnly --json` through `commandFiles` in `scripts/proof-binaries.mjs`, the node `--test` globs, and `cargo test` as a job of its own) and, if any has no kept result, the preflight ends `INCONCLUSIVE preflight` without timing anything. Only then does it take `timed` and start its timer.

`tests/acceptance/1113/measured.test.mjs` builds its scratch repository with no `node_modules` (no Vitest, no `typescript`) and with `npm`/`cargo` stubs that print nothing. On the base its fill can't list or keep anything, so a preflight there never reaches its checks: the product honouring invariant 2, not a fault the test is about. The original can't pass on a right program. This folder redrafts its three tests from #1113's criteria (AC7 and AC9), the design and the base `0dbd16ef7`.

The original is not edited or deleted; a person approves the swap. Run with:

```
node --test --test-timeout 900000 tests/acceptance/1113-redraft-3296/measured.test.mjs
```

It imports `tests/acceptance/1113/helpers.mjs` unchanged (`sandbox`, `launch`, `hold`, `started`, `event`, `dump`, `preflightSeconds`, and `measuredRepo` with its stub `scripts/checks.mjs`, its `npm` stub and its untracked `benchmarks/budgets.json`). `helpers.mjs` here holds the rest:

- `filledRepo(box)`: `measuredRepo(box)`, plus what lets its fill find and keep a result for every unit-lane test file, committed into the one commit `origin/main` names:
  - a `vitest.config.mjs` that includes `tests/**/*.test.ts` and keeps Vite's cache outside the repository (`../vite-cache`), so a run never changes the tree it keeps results for;
  - three one-test files, one for each test command of the lane: `tests/unit-stand-in.test.ts` (the parallel Vitest block), `tests/dither-fill.test.ts` (the alone block, run by `scripts/affected.mjs --alone`; the name is a file entry of `alone` in `scripts/lanes-lists.mjs`, so the block isn't empty), and `tests/node-stand-in.test.mjs` (the `node --test` command);
  - `node_modules`, a link to this checkout's, kept out of git by `.git/info/exclude`;
  - a `cargo` stub in place of the original's: `cargo metadata` prints a workspace with no packages, `cargo test … -- --list` lists one test, `cargo test` prints libtest's output of one passing test, and anything else exits 0 as before.
- `filled(child)`: resolves `true` once the preflight's output holds the unit lane's verdict line (`PASS unit`, or `FAIL`/`INVALID`/`BLOCKED`/`INCONCLUSIVE unit`), the fill's end; `false` if the preflight closes first.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `1113/measured.test.mjs` › #1113.74ef5038 a preflight that requests timed while another session holds a bay pair waits until the pair is released, then completes, and its perf child is not BLOCKED | #1113.74ef5038 (AC7) | The fill can't list its files (`typescript` missing) and crashes on the `cargo` stub's empty `cargo metadata`; the preflight never asks for `timed` and never runs its checks. With a fill that works, the 3 s bay-pair hold started before the preflight would end during the fill, before `timed` is asked, so the test would no longer show a `timed` request waiting on the pair | `measured.test.mjs` › same name. `filledRepo` in place of `measuredRepo`; the preflight starts first, and the bay-pair holder (`--wait 1`, 3 s) starts once `filled` says the fill ended, so the pair is held when `timed` is asked. Assertions, SLACK and expected values are the original's |
| `1113/measured.test.mjs` › #1113.74ef5038 a perf run started by hand that requests timed while another session holds a bay pair waits until the pair is released, then completes | #1113.74ef5038 (AC7) | Perf has no fill; nothing in its scene changed. It is here because the swap is by file | `measured.test.mjs` › same name. Only `filledRepo` in place of `measuredRepo`; the scene, order, hold, assertions and values are the original's |
| `1113/measured.test.mjs` › #1113.dadec762 a preflight run's measured time contains no throttle wait: the grant precedes the timer | #1113.dadec762 (AC9) | As the first: no checks, no `Checks elapsed` line. And a 3 s build holder started before the preflight would end during the fill, so `timed` would not wait on it, and a timer started before the grant would hold no wait | `measured.test.mjs` › same name. `filledRepo`; the build holder (`--wait 1`, 3 s) starts once the fill ended. The bound `afterGrant = (ended − released)/1000 + 0.3` and both assertions are the original's |

One thing no line shows: in the two preflight tests the holder now starts after the preflight, not before it. "Requests timed while another session holds a bay pair" is the criterion's scene; the fill (tens of seconds here, under load longer) comes before the request, so a holder started first would no longer be holding then. The window between the fill's verdict line and the `timed` request is `unrunOf`'s two `vitest list` runs, over a second, against the holder's start of a few hundred ms. A holder that starts too late fails the test at its assertions (checks before the release, or a preflight that ends before it), never passes it.

## Kept as they are

- The three tests' names (with `#1113.74ef5038` and `#1113.dadec762` literally in them), their order, the holders' classes, waits and 3 s holds, `SLACK = 100`, `OBSERVED`, every assertion and every expected value.
- `tests/acceptance/1113/` whole, its helpers, its twins and `twins.json`.

## Twins

`twins.json` maps each tagged ID to a planted wrong program, kept as lines (`lines.json`):

| Criterion | Twin | What it plants |
|---|---|---|
| `#1113.74ef5038` | `never-asks-timed` | `scripts/preflight.mjs` runs its work with no `timed` grant, and `scripts/perf.mjs` asks for none |
| `#1113.dadec762` | `timer-before-grant` | `scripts/preflight.mjs` notes the time before it asks for `timed` and its work's timer starts from then, so the wait for the grant is in the measured time |

`lane.json` says how the folder runs: alone, as its tests time a whole preflight and read waits to 100 ms.

## Runs

On macOS, 12 cores, node 24.22.0, base `0dbd16ef7`, `node --test --test-timeout 900000 <file>`. A top-level `timed` grant waits for a 1-minute load under 12 (criterion a4cc0a86); the load never fell under 36 while these ran, so no `timed` grant came, and every test that needs one ran into its 15-minute cap. Testing was bounded at one hour; what was still running then was stopped by PID.

| Run | Program | Load (1-min) | Result |
|---|---|---|---|
| `1113-redraft-3296/measured.test.mjs` | the base | 36–76 (00:36:56–01:07:26Z) | `INCONCLUSIVE`. Each fill passed (`PASS unit`), `unrunOf` found nothing unrun, and each preflight then waited for `timed` with the holder in place: test 1 and test 2 `test timed out after 900000ms` waiting for `timed`; test 3 reached the same wait (`PASS unit (12.50 s)`, the neighbour held and released) and was stopped at the bound (`exit null (SIGTERM)`). None of the three reached an assertion of its own |
| the same file | twin `never-asks-timed` | 37–39 (00:36:56–00:37:26Z) | All three fail at assertions: "the preflight's checks started 1473 ms before the bay pair was released", "perf ended 2536 ms before the bay pair was released", and for #1113.dadec762 "the preflight ended before the build holder outside its chain did: it never waited for timed" |
| the same file | twin `timer-before-grant` | 36–76 (00:36:56–01:07:26Z) | `INCONCLUSIVE`, as on the base: tests 1 and 2 timed out waiting for `timed`; test 3 was stopped at the bound while waiting for `timed`, so #1113.dadec762's twin is not yet shown failing |
| `1113/measured.test.mjs` (the original) | the base | 48–77 (00:10:22–00:25:33Z) | Test 1 fails: "the preflight never ran its checks" (the fill's `NOTE unit: its files can't be listed … Cannot find package 'typescript'`, then a `SyntaxError: Unexpected end of JSON input` at `libtestTargets`, `scripts/lanes.mjs:739`, on the empty `cargo metadata` of the stub, and `ERR_MODULE_NOT_FOUND` for `typescript` from the preflight itself). Test 2 timed out waiting for `timed`. Test 3 fails: no `Checks elapsed` line, the same fill crash |

The redraft is unproven on the base and #1113.dadec762's twin is unshown: both need a run at a load under 12. Earlier attempts of the redraft runs were stopped and are kept beside the outputs: the first ones awaited the preflight's end inside the fill assertion's message (a fault of this folder's test, fixed before the runs above), and the twin `never-asks-timed`'s first run came from that version too.
