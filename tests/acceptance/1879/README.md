# Acceptance tests for #1879: `deep hub run --safe` loads no extension

Written first, blind, from issue #1879 (read live with `gh issue view 1879`: its text, Scope, three acceptance criteria,
Proof and Depends on), the design sections it links and base commit `c740dede7` (`main`, "Merge pull request #2559"), by
a job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- `docs/technical-design.md`: "One hub per user, a tiny hook client, and extensions in-process" (the Extensions row:
  "safe mode starts the hub with none loaded"), the done-gate row ("In safe mode the hub starts with no extension loaded
  at all, and this floor and the fail-closed guards still hold"), the deep CLI row (the fail-closed guards and the
  `.deepbuild/` guard hold "as they do with the hub down and in safe mode"), "Extension API (TypeScript, in-process)",
  Dogfooding. `AGENTS.md`.
- Sibling suites for conventions: `tests/acceptance/1922/` (a real hub, `deep install <folder>`, the cli role on the
  socket, `events.read`, a fixture package sealed with `packageDigest`), `316/` and `317/` (the floor's suites, below).
- At the base, for surfaces only: `packages/hub/src/hub-command.ts` (`--safe`), `server.ts` (`runHub`, the ready line),
  `core.ts` (the start's load of each installed package and its stderr line
  `deep hub: extension <id>@<version> not loaded: <reason>`), `install.ts` and `trusted-actions.ts` (`deep install`,
  "It is not loaded: <reason>"), `packages/extension-host/src/host.ts` (`loadNow`'s refusal
  "safe mode: the hub loads no extension"; a sandboxed package's process started in `<root>/run-*`),
  `packages/supervisor` (`process.starting`).

## The package

`fixtures/probe` is `test/safe-probe@1.0.0`: a TypeScript package from a folder, built by no agent, so the extension
host runs it sandboxed, in a process of its own. It registers nothing. `helpers.ts` copies it to a temp folder, renames
`index.ts.fixture` and seals its digest with the extension host's `packageDigest`.

## Readings

- **"Loaded".** A load of a sandboxed package starts its process, and the record shows it: a `process.starting` whose
  `cwd` is a run folder of the hub's (`<home>/.deepbuild/run-*`). The home has this one package installed, so each such
  event is its. `deep install` on a hub without `--safe` runs its conformance and its load (two processes); a later
  start runs no check again (the result is kept for these bytes), so a new process at a start is a load. The record is
  read with `events.read` on the cli role, as `deep` does. A package that does nothing observable was chosen over one
  that writes the record: `deep install` grants no `access: record`, so a load-time `deep.record.append` is refused
  (`capability.refused`), and the process start is the plainer signal.
- **"A load is refused with the safe-mode reason".** Either surface counts: the hub's own stderr line naming
  `test/safe-probe@1.0.0` as `not loaded` with a reason saying `safe mode` (the base's start already tries a load of each
  installed package and writes that line on a refusal), or, if the safe hub tries no load at start, a `deep install` of
  the same folder on it, which must not exit 0 and must say `not loaded` with `safe mode`. Either way the record must
  still show no new process of the package after it.
- **"No package is loaded".** The safe hub is watched for 20 s after its ready line: no new process of the package.
- **AC2.** The same home, started with plain `deep hub run`: a new process of the package within 60 s, and no
  `not loaded` line naming it.
- **AC3.** "#316's guard entries" are `tests/acceptance/316/` (the deep-hook matcher's default `fail_closed` guard@1
  entries) and "the `.deepbuild/` guard" is `tests/acceptance/317/` (deep-hook's floor entries; its `floor.test.ts` AC1
  denies the `.deepbuild/done.yaml` writes with the hub stopped and with the hub up in `--safe`). `floor.test.ts` runs
  each suite, unedited and uncopied, with the command its own README gives, in a child vitest, and passes when it exits
  0. Both suites hold deep-hook to deadlines of 50 ms and 500 ms, so they read only on a quiet machine: under heavy
  load they fail at the base on timing (see `BASE-FAILURE.txt`), and a change is judged against the base under the same
  load. Run them alone too:

  ```sh
  NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/316 --no-file-parallelism
  NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/317 --no-file-parallelism
  ```

## Run them

Built first: `npm ci`, `npm run build --workspaces` (twice if the first fails on declaration order) and
`cargo build --locked -q -p deep-hook` (the floor suites need `target/debug/deep-hook`). Then, from the repo root:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1879 --testTimeout=3600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1879/tsconfig.json
```

`starts.test.ts` alone (AC1, AC2) takes about 20 s; `floor.test.ts` (AC3) takes as long as the two floor suites do.

- Every folder is under `/tmp/dh1879-*`, removed after its file; `HOME` is a temp home for every child, and `DEEP_*`,
  `CLAUDE*`, `CODEX*`, `VITEST*` and `NODE_OPTIONS` are left out of children's environments. The OS confirmation for
  `deep install` is stubbed with `DEEP_HUB_TEST_CONFIRM`. No network, no model.
- Every process stopped is one this suite started, by its PID; a hub is spawned as its own group leader, and what's
  left in that group goes with it (`process.kill(-pgid)`). Nothing is stopped by name or port.

## What the base does

`BASE-FAILURE.txt` is the run at the base. AC1 fails at its criterion's assertion: the `--safe` hub loads
`test/safe-probe` (a new process of it in the record) and the failure names it. AC2 passes. AC3 was INCONCLUSIVE at the base
on a heavily loaded machine: the floor suites failed only on deadlines, and different tests in different runs.
