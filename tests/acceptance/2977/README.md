# Acceptance tests for #2977: a new supervisor's first sandboxed start waits 10 s on a Mac whose sandbox reports carry no subsystem

Written first, blind, from issue #2977 (live, updated 2026-11-21T01:35:40Z: its report, chosen fix "warm all the
filters at once" and three acceptance criteria), the design and base commit `ee05e7257` ("Merge pull request #2963 …",
origin/main), by a job that never saw an implementation; none existed, and no other branch, worktree, pull request,
stash or notes folder was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2977.04fdc1bc` | `first-start.test.ts` (2): under `reports-other-subsystem` and under `reports-other-process`, a new supervisor's first sandboxed `start()` resolves within 5 s of `openSupervisor` resolving |
| AC2 | `#2977.0d3f7721` | `kept-stream.test.ts` (2): under `reports-other-subsystem` the one `log stream` child left is the kernel's filter, under `reports-other-process` the sender alone; in both a refused write is one `sandbox.denied` for its run |
| AC3 | `#2977.cd253437` | `extension-host.test.ts` (1): a child `vitest run` over the five listed `packages/extension-host/test` files reports each of the 11 listed tests as passed |

The ID is `scripts/proof-change.mjs`'s `criterionId` (sha256 of the criterion text after `- [ ] `, whitespace
collapsed, first 8 hex) over the live issue body. Every test's name starts with its ID. All five tests are
`skipIf(process.platform !== 'darwin')`: the denial stream (`log stream`) and the issue's Mac are macOS only.

## What was read

- Issue #2977, live. `AGENTS.md`; `docs/technical-design.md`: Dogfooding, and "Tests written first, by a job that
  never sees the code".
- At the base: `packages/supervisor/src/supervisor.ts` (`FILTERS`, the planted filter lists, `watchDenials`, `warm`,
  `start`, `close`), `src/index.ts` and `src/types.ts` (the public entry and `plant`), `src/procs.ts` (`HELPER`),
  `src/supervisor.test.ts` (its "a refused write is recorded on a macOS whose sandbox reports …" test, whose world and
  ps reading these tests follow), `scripts/proof-change.mjs` (`criterionId`), `tests/vitest-setup.ts`, the test names
  of the five `packages/extension-host/test` files the issue lists, and suites `2629/`, `2648/`, `1056/` and `1143/`
  for layout and for how a child Vitest is run.

## The surface under test

- `openSupervisor` from `@deepbuild/supervisor`'s public entry (`packages/supervisor/src/index.ts`, loaded from
  source; its `log stream` runs on the built `dist/helper`'s leash, so the package must be built), on a real record
  (`@deepbuild/record`) and asks core (`@deepbuild/asks`) in a temp folder, with `plant: 'reports-other-subsystem'` or
  `'reports-other-process'`. Then `start()` and `wait()` of a sandboxed run (a `write` grant of its own folder, not
  `run_as_you`), the record's `sandbox.denied` events, and this process's `log stream` children as
  `ps -A -ww -o ppid=,command=` shows them (ppid = `process.pid`).
- AC3: the issue's own command, `vitest run` from the repo root, over the five files, with their own timeouts.

## Readings where the issue leaves a choice

- **"within 5 s of `openSupervisor` resolving"** (AC1): `performance.now()` taken right after `await openSupervisor`,
  and again when the first `start()` resolves (with status `started`); the difference must be under 5000 ms. The run
  is `/usr/bin/true` with a write grant, so it is sandboxed and waits for the warm. No load gate and no retry.
- **"exactly one `log stream` child … the cheapest filter in FILTERS order that showed it"** (AC2): read after the
  run has ended and its refusal is on the record (polled up to 15 s), plus 2 s for a second stream or report to add
  anything. The kept stream is told by its predicate in the ps line: `--predicate process == "kernel" AND sender ==`
  for the kernel's, `--predicate sender ==` for the sender alone (the predicates `supervisor.ts` writes at the base).
  Under `reports-other-process` only the sender alone shows a report; the criterion names it, so it is tested too.
- **"one `sandbox.denied` for that run"** (AC2): every `sandbox.denied` whose `run` is the run, not only those
  naming the target, must be exactly one, naming the refused path (`outside/w.txt`, which must not exist).
- **"passes the 11 tests listed above"** (AC3): matched by file and by the start of the test's full name (describe
  blocks included). The 7 of `sources.test.ts` are the tests of its three named describe blocks that run on macOS,
  less the Keychain store test, which opens no supervisor: back-off (3), "removing a secret …" and "sign-in through
  an OAuth loopback" (2), and the two stream-cursor tests (2). Only those five files are run, not the whole folder:
  the criterion is about these 11; a missing test counts as a failure.

## Base results

`BASE-FAILURE.txt`, on this Mac (macOS 27.2.1, 26B7131) under heavy load: 5 tests, 3 fail, 2 pass. AC1 fails for the
issue's reason (first start 10.3 s under `reports-other-subsystem`, 20.5 s under `reports-other-process`). AC2
passes: it pins what the base already does and guards the fix (no planted twin was written for it). AC3 fails: the
11 listed tests don't pass in the child run, as the issue's table says (timeouts, and #348's 20518 ms).

## Run them

On macOS with Node 24.22 first on `PATH`, from the repo root, after `npm ci && npm run build --workspaces`:

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/2977
node node_modules/typescript/bin/tsc -p tests/acceptance/2977/tsconfig.json
```

Temp folders are `$TMPDIR/deep2977-*`, removed after each test. No network. The only processes stopped are the
supervisor's own `log stream`s, by its `close()`.
