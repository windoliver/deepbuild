# Acceptance tests for #824: hub churn benchmark

Written first, from issue #824 (Scope, the three checkbox criteria, Proof), the design sections it links (Numbers
version 0 has to hold, with Every task carries its own budgets and The reference Macs; Criteria in a checked shape,
Wrong programs and Dogfooding), the suites of #16 and #21, and base commit `244a3455` (origin/main), by a job that never
saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

The issue has three checkbox criteria: AC1 to AC3 in the body's order. Scope's BLOCKED rule is tested under AC1, whose
reading it guards.

## How to run

With the repo's Node (`.node-version`, 24.22.0):

```sh
npm ci && npm run build --workspaces
npx vitest run --root tests/acceptance/824 --no-file-parallelism --exclude '**/budgets.long.test.ts'
npx vitest run --root tests/acceptance/824 budgets.long.test.ts   # the 5,000-cycle budget, by hand, in a Terminal tab
```

- Every test makes its own home under `/tmp/dh824-*` (a Unix socket path must fit in 104 bytes on macOS), and gives the
  benchmark no agent markers, billing keys or `DEEP_*` settings of this process. Cleanup stops by PID only what still
  holds that temp home (`lsof +D`), never by name or port.
- With `--root` here, Vitest writes its cache to `tests/acceptance/824/node_modules/.vite/`; delete that folder before
  committing.
- Type-check with `node node_modules/typescript/bin/tsc -p tests/acceptance/824/tsconfig.json`. The tests import no
  package: only `benchmarks/hub-churn.mjs`, `deep hub run`, the socket's `events.read`, `scripts/lanes.mjs`'s exports and
  `benchmarks/budgets.json`.

## What `scripts/lanes.mjs` needs

This job edits nothing outside this folder.

- `byHand` must list `tests/acceptance/824/budgets.long.test.ts`: 5,000 cycles and the merge base's run can't sit in the
  unit lane.
- `alone` must list `cycles.test.ts`, `planted.test.ts` and `leftovers.test.ts` by name, not the folder (the long file
  would run too): they run real hubs for hundreds of cycles and read memory, so nothing should run beside them.
