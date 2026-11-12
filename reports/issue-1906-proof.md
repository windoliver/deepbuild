# #1906: folds and child ownership — remaining verification blockers

Part of #1906. PR #2322 remains draft because AC4 is not proven. This report replaces the earlier partial-proof report; the liveness, atomic-write and per-child ownership implementation gaps described there have been addressed.

Tested merge base: `bcd02c238`. Earlier red runs at `331b68be1` remain valid history; current-main ownership tests were independently authored on `bcd02c238`. Main was merged without changing an acceptance file. No test, golden or known-failure baseline was weakened or re-recorded.

## Requirement → change → proof

| Criterion | Change | Proof / status |
|---|---|---|
| AC1: core.ts is shorter, one forge default, one done.yaml reader | Shared reader/default, raw callbacks, session appends and Answers calls | Source assertions pass unchanged after failing on base. Current `core.ts` **8818 → 8797** lines; `host.ts` **4299 → 4269**. |
| AC2: one shell quote, duration and listener probe | Shell owner; asks' m/h/d parser with channel seconds preserved; supervisor listener probe retains raw-empty evidence | Three source assertions red on base, green on work; malformed nonempty lsof output cannot prove a free port. |
| AC3: every core child in children.ts's table at exit | Asynchronous child objects registered at Node's diagnostics boundary; synchronous invocations registered around all three native sync APIs; worker jobs retain their pending entries, and the child worker also loads tracking | Independent async suite: **4 red on base → 4 green**, including **1,000 seeded cases** and indirect gate starts. Independent sync suite: **4 red → 4 green**, including **1,000 seeded cases**, Box, gate and service callers. Original module/real-hub routing checks also remain green. |
| AC4: unchanged covering suites and each package type-check passes | Type/behavior-preserving folds and regression tests | Final workspace build **passes**, but the full affected comparison does **not**: immutable base has a Rust compile failure and many existing test failures. Full-run outputs below are not a PASS. |

## Closure work completed

- **Liveness has one probe without a policy change.** `processAlive` returns true on success/EPERM, false on ESRCH and unknown on other errors. The supervisor still treats unknown as alive; terminal tabs retain their old unknown-result policy. Five cases pass before/after, and a wrong probe fails the matrix. No owner decision is invented.
- **Atomic writes stay atomic, not newly durable.** State and channel links use one `writeAtomic` owner. Existing durable callers retain `writeSynced`. The fsync-unavailable regression fails on the earlier draft and passes on base/fix; there is no added fsync latency/error path for those two calls.
- **Child ownership includes indirect and synchronous starts.** The asynchronous table retains actual ChildProcess objects through exit notification, then clears them; a failed E2BIG spawn leaves no phantom object. Sync wrappers retain one invocation per child through completion and call the native functions unchanged. The Node sync binding supplies actual PID without changing stdout, stderr, status or thrown errors; PID zero is never read as an owned process. The wrapper adds no signal/kill behavior and preserves kept supervisor runs. The core worker loads the owner before its other modules; the child worker loads it too.
- **Review regressions stay covered.** Invalid child arguments still reject, unreadable listener output stays not-free, and a recorded decline wins over a concurrent host close. Tests pass on base, fail on the earlier wrong fold, and pass unchanged after correction.
- **Real prerequisites built.** `deep-hook` and `deep-show` were built from the current base. All tracked Rust/vendor files, lockfile, toolchain and Cargo config were compared byte-for-byte before cloning only ignored binaries to work. The previously blocked #1731 canvas fetch now passes with the real binary.
- **Size ceiling tightens.** The host ceiling was lowered from 4298 to 4269 as the design's Repo guards require. No ceiling was raised. Core's inherited ceiling violation remains: base 8818/work 8797 versus ceiling 8263.

The tracking is in the hub, which owns all core-thread starts and can see the Node boundary; an extension cannot cover starts made before it loads or by other core packages. No new dependency, option or setting was added. Internal `spawn_sync` binding use is a Node portability risk requiring review; it is exercised on Node 24.22.2, including worker-thread launches, native errors and outputs. The public sync functions retain their signatures and results. Scope expanded beyond the two named forks because the owner explicitly asked to close the universal gap; it is not silently narrowed to examples.

## Final focused proof

- `npm run build --workspaces`: **exit 0** on current base and final work.
- `tsc -p tests/acceptance/1906/exit/tsconfig.json`: **exit 0**.
- Final focused Vitest run: **10 files, 29 tests pass**, including all #1906 acceptance files (both 1,000-case properties), #1731 fetch, liveness, channel atomic write, listener and decline/close regressions.
- Final node lifecycle run: **6 tests pass**, covering direct registration, exit retention, failed E2BIG spawn, all sync APIs, missing sync executable and invalid arguments.
- Final `affected.mjs` run over the acceptance/regression files: **33 tests pass**, but overall **FAIL** on lints:

