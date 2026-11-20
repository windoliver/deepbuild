# #1868 acceptance: the canvas world reads what the record holds now

This folder was written first and blind, before any implementation. It covers criterion 2 of issue #1868 only.
Criteria 1 and 3, the timing ones, are left to their own job. The inputs were the issue, `docs/technical-design.md`
and the base commit `9d0256132` (origin/main, "Merge pull request #2836"), which has no implementation of #1868. The
criterion:

> A reading recorded after the world was built shows in the next deep_show's world, and an ask answered since shows
> as done. A planted world built once at start reads the old values and fails this test, naming the reading.

Its ID is `#1868.a903f1c6`: `#1868.` followed by the first 8 hex digits of the SHA-256 of the whitespace-normalised
text (`criterionId` in `scripts/budget-window.mjs`). The describe and the it both carry the ID literally, because the
trace lane reads test names statically.

## Run

From the repo root, with the workspaces built (`npm run build --workspaces`), `target/debug/deep-hook` and
`target/debug/deep-show` built, and Node 24:

```sh
npx vitest run tests/acceptance/1868/ --no-file-parallelism
npx tsc -p tests/acceptance/1868/tsconfig.json --noEmit
```

The file takes about 25 s on an M3 Mac (`Mac15,12`) at a load average of 7-10. It starts one real hub and three
sessions' `deep mcp`/deep-hook processes.

## Requirement, check, proof

| Requirement | Check (`world.test.ts`) | Proof it can fail |
|---|---|---|
| A reading recorded after the world was built shows in the next deep_show's world | The board session's first deep_show is presented, and deep_query reads the open ask as `needs_you`. That builds the world. Then two worker sessions' claims share a check, and the hub records the carry's readings (`reading.recorded`, log_pos after the world was built). The next deep_show binds a count's text to one of those readings, and it must be presented with no `ref_unresolved`. deep_query must then read that revision with nothing unresolved. | Under the planted program `canvas-world-built-once`, the world the canvas core reads has no such reading. deep_show refuses the board with `ref_unresolved` naming the handle, and the test fails at this assertion: `the reading reading:<ULID> (value 1 runs, "runs saved by carrying across sessions · …"), recorded at log_pos N after the world was built at log_pos M, must show in the next deep_show's world; deep_show said {…"code":"ref_unresolved"…"reading:<ULID>"…}` |
| An ask answered since shows as done | The open ask is answered through the hub (`ask.answer` on a `cli` connection). The next deep_show of a status mark bound to it must read exactly as the same board bound to the ask answered before the hub started. | Under the plant, the ask still reads open (`presented`, `needs_you`). The test fails with `… must show as done in the next deep_show, as ask:<id> (answered before the start) does; it still reads as it did open`. The reading assertion comes first, so on the plant the failure names the reading, as the criterion asks. |

## Fixtures

All of these are built fresh for each run under `/tmp/dh1868-*`, and `cleanup` removes them. Every process the test
starts is stopped by PID.

- **Home.** #29's layout (`tests/acceptance/29/h-d.ts`):
  - `.deepbuild/rules.json` holds the shipped default guards, and `config.json` your ask settings.
  - A confirmation file holding `confirmed`.
  - `DEEP_HUB_TEST_DRAFTS` holds the definition both worker prompts lock: one requirement, "The release gate passes",
    with the check `.deepbuild/checks/release-gate.sh`.
  - `DEEP_HUB_TEST_WORK` holds an empty readings list.
- **Repo.** #31's seeded sample, plus `src/release.json` and the check. The check runs
  `node -e "JSON.parse(require('node:fs').readFileSync('src/release.json','utf8'))"`. It reads a repo file other than
  its own script because a run that reads only its own check file never carries (#1018). Two worktrees,
  `worker-1` and `worker-2`, are cut from the one commit.
- **Asks.** Two `taste` asks of the board session are seeded through the real record and asks core before the hub
  starts (`t26.seed`): "Which header colour …" stays open, and "Which font …" is answered with `green`.
- **World file.** `DEEP_HUB_TEST_SHOW` names the board session ("Claude Code: release numbers") and #393's panels. It
  also names two documents: `01JB7D…1` for the ask boards and `01JB7D…2` for the reading board. Each board gets its
  own document so that one board's revision never leaves out the other board's items.
- **Sessions.**
  - The board session is #806's Claude Code stand-in in its own repo, calling deep_show and deep_query through its
    own `deep mcp`.
  - The two worker sessions are #1018's: prompt, then writes of the same `src/cart.ts`, then stop. The first claim runs
    the check. The second claim reads that run as carried, and the hub records "runs saved by carrying across
    sessions" and "slot time saved …" readings under ULID handles, with no session (the core's).
- **Boards** (#393's `refs.test.ts` shapes):
  - a status mark `items/state/params/paint/fill` bound to an ask through `status_bindings`
  - a `text@1` count `items/value/params/text` bound to a reading through `bound_values`

## The planted program

| Name | Twin | What it does wrong | How the test fails |
|---|---|---|---|
| `canvas-world-built-once` | `twins/world-built-once/packages/hub/src/plant.ts` (`twins.json`: `#1868.a903f1c6`) | The hub builds the world the canvas core reads once, at start or at its first canvas call. Every later deep_show and deep_query reads that same world. | `ref_unresolved` naming `reading:<ULID>`, at the reading assertion (see the table above) |