- The local preflight must run the benchmark itself: `cycles.test.ts` wants a lane in `checks` or `releaseLanes`, or a
  task in `benchmarks/budgets.json`, that names `benchmarks/hub-churn.mjs`. Note the perf lane runs a task 21 times a
  side with a 5-minute cap on each (`scripts/benchmark.mjs`, `measureOnce`), which a 5,000-cycle run won't fit.

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub** (#16): `deep hub run` with `HOME` the temp home, `control.token`, `hello: app`, `events.read`.
- **The record's kinds**: `session.start`, `session.end`, `tool.before`, `tool.after`, `ask.created`, `ask.answered`,
  `run.finished`, `promise.set`, `promise.woken`.
- **Planted programs** (#666 and others): `DEEP_HUB_PLANT=<name>`, `packages/hub/src/plant.ts`; an unknown name stops
  the hub.

### Defined here, where the issue leaves a choice: what the implementer has to meet

1. **The benchmark's entry**, after `benchmarks/hub.mjs`: `node benchmarks/hub-churn.mjs [--cycles <n>] [--home <dir>]
   [--merge-base]`. Default cycles 5,000. `--cycles` exists because 5,000 cycles can't run in an ordinary test. `--home`
   is the hub's `HOME`, and the benchmark leaves that folder in place so the record can be read back. `--merge-base`
   adds the merge base's readings. It starts its own hub, inheriting `DEEP_HUB_PLANT`, and stops it by PID before it
   exits.
2. **Its one JSON line** on stdout, printed whether the run passes or fails:

   ```
   { "bench": "hub-churn", "cycles": <n>, "warmup": 100, "every": 100,
     "readings": [{ "cycle": <cycles after warm-up: 0, 100, ...>, "heapBytes": <n>, "rssBytes": <n> }, ...],
     "heapGrowthBytes": <last - first>, "rssGrowthBytes": <last - first>,
     "heapGrowthPer1000Bytes": <growth x 1000 / cycles>, "rssGrowthPer1000Bytes": <same>,
     "open": { "afterWarmup": { "sockets": <n>, "timers": <n>, "children": <n> }, "afterLast": { ... } },
     "mergeBase": { "commit": "<git merge-base HEAD origin/main>", "heapGrowthPer1000Bytes": <n>,
                    "rssGrowthPer1000Bytes": <n> } }
   ```

   `mergeBase` comes with `--merge-base`. Where the merge base can't run the cycles (the first run, since it has no
   benchmark), it holds `commit` and `initial`, the reason in words. `heapBytes` is the hub's retained heap after a full
   collection, all of its threads included (a leak in the core's worker must show). `sockets`, `timers` and `children`
   are the hub process's own, so its listening socket and its intervals are among them.
3. **The planted hubs**, named `DEEP_HUB_PLANT` values, added to `plant.ts` beside the others:

   | Plant | What it does |
   |---|---|
   | `churn-keeps-ended-session` | keeps one entry per ended session in a map; the entry holds a 1 KiB string |
   | `churn-keeps-reload-listener` | adds one listener per reloaded extension, never removed; its closure holds a 1 KiB string |
   | `churn-leaves-socket`, `churn-leaves-timer`, `churn-leaves-child` | leaves one of that kind open per cycle |
   | `churn-no-full-collection`, `churn-no-resident-read` | the hub can't force a full collection, or can't read resident memory |

   The 1 KiB is this job's: the issue says "one entry". 1 MB over 5,000 cycles is 200 bytes a cycle, so a map entry
   holding only a short ID (about 100 bytes) would stay under the budget.
4. **Exit and words**, as `scripts/preflight.mjs` prints them: over a limit or with leftovers, a line starting `FAIL`
   and a non-zero exit. The line names the cycle count as `<n> cycles`, the growth with its unit (the same number as in
   the JSON line, within 15%), and, for leftovers, what was left (`socket`, `timer`, `child`). Where a reading can't be
   had, a line starting `BLOCKED` and a non-zero exit, no `FAIL` and no `PASS`.
5. **Limits at a shorter run** scale with the cycles: 200,000 bytes of heap and 2,000,000 of resident memory per 1,000
   cycles, the issue's numbers over 5,000.

## Readings where the issue and design leave a choice

- **1 MB is 10^6 bytes**, as #16's suite reads it.
- **"Compared with the merge base"** states no margin, so the merge base's reading is carried beside the change's (the
  issue's Proof). Only the absolute limits are asserted.
- **The budget counts only on a reference Mac** (Mac15,7 or Mac15,12) on mains power, Low Power Mode off, thermal state
  nominal; elsewhere it is skipped as INCONCLUSIVE, never passed. It is one run, not five: the design's five-run rule
  names timing results, and two sides of 5,000 cycles is already hours.
- **A short unplanted run isn't asserted to pass**: 300 or 500 cycles can read noise as growth. Only the 5,000-cycle run
  is judged on a healthy hub.
- **An extension's reload has no record event** on the base, so `cycles.test.ts` can't count reloads. The listener plant
  proves them: with no reload it leaks nothing, the reading doesn't move and `planted.test.ts` fails.

## Criteria to tests

Each `describe` names its criterion's ID, `#824.<first 8 hex of SHA-256 of the criterion's text>`; each test's name
starts with its criterion's number.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#824.5d5b3077` | 5,000 cycles: heap under 1 MB, resident under 10 MB, against the merge base, on the reference Mac | `budgets.long.test.ts`; `cycles.test.ts`: in the preflight, the readings, the record's cycles, BLOCKED twice |
| AC2 `#824.00e39b0a` | the two planted hubs fail it, naming the cycle count and the growth | `planted.test.ts` (2) |
| AC3 `#824.d4ee9496` | sockets, timers and children after the last cycle equal those after warm-up | `leftovers.test.ts`: the unplanted hub; the three leaving hubs |

## Wrong programs

The mechanism is `DEEP_HUB_PLANT` and the merge base. There is no `twins.json`, for two reasons: AC2's tests must watch
the benchmark fail on a planted hub in the ordinary tree, where a twin isn't laid; and a twin replaces whole files, so a
copy of the base's `core.ts` or `host.ts` would drop the reload the change has to add.

This departs from the design's "written ... by the same job" for the plants' bodies: the implementer writes them, to
Defined here, 3. The tests hold them to it: each must move the reading by at least 500,000 and at most 20,000,000 bytes
per 1,000 cycles over the unplanted hub's on the same cycles.

| Wrong program | How it is selected | Criterion | How the test fails on it |
|---|---|---|---|
| one entry per ended session | `DEEP_HUB_PLANT=churn-keeps-ended-session` | AC2 | it must fail the benchmark; a benchmark that misses it fails the test |
| one listener per reloaded extension | `DEEP_HUB_PLANT=churn-keeps-reload-listener` | AC2 | as above |
| one socket, timer or child a cycle | `DEEP_HUB_PLANT=churn-leaves-*` | AC3 | as above, and the count must move |
| no full collection, no resident memory | `DEEP_HUB_PLANT=churn-no-*` | AC1 | it must be BLOCKED, never PASS |
| the base itself | — | all | BASE-FAILURE.txt: no benchmark, no lane or task naming it |

## What depends on other issues

- **An extension reload** isn't a surface of the base. The hub has `extension.install` (from the CLI, once the OS
  confirms you); `ExtensionHost` has `disable` and `load` inside the core, and nothing calls them as a reload. The
  benchmark needs a way in, which the issue doesn't name: an open question for the issue's owner.
- **"The shipped extensions"**: the core opens its host with `release: []` and loads what is installed, so a fresh home
  loads none. Which packages the benchmark's hub loads is the same open question.

## Files

- `helpers.ts`: temp homes, the benchmark as a process, its JSON line and words, the record through `events.read`, the
  reference-Mac gate.
- `cycles.test.ts` and `budgets.long.test.ts` (AC1), `planted.test.ts` (AC2), `leftovers.test.ts` (AC3).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