```
FAIL affected: 155 new, 11 already failing on main,
0 inconclusive or blocked, 0 listed skips, 33 passed
```

Of the 155 lint keys, **153 exactly match findings from the current base lint sweep**. One is the inherited core size violation with its smaller work line count (8818 → 8797); one is the closures command's interleaved failure output (the base has closure-data drift too). This comparison is evidence of inheritance, not a baseline waiver. No WIDE or INCONCLUSIVE line appears in the completed focused run.

`git diff --check bcd02c238..HEAD` passes. Frozen acceptance bytes match their authors. Earlier check corrections affected only implementation; the initially invalid provider-namespace fixture and the dist-only mutation that did not reach Vitest's source import are disclosed in local logs and do not count as proof.

## Full affected attempt: cannot satisfy AC4

Both base and work were launched through `node scripts/affected.mjs --slow --timed`, not marked green from focused tests. The base ran for over six hours, including its timed block. It recorded, before being stopped:

| Side | Passing test results | Failing test results | Skipped results | Files with results |
|---|---:|---:|---:|---:|
| Base | 5619 | 1063 | 436 | 1594 |
| Work | 934 | 238 | 4 | 376 |

These are unique reported test outcomes from partial runs, **not completed suite verdicts**. They are not a before/after equivalence claim. The work parallel blocks got no grant, then ran only part of its alone block. Remaining and stopped checks are INCONCLUSIVE, not PASS. Full selection included hand/platform lanes that cannot be executed by this session; none was silently counted.

Hard baseline failures include:

- `deep-app` test `acceptance_995` does not compile: `CanvasPanel::present` now requires its Context argument, absent in the unchanged test. Fixing that test requires its approved test-change process; this PR does not edit it.
- Existing contract fixture mismatches, behavioral assertions, and timing failures. The current-base lint sweep ran all 18 existing script commands and found 167 findings.
- Early reused shards lacked deep-hook/deep-show; binaries were installed only in this task's held shards after input checks. Those setup failures remain recorded; no retry-to-green was performed.
- Test/grant contention delayed checks for hours. The independent sync suite's first two queued attempts executed nothing; the eventual one real base run failed all four named assertions, then the unchanged work run passed.

The full jobs were stopped by recorded PID/ancestry only once the immutable required baseline failures demonstrated AC4 could not pass unchanged. No other session's process or grant was stopped. All unfinished results remain INCONCLUSIVE. No test/check/baseline was altered to turn this into a PASS.

## Reproducibility

Local raw logs are retained at `/private/tmp/deep-1906-proof/` (not committed because they contain local paths):

- `closure-base-build-corrected.log`, `closure-final-build.log`, `exit-final-typecheck.log`.
- `exit-base.log`, `work-exit.log`, `sync-base.log`, `sync-work.log`.
- `closure-final-focused.log`, `closure-final-node.log`, `closure-final-affected.log`.
- `closure-base-lints.json`, `closure-work-lints.json`.
- `full-base-affected.log`, `full-work-affected.log`, `base-partial-results.json`, `work-partial-results.json`, `closure-stopped-jobs.json`.
- `closure-rust-inputs.json`: exact input and binary provenance.

The independent oracle reads real table entries through V8's inspector, holding real Git/ps children at exit or observing native synchronous completion. It does not assert an implementation-chosen table name. It samples generated callers, not every possible production path; the common Node interception is the mechanism covering the remaining callers. There is no added shutdown-kill policy.

A few subsecond node regression probes were run under `scripts/lease` without the throttle after prolonged grant waits; these are functional assertions, not timing proof. All independent acceptance/property runs used test grants. The final full/focused runner calls use `affected.mjs`. No CI was added or dispatched.

## Remaining blocker to `Closes #1906`

**AC4 is not proven.** Required base checks fail, the full before/after comparison is incomplete, and inherited core/lint failures are not waived. #1687 also remains open/unmerged. The code/proof additions are pushed for review, but neither an agent's confidence nor a passing subset can close the issue under AGENTS.md.

The larger-than-requested draft is split into test-first/file-group commits, but remains one PR at the owner's request. Universal process coverage and independent 2,000-case proof expanded it beyond the initial audit's small folds; it can be split for merge once the remaining proof/dependency work is decided.
