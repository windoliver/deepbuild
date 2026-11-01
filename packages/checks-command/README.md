# @deepbuild/checks-command

## What it is for

The first-party command check kind (#30). It runs a check's shell command in its checkout, hermetically, through host@1 (#236), and reports a closed run outcome, never a verdict: the exit, the scrubbed output, and from the tools' own reports (Vitest, Jest, node:test, pytest, go test) the tests that ran, every attempt, where each failure failed and the files read. `commandCheckKind(host)` fills the check.kind@1 slot.

## Where new code goes

- `src/index.ts`: the run (`runCommandCheck`, `runAddedTests`, `commandCheckKind`).
- `src/report.ts`: reading a run's evidence files back; `src/listing.ts`: the tests a file holds, listed from its source; `src/shell.ts`: what a command hides (masks, untraced programs, detached children), and a shell script it runs as `sh file`, read as the command (the hub's drafted checks); `src/seeded.ts`: stand-in detection.
- `runtime/`: reporters and tracers loaded into the run's processes. A new test tool's reporter goes here.
- Tests: `test/` for regressions; the acceptance suite is `tests/acceptance/30/`.

## What it may import

Extension layer. It reaches `@deepbuild/conformance`, `@deepbuild/evidence`, `@deepbuild/gate` and `@deepbuild/supervisor` through their package entries, plus `typescript` and `node:` built-ins. It builds no sandbox and spawns nothing itself: every process goes through the host it is given. It never imports the hub, the CLI or the app.

## Deviations

- `runtime`: plain `.mjs` and Python files, not compiled TypeScript, because they are loaded into every process of a check's run through `NODE_OPTIONS`, `PYTHONPATH` and `PYTEST_PLUGINS` (see each file's header).
- `src/listing.ts`: loads the TypeScript compiler at runtime, which is why `typescript` is a dependency: its parser lists the tests each Vitest or Jest file holds from source, so a test left out fails the run (scripts/repo-rules.json).
