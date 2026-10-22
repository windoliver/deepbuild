# AC6 blind redraft: the receiver's working memory at 2,000 spans/s, measured in its own process

Test: `budgets.test.ts`, the `describe` "AC6 budgets on the reference Mac" with its one `it` (now "AC6 2,000
spans a second take under 5% of a core, and the receiver process's resident set grows under 50 MB"). The
limits (0.05 of a core, 50 MB), the load (200 spans every 100 ms from a separate sender process, 27 s), the
reference-Mac gate, the design's judge (five 5 s runs after a 2 s warm-up) for the CPU share, and the checks
that every export is accepted and every tool span reaches the record are unchanged. `helpers.ts` is unchanged.

## What I read

- Issue #42's body (`gh issue view 42 --repo windoliver/deepbuild`): the AC6 criterion.
- `AGENTS.md`; the design's budget paragraph ("Every task carries its own budgets": memory as peak and idle,
  the five-run rule and its margin) in `docs/technical-design.md`; the root `tsconfig.json`.
- `tests/acceptance/42/`: `README.md`, `helpers.ts`, the old `budgets.test.ts`, `AC4-REDRAFT.md`,
  `doctor.test.ts` (the build-then-run-dist pattern); `tests/acceptance/14/budgets.test.ts` and its
  `AC6-REDRAFT.md` for the gate, judge and form.
- `packages/otlp/src/index.ts`'s `import`/`export` lines and `packages/otlp/package.json` (its `exports`),
  to know the built entry; the dispute's own figures as handed to me.

Not read: the receiver's implementation (`packages/otlp/src/*` bodies, `packages/otlp/test`). One probe
(`node -e "import('.../packages/otlp/src/index.ts')"`) told me plain Node cannot load the source
("parameter property is not supported in strip-only mode"), which is why the receiver process loads `dist/`.

## The dispute, and my reading of it

The old test measured `process.memoryUsage().rss` of the vitest worker at 2 s and at 27 s. That worker had
just built the 19 MB bodies file (270 × 200 spans through JSON and hand-encoded protobuf), leaving a heap V8
keeps committed and releases and recommits during the run; the two samples land at arbitrary points of that
cycle, so the "growth" read −123 to +98 MB on an unchanged receiver. **Agreed**: the reading was this process's
garbage, not the receiver's working memory, and `global.gc` is not exposed under the preflight's vitest, so
the old `if (global.gc) global.gc()` never ran there. The CPU readings were not disputed and are kept as they
were judged.

## What changed and why

| Change | Why |
|---|---|
| The receiver runs in its own node process, started by the test with `--expose-gc`, loading the built `packages/record/dist/index.js` and `packages/otlp/dist/index.js` (as `doctor.test.ts` runs the built CLI after `npm run build --workspaces`, which this file now also runs in `beforeAll`); it opens the record at a temp path, starts the receiver on a free port and reports its URL over IPC | The criterion names the receiver's memory. A process that holds only the receiver and the record has nothing else to swing its resident set; the test's bodies and the sender's buffers live in other processes. Plain Node cannot load the TypeScript source, so the built package is what runs, as it would for a user |
| Memory is the receiver process's `rss`, sampled through IPC after the 2 s warm-up and after the fifth window, each after `gc()` in that process; the growth must be under 50 MB. The retained heap (`heapUsed + external`, after the same collections) is printed beside it as a reading | RSS is the working memory the issue and the README name (and includes the record's native memory, which the heap does not). The collection before each sample removes the one source of noise left, short-lived garbage of the load itself, so the difference is what the receiver kept |
| CPU is the receiver process's `process.cpuUsage()` (user + system) and `hrtime`, asked over IPC at the edges of each 5 s window; the share is their quotient | The same quantity as before, now the receiver process's alone. The IPC answer costs it microseconds per window |
| After the load, the test tells the receiver process to close, waits for its exit code 0, then opens the record from the test process to count `tool.span` events | Every tool span still has to reach the record, so a receiver cannot be cheap by dropping work; a receiver that cannot close is caught too |
| `afterEach` kills the processes this test started (by handle) if a failure leaves them running | Never kill by name or port (AGENTS.md) |

I did not take the other two options. Building the bodies before opening the receiver and settling the heap
in-process would still leave the baseline inside a 184 MB committed heap that V8 shrinks on its own schedule,
and nothing in the preflight exposes `gc` to the worker. Measuring `heapUsed + external` in-process would be
repeatable only after a forced collection, which the worker cannot do either, and would miss native memory.

## Readings on the reference Mac (Mac15,12, mains, Low Power Mode off), two runs

```
AC6 receiver process: resident set grew 16.5 MB (retained heap 2.4 MB after a full collection) over 25 s at 2000 spans/s
AC6 share of a core at 2,000 spans/s: 0.0279, 0.0282, 0.0236, 0.0237, 0.0230 against 0.05 (margin 23%)
AC6 receiver process: resident set grew 16.6 MB (retained heap 1.9 MB after a full collection) over 25 s at 2000 spans/s
AC6 share of a core at 2,000 spans/s: 0.0282, 0.0271, 0.0362, 0.0220, 0.0238 against 0.05 (margin 65%)
```

These agree with the implementer's own out-of-vitest figures (2.0 MB retained, RSS +9 to 20 MB).

## The wrong programs, and how each fails

| Wrong program | How it fails |
|---|---|
| Retains every decoded span (50,000 over the measured 25 s) | A probe in my scratchpad building 50,000 spans shaped like the load's, kept in an array, retains 54.5 MB of heap and raises RSS by 195 MB after a full collection; the receiver process's RSS growth is far over 50 MB |
| Retains the raw bodies or the record's rows per request (about 1 KB per span) | RSS growth of about 50 MB plus the heap's overhead over the window; over the limit |
| Drops exports or spans to stay cheap | "every export was accepted" (`{ 200: 270 }`) or "every tool span reached the record" (10,800) fails |
| Spends over 5% of a core | The judge: FAIL when all five windows are over by more than the margin, otherwise INCONCLUSIVE |
| Cannot be closed, or leaves the record open | "the receiver process closed cleanly" fails |

A receiver that retains about 2 MB passes on a quiet reference Mac (above); off a reference Mac the test
skips INCONCLUSIVE as before.

## Type check and run

`node node_modules/typescript/bin/tsc --noEmit` at the root (which excludes `tests/`) printed nothing, and the
test file alone, under the root options plus `allowImportingTsExtensions`/`noEmit` from a scratchpad
tsconfig outside the repo, type-checks with no errors. The two runs above:
`node node_modules/vitest/vitest.mjs run --silent=false tests/acceptance/42/budgets.test.ts`, 1 passed each
(33.9 s and 33.2 s, including the workspace build).
