# Acceptance tests for #2650: the extension host and the runner let go of what they finished

Written first, blind, by a job that never saw an implementation of #2650. It read:

- issue #2650 as of 2026-11-17: its body (the four stores, Scope, the six checkbox criteria, Proof, Depends on) and its
  first comment, "The bounds, drafted before any code moves", which the Scope names as the place each bound and what a
  caller gets past it are drafted, so it is read here as the issue's own text
- `docs/technical-design.md`: Numbers version 0 has to hold ("Every long-lived cache declares a bound in entries and in
  bytes", Every task carries its own budgets, The reference Macs), Extension API, Criteria in a checked shape, Wrong
  programs, Dogfooding; `AGENTS.md`
- #824, #1866, #363 and #1577, for scope only
- at the base commit `3cf41958f`: `benchmarks/hub-churn.mjs`; `packages/extension-host` (`host.ts`: `openExtensionHost`,
  `callAction` and its `requests`; `sources.ts`: `Sources.recorded`, `recording()`, the replay; `series.ts`:
  `SeriesStore.names`); `packages/runner` (`runner.ts`: `jobs`, `list`, `wait`, `status`, `output`, the window gate);
  `packages/hub` (`plant.ts`, `hub-control.ts`'s `job.*` methods, `log-reads.ts`'s `events.read`); the suites of #824,
  #363, #364, #1731, #159, #1328 and #63 for their conventions; `scripts/proof-change.mjs` (`criterionId`),
  `scripts/benchmark.mjs` (`fingerprint`) and `scripts/lanes.mjs`

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has six checkbox criteria, AC1 to AC6 in the body's order.

## How to run

With the repo's Node (`.node-version`, 24.22.0), the workspaces built, and deep-hook built (the hub's core stops
without it, so the benchmark's hub would answer nothing):

```sh
npm ci && npm run build --workspaces
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook
npx vitest run --root tests/acceptance/2650 --no-file-parallelism --testTimeout=600000 --exclude '**/budgets.long.test.ts'
npx vitest run budgets.long.test.ts --root tests/acceptance/2650   # the 5,000-cycle budget, by hand, on a reference Mac
node node_modules/typescript/bin/tsc -p tests/acceptance/2650/tsconfig.json
```

- **One file at a time:** the benchmark files read a hub's memory, and the others start sandboxed plug-ins and agent
  jobs through the supervisor.
- **Give a file filter before any boolean flag.** `--disable-console-intercept <file>` takes the file as the flag's value,
  and Vitest then runs every file, the long one included where its gate lets it.
- **Times** on the shared Mac this job ran on (Mac17,10, one-minute load 60 to 600; readings, not budgets): a runner
  job took about 75 to 95 ms after the first, which verifies the agent's binary in about 10 s, so `jobs.test.ts`'s
  10,000 jobs take about 15 to 20 minutes; `retries.test.ts`'s two runs of 10,001 action calls took 105 to 162 s at the base.
  The base's #824 cycle took about 2.2 s; with a job, two source reads and an action call added, each benchmark file's
  200 cycles are estimated at 10 to 15 minutes. The planted runs are one file each to keep each file short.
- **Temp folders:** every home, world and plug-in is under `/tmp/dh2650-*`, removed after its file. Cleanup stops by
  PID only what still holds a benchmark's home (`lsof +D`); hosts and runners are closed, which stops what they
  started. Nothing is stopped by name or port. No network and no model: the HTTP client is a stand-in (AC5), the agent
  is a stand-in (AC4), and the benchmark's own stand-ins are its own.
- With `--root`, Vitest writes its cache to `tests/acceptance/2650/node_modules/.vite/`; delete that folder before
  committing.
- Vitest hides a passing test's console output without `--disable-console-intercept`; the store readings printed there
  are the issue's Proof, so keep that output.

## What `scripts/lanes.mjs` needs

Made by this job in a commit of its own, beside the folder's:

- `byHand` and `timed` list `tests/acceptance/2650/budgets.long.test.ts`: 5,000 cycles beside the merge base's can't
  sit in the unit lane, and it calls `environmentProblem()` at its own call site, which #1114's grep holds to `timed`.
- `alone` lists the other test files by name, not the folder, as #824's are.
- The release preflight's `hub churn` lane already runs `node benchmarks/hub-churn.mjs --merge-base`; nothing to add.

## The surface under test

### Merged surfaces, used as their suites define them

- **The churn benchmark (#824):** `node benchmarks/hub-churn.mjs [--cycles <n>] [--home <dir>] [--merge-base]`, its one
  JSON line (`bench`, `cycles`, `warmup`, `every`, `readings`, `heapGrowthBytes`, `heapGrowthPer1000Bytes`,
  `mergeBase.commit`, `mergeBase.heapGrowthPer1000Bytes`) and its lines starting `PASS`, `FAIL` or `BLOCKED`; it passes
  `DEEP_HUB_PLANT` to its hub and leaves `--home` in place.
- **The hub (#16):** `deep hub run` with `HOME` the benchmark's home, `control.token`, `hello: app`, and `events.read`
  with `kinds`. The record's kinds: `source.called` (`outcome`, `bytes`), `reading.batch`, `job.ended` (`state`),
  `action.entered` (`request`).
- **Planted programs:** `DEEP_HUB_PLANT=<name>` (`packages/hub/src/plant.ts`; an unknown name stops the hub), and the
  `plant` option `openExtensionHost` and `openRunner` already take.
- **The extension host (#348, #350, #363, #364, #1731):** `openExtensionHost` with `record`, `supervisor`, `trust`,
  `home`, `release: []`, `now`, `secrets`, `http`, `replay` and `plant`, opened without `recording` (so it records, as
  every host does today); `install`, `check`, `load`; `callAction` with `request` and the caller's connection;
  `readSource`, `libraryCall`, `libraryFile`, `assetFile`; `recording()`. The plug-ins use `deep.registerAction`,
  `deep.store`, `deep.store.list` and `deep.registerSource` (polled and library).
- **The runner (#159):** `openRunner` with `record`, `asks`, `supervisor`, `ledger`, `now`, `root`, `loginPath`, `env`,
  `settings` and `plant`; `run`, `list`, `status`, `wait`, `output` and `report`. The hub's `job.list`, `job.status` and
  `job.output` return the runner's `list()`, `status()` and `output()` as they are (`hub-control.ts` at the base), so
  AC4 reads the rows from the runner itself, where `wait()` is too.
- **The plan window:** a job waits for its account's first window reading and raises `runner.window` after 30 minutes.
  The world writes `~/.claude.json` with an `oauthAccount` and reports one reading with room, as #1328's and #63's suites
  do; the base run shows a job getting past the gate and ending (BASE-FAILURE.txt).

### Defined here, where the issue leaves a choice: what the implementer has to meet

1. **`stores`** in the benchmark's JSON line is `{ "answers": <n>, "results": <n>, "jobs": <n>, "names": <n> }`, each
   number the store's growth per 1,000 cycles in bytes, read from the heap snapshots after warm-up and after the last
   reading. With `--merge-base`, `mergeBase.stores` holds the merge base's, read the same way.
2. **The FAIL on heap growth** is one line starting `FAIL` that names the cycle count as `<n> cycles`, the hub's heap
   growth with its unit, and the store that grew most by its key with that store's growth and its unit. Each size named
   is the JSON line's own number within 15%, per 1,000 cycles or over the run, as #824's suite reads a growth in words.
3. **The planted programs**, named below (Wrong programs), each added where its column says. A hub plant's leak lives in
   the store it names, so the reading's `stores` shows it under that key.
4. **A planted benchmark run** is 100 cycles after warm-up, and each plant must fail the benchmark at that count: 200
   bytes a cycle, 20 KB in all, over the hub's own noise. The issue doesn't say how large the read action's result or a
   set of 100 names is (open question 3).

## Readings where the issue and design leave a choice

- **1 MB is 10^6 bytes and 1 KB 10^3 bytes**, as #16's and #824's suites read them: 64 KB is at least 64,000 bytes and
  "every cycle's 320 KB" is 320,000 bytes.
- **"Compared with the merge base"** is read as #824's suite reads it: the limit is absolute and the merge base's reading
  is carried beside it. The criterion's own words on the merge base are checked from that reading: its heap keeps at
  least three quarters of 320 KB a cycle, and `jobs` grew most.
- **The reference Macs** are the design's three: Mac15,7 (Apple M3 Pro, 36 GB), Mac15,12 (Apple M3, 16 GB) and Mac17,10
  (Apple M5 Max, 64 GB), read through `scripts/benchmark.mjs`'s `fingerprint()`, on mains power, Low Power Mode off,
  thermal state nominal and the macOS build known. Anywhere else the budget is skipped as INCONCLUSIVE, never passed.
  It is one run: the design's five-run rule names timing results.
- **A healthy short run** isn't asserted to pass (#824's reading: a short run reads noise as growth; the base's one
  cycle after warm-up read 1 MB). Its `stores` are asserted instead: past warm-up's 100 cycles each store is at its
  bound of 64 entries, so each grows under the whole heap's limit, 200,000 bytes per 1,000 cycles. A snapshot's
  retained size reads no noise of that size.
- **The four calls, read back from the record (AC6):** a `source.called` answered with at least 64,000 bytes, a
  `reading.batch`, and a `job.ended` in state `finished`, at least once a cycle, warm-up's cycles included. The read
  action's call writes nothing to the record, and neither the job's 256 KB nor a set of names shows there: the planted
  runs prove those, each moving its own store by what the issue says the call keeps (half of 64 KB a cycle for
  `answers`, half of 256 KB for `jobs`, and at least the heap's limit, 200 bytes a cycle, for `results` and `names`).
- **#824's own criteria (AC6)** are held by #824's suites, `tests/acceptance/824/` and `tests/acceptance/824/sessions/`,
  run unchanged on the change: they drive this same benchmark. They aren't copied here (AGENTS.md: reuse sufficient
  tests).
- **AC3's call is a change**, as the issue's first comment says it must be. The test plug-in's change writes nothing and
  returns `{ run, token, n }`, with a new token at every run, so an output that ran again never equals the first. "10,000
  calls after the first" are 10,000 calls of the same action by the same caller, each with a request ID of its own.
  "Gets the first call's result" is the retry's output equal to the first call's. "Runs nothing again" is the handler's
  own run count, and one `action.entered` in the record for the request ID. The caller is an agent's session through
  deep-actions, as its gate hands a call to the host (#363's reading).
- **AC4's "what they are today"** is the row a job had when it ended, as `wait()` gave it then: 10,000 jobs later the
  first job's row in `list()`, `status()` and `wait()` must equal it, result included. The first job's result is far
  shorter than the record's 8,192-character cap, so the comment's cap doesn't apply. Past the bound, `output()` answers
  `''`, the answer the comment drafts. "Inside the bound" is the newest 64 ended jobs; each output is about 1.3 KB, well
  inside 8 MiB, so each must answer the whole stream-json it printed, ending in its own result.
- **AC5's binary answers** are a library file's bytes (`libraryFile`) and an asset file of the library downloaded in two
  ranges (`assetFile`, its bytes kept in the file the call names, as the comment says a library file's are). The
  recording is taken through JSON, as a fixture file holds it, and replayed in a new world whose network refuses every
  call. "Every call it recorded" is every call the host made: seven, far under the bound of 10,000 calls and 64 MiB.

## Criteria to tests

Each `describe` names its criterion's ID, `#2650.<first 8 hex of SHA-256 of the criterion's text>`, trimmed and white
space collapsed (`scripts/proof-change.mjs`, `criterionId`), and its text; each test's name starts with its ID.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#2650.20a03964` | 5,000 cycles with the four calls: heap under 1 MB against the merge base, on the reference Mac, the growth per 1,000 named; on the merge base 320 KB a cycle stays and the store that grew most is named | `budgets.long.test.ts`; `cycles.test.ts`: the reading's `stores`, flat on a healthy hub |
| AC2 `#2650.d1b5373c` | the four planted programs fail the benchmark, naming the cycle count and the growth | `planted-answers.test.ts`, `planted-results.test.ts`, `planted-jobs.test.ts`, `planted-names.test.ts` |
| AC3 `#2650.59fe85c2` | a retry 10,000 calls later gets the first result and runs nothing; other input refused; the planted host fails naming the request ID | `retries.test.ts` (2) |
| AC4 `#2650.4fd94bca` | rows and results 10,000 jobs later; `output` past the bound is the drafted answer; the planted runner fails naming the job | `jobs.test.ts` (2) |
| AC5 `#2650.c258f1dd` | a replay recorded while recording was on replays every call, binary answers included | `replay.test.ts` |
| AC6 `#2650.324460fd` | the benchmark's cycle gains the four calls; #824's criteria still hold | `cycles.test.ts`: the record; #824's suites, unchanged |

## Wrong programs

| Wrong program | How it is selected | Criterion | How the test fails on it |
|---|---|---|---|
| `churn-keeps-every-answer`: a host that keeps one answer per source call, though the hub opens it not recording | `DEEP_HUB_PLANT`, in `packages/hub/src/plant.ts`; the hub opens its host so | AC2 | it must FAIL naming `answers` with at least 32 KB a cycle; a benchmark that misses it, or names another store, fails the test |
| `churn-keeps-every-result`: a host that keeps every request ID's result, never letting one go | `DEEP_HUB_PLANT`, as above | AC2 | as above, naming `results` |
| `churn-keeps-every-output`: a runner that keeps every ended job's output | `DEEP_HUB_PLANT`, as above; the hub opens its runner so | AC2 | as above, naming `jobs` with at least 128 KB a cycle |
| `churn-keeps-every-name-set`: a series store that keeps every set of names it decoded | `DEEP_HUB_PLANT`, as above; the hub opens its series store so | AC2 | as above, naming `names` |
| `forgets-request-runs-again`: a host that, once a request has left memory, forgets it and runs the retry again | `openExtensionHost`'s `plant` option (the host's `Plant` type, `packages/extension-host/src/host.ts`) | AC3 | the judge (`judges.ts`) must report the retry, naming the request ID |
| `empty-output-inside-bound`: a runner whose `output()` answers `''` for a job still among the newest 64 ended | `openRunner`'s `plant` option (the runner's `Plant` type, `packages/runner/src/types.ts`) | AC4 | the judge must report a job inside the bound, naming it |
| the merge base | — | AC1, AC4 | AC1: its 320 KB a cycle, read beside the change's; AC4: past the bound its `output()` answers the whole output, not `''` (BASE-FAILURE.txt) |
| a recording that keeps a binary call's file reference but no bytes, or that stops keeping calls early | mutants of the base's `sources.ts`, run once and reverted, never committed | AC5 | the replayed bytes or the recorded calls differ (BASE-FAILURE.txt); AC5 names no plant and the base passes it |

AC3's main test passes on the base, which never lets a request go: there the planted test is what fails. The bound
itself is AC1's to prove; AC3 holds the retry to its answer once the bound lets requests go.

## Open questions for the issue's owner

1. **The shape of `stores`.** The comment says each store "reports its growth per 1,000 cycles, keyed `answers`,
   `results`, `jobs` and `names`"; these tests read each key's value as that growth in bytes, a number.
2. **The merge base's `stores`.** The comment says the merge base's hub "is read the same way" and the Proof asks for each
   store's growth on the merge base; these tests read it from `mergeBase.stores`. Without it, AC1's "the test fails,
   naming the store that grew most" on the merge base can't be read from the run.
3. **How large the read action's result and a set of 100 names are.** The benchmark's FAIL is judged on the whole heap,
   and the base's heap moved 1 MB in its first cycle after warm-up. A plant that keeps a few hundred bytes a cycle may
   not clear that at 100 cycles; the benchmark's call can carry a larger result.
4. **AC3's and AC4's surfaces.** The criteria name `call_action` and `job.list()`; these tests reach the host's
   `callAction` and the runner's `list()`, `status()`, `wait()` and `output()`, which those hub surfaces hand on at the
   base. A change that moves what `job.list` returns away from the runner's `list()` isn't seen here.
5. **`job.list` past the bound.** The comment says rows read the same at any age, from memory and then from the record.
   These tests read only the first job's row there; whether `list()` lists every job the record holds is left open.

## Files

- `helpers.ts`: the criterion IDs, the benchmark as a process, its JSON line and words, AC2's planted run, the record
  through `events.read`, and the reference-Mac gate.
- `host.ts`: AC3's and AC5's world, hosts, plug-ins, action calls and the network's stand-in.
- `runner.ts`: AC4's world, the runner on the stand-in agent past the plan-window gate.
- `judges.ts`: AC3's and AC4's assertions, which the planted programs must fail.
- `budgets.long.test.ts` and `cycles.test.ts` (AC1, AC6), `planted-*.test.ts` (AC2), `retries.test.ts` (AC3),
  `jobs.test.ts` (AC4), `replay.test.ts` (AC5).
- `fixtures/`: `claude.pl`, the stand-in agent; `tally`, AC3's plug-in; `feeds`, AC5's plug-in. The plug-ins' code
  carries a `.fixture` suffix so this suite's Vitest and type check skip it.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the runs on the base commit.