The twin is the base's `packages/hub/src/plant.ts` copied whole, with these changes:

- the plant's name added to `Plant` and `PLANTS`
- `plantOf` and `activePlant` return the plant whatever `DEEP_HUB_PLANT` says
- a header saying what it is

Every other export is kept as the base has it. Here the twin keeps the base's `Plant` union rather than widening it
to `string` the way #2646's twin did. On this base, a `Plant = string` twin does not build:
`packages/hub/src/core.ts:898` passes `this.options.plant`, narrowed by comparisons, to the extension host's own
`Plant` union, and `string` doesn't narrow there (TS2379). With the union kept, any comparison the implementation
makes with `'canvas-world-built-once'` still type-checks.

## On the unchanged base

The test passes on the base, and the twin builds there and passes too (`BASE-FAILURE.txt`, both runs, the builds'
exit codes 0). That is expected:

- `canvasWorld()` in `packages/hub/src/hub-canvas.ts` rebuilds the world from the record on every canvas call, so the
  base already meets this criterion. The issue's concern is the cost of that rebuild (criteria 1 and 3).
- The base has no plant `canvas-world-built-once`, so laying the twin over it adds a name that nothing reads.

So the base can't show the twin failing. The wrong program fails only against an implementation that builds the world
once and reads the plant. Until one exists, the proof lane's twin leg can't be run.

## Not named by the issue, so assumed

- **Which reading.** The issue says only "a reading recorded". The test uses a reading the hub records while it runs
  (#1018's carried-check readings), because those are the only ones it could find that have a ULID handle the canvas
  accepts. The lifecycle readings `numbers.refresh` writes have handles like `reading:fixtureowner…`, which deep_show
  refuses as `bad_handle`. A reading seeded before the hub started would be in a world built once at start, so it
  couldn't tell the plant apart.
- **"Shows in the world".** deep_query's rows don't show a bound value's text (it is drawn at scene time; the row reads
  `""`). So the test takes "the reading shows" to mean that the board bound to it is presented with no
  `ref_unresolved`, and that deep_query reads that revision with nothing unresolved. A reading missing from the world
  is exactly `ref_unresolved` naming the handle (`unreadable_handles` in `crates/deep-canvas/src/show.rs`).
- **"Shows as done".** The hub maps an answered ask to state `done`, but the canvas status map has no `done` state:
  binding it is refused with `out_of_range` at `status_bindings/ask-state/source: done`. So the test reads "done" as
  "reads exactly as an ask answered before the start does". The asks are seeded before the hub starts so that this
  reference doesn't depend on the code under test refreshing anything. As a guard, if an open ask and an answered one
  read alike, the test throws INCONCLUSIVE rather than passing.
- **"Built".** The world counts as built at the board's first deep_show and deep_query. A world built at hub start is
  also covered, since the asks were seeded before then and the reading comes after.
- **The ask's own session.** Both asks belong to the board session, because the canvas reads only the calling
  session's objects or objects with no session (`can_read`). The carried readings have no session.

## BLOCKED and INCONCLUSIVE

- **BLOCKED**:
  - the hub doesn't start
  - the hub records no carried-check reading after the world was built (the second claim didn't read the first one's
    run as carried)
  - #806's and #1018's own helpers' BLOCKED cases: no deep-hook or deep-show built, a claim that doesn't settle
- **INCONCLUSIVE**: an open ask and an answered one read alike through deep_show.
- **First-test 5 s timeouts.** Under load, a first-test 5 s timeout in a helper is environmental: rerun the file alone.

## Outside this folder, for the implementer

- `packages/hub/src/plant.ts`: add `'canvas-world-built-once'` to `Plant` and `PLANTS`, with no new export.
- The plant's behaviour, wherever the hub builds the canvas core's world (today `canvasWorld()` in
  `packages/hub/src/hub-canvas.ts`). Under the plant, the world is built once, at hub start or the first canvas call,
  and reused for every later deep_show and deep_query, never updated.
- `scripts/lanes.mjs`: add `'tests/acceptance/1868/'` to `alone`. The file starts a real hub, three sessions'
  deep-hook and `deep mcp`, and two check runs, like `tests/acceptance/1018/` and `tests/acceptance/806/`, which are
  already there.

## Open points

- **The twin may go stale.** The twin is a copy of the base's `plant.ts`. If the implementation's branch merges main
  and other files then compare `options.plant` with names this copy lacks, the twin won't build. Rebuild it on the
  merged `plant.ts` with the same changes, as #1509's twins were (`0f5c69b5c`).
- **Unrun legs.** The twin's failure is reasoned, not run, because no implementation with the plant exists. The
  failure message in the table above is the message the assertion builds. Its handle and log positions vary from run
  to run.
- **Criteria 1 and 3** (timing) are not covered here.
