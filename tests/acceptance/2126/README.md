# #2126: a child that exits before it reads its input (blind acceptance)

I drafted this suite blind. I used only `ISSUE-2126.md`, `AGENTS.md`, the design sections the issue names (An agent
says it's done, Checks for work beyond code, How we know version 0 works, including Dogfooding and Repo guards) and the
base commit `0a875355b2c19e7705b1b248c9a20b85e24cbbcd`. I read no branch, PR or implementation of the fix. Under
AGENTS.md these tests are frozen: the implementing change must make them pass without editing them.

## Criterion → test → assertion

All three tests are in `epipe.test.ts`. Each one runs its scenario in a Node process of its own
(`fixtures/scenario.mjs <gate|probe|cli>`), as the hub or an eval would run the call. That process records every
uncaught exception it sees (`process.on('uncaughtException')`) and writes one JSON report line. The test asserts on
that report with `expect(...)`. So an uncaught `write EPIPE` fails the test at an assertion and doesn't end the vitest
worker.

| Criterion | Test name | Asserts |
| --- | --- | --- |
| `#2126.67cc88df` | `#2126.67cc88df A git stopped before it reads its input fails its call and never takes the hub down` | A claim's stage runs under one `checkouts.budget()`: `snapshot(repo, budget)`, then `checkout(…, budget)`. The repo tracks 5,400 files with 196-character names, all marked skip-worktree, and one 1 MiB file. So the gate hands git a ≥ 1 MiB path list on stdin (asserted). The snapshot does it with `update-index --no-skip-worktree -z --stdin`. Where the file system can clone the big file, the checkout's `checkout-index -z --stdin` does it too. A `git` stand-in first on PATH (`fixtures/standin/git`) passes every call to the real git except one with `--stdin`. That call writes a mark (asserted, and it must end in ` --stdin`) and stops itself with SIGSTOP without reading. At the gate's 8 s budget the gate SIGKILLs it. Then: **no uncaught exception** (`uncaught` equals `[]`), and the call **rejects** with `name` `OverBudget` and a message matching `/over budget/`. The process exits 0. |
| `#2126.74588985` | `#2126.74588985 A probe that exits before it reads its input reads as a failed check, never an uncaught error in the hub` | `runProbe(fixtures/exit-probe.mjs, …)` runs with no host (the standalone path, probe.ts's `child.stdin.end`). The probe is `process.exit(1)` and the input is ≥ 2,000,000 bytes (asserted). Then: **no uncaught error**, and runProbe **resolves** with `outcome` `failed`. |
| `#2126.1680fcd2` | `#2126.1680fcd2 A judge or agent CLI that exits before reading its prompt ends as a failed call, never a crashed eval` | `runCli([fixtures/exits-at-once.sh], prompt, …)` runs a fake CLI that exits 1 without reading stdin, with a 300,000-byte prompt (asserted). Then: **no uncaught error**, and runCli **resolves** with no lines (`[]`). |

On the base commit, each test fails at its `expect(report.uncaught).toEqual([])` line: the report lists
`EPIPE write EPIPE` (BASE-FAILURE.txt). Each test checks first that its scenario really happened: the input size, and
for the gate, that git stopped at the stdin call. Without that, a run that never wrote to stdin would fail somewhere
else instead of passing.

## Surfaces

- Gate: `openCheckouts` from `@deepbuild/gate`'s public entry (built `dist`), and its `budget()`, `snapshot()` and `checkout()`. It
  runs on the real record, asks, lease table and supervisor (`@deepbuild/record`, `asks`, `leases` and `supervisor`
  entries), as #31's suite builds them. The only thing replaced is `git`, through PATH, as the issue says.
- Probe: `runProbe` from `@deepbuild/conformance`'s public entry.
- CLI: `runCli`. `@deepbuild/config-eval`'s entry doesn't export it, and its package `exports` map blocks a deep import
  by package name. So the scenario imports it by relative path from the built module
  `packages/config-eval/dist/launcher.js`, where it is exported. That is the module the issue names
  (`packages/config-eval/src/launcher.ts`).

## Run

From the repository root, with Node ≥ 24.22.0, after `npm ci` and `npm run build --workspaces` (the scenarios import
the built `dist`, so rebuild after a source change):

```sh
npx vitest run tests/acceptance/2126 --reporter=verbose
```

No network, no model and no cargo build are needed. Temp folders go under the OS temp dir as `dh2126-*`, with `HOME`
set inside them, and are removed at the end. The gate test takes the gate's own 8 s budget, plus the setup of 5,400
files.

Why the snapshot's stdin call: `checkout-index -z --stdin` (issue: checkouts.ts:394) runs only once the gate has
cloned a ≥ 1 MiB file with `COPYFILE_FICLONE_FORCE`. On the drafting Mac that clone failed with `ENOSYS` in this
environment, so the gate fell back to `checkout-index -a`, which has no stdin. The snapshot's
`update-index --no-skip-worktree -z --stdin` goes through the same `runGit` (`child.stdin!.end(input)`, issue:
checkouts.ts:95) under the same budget and its SIGKILL (issue: checkouts.ts:204). It is the stage a claim's checkout
runs first, so the suite drives it. Where cloning works, the checkout's own stdin call stands behind it under the same
stand-in. The test asserts that git stopped at a `--stdin` call, so a run where the scenario didn't happen fails at an
assertion and can't pass vacuously.

## Repo rules

- No sleeps or timers in the test files. The stand-in git blocks with SIGSTOP, not a timer. The only bound on a hang is
  `spawn`'s `timeout` option. The vitest timeouts are per-test options. `node scripts/wait-ratchet.mjs` reports no
  finding under `tests/acceptance/2126/`.
- No twins (the fix isn't on the base). No `toThrow` assertions.
