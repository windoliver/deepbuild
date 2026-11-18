# Acceptance test for #1879, criterion 2 redrafted: the same hub started without `--safe` loads the package

A blind redraft (design: Dogfooding; AGENTS.md, Proof) of #1879's second criterion only, written at the base commit
`3c124dee` by a job that saw only the issue, the design and that commit. No implementation of #1879, diff, other
worktree, branch, pull request or other #1879 suite was read. The implementing agent doesn't edit these files; a
dispute goes to another blind redraft.

## What was read

- Issue #1879's body (`gh issue view 1879 --repo windoliver/deepbuild`), not its comments: Scope, its three criteria
  and Proof ("The two starts on a real hub, the first failing on the merge base").
- `docs/technical-design.md`: One hub per user, a tiny hook client, and extensions in-process; Extension API
  (TypeScript, in-process); Dogfooding.
- `AGENTS.md`.
- At the base, for surfaces and conventions only: `packages/hub/src/hub-command.ts` (`deep hub run [--root] [--safe]`),
  `server.ts` (the ready line, SIGTERM stops the hub), `core.ts` (the hub loads each installed package at its start and
  writes `deep hub: extension <id>@<version> not loaded: <reason>` for one it refuses), `install.ts` (`deep install`);
  `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`, `vitest.config.ts`, `tests/vitest-setup.ts`; and
  the suites of #363 (its `hub.ts`, agent stand-in and `picky` plug-in), #348, #317 and #1922 for their layout.

## The criterion

| ID | Text | Test | At this base |
|---|---|---|---|
| `#1879.81f0a695` | The same hub started without `--safe` loads the package | `start.test.ts` (1) | passes (`BASE-RESULT.txt`) |

The ID is `#1879.` plus the first 8 hex digits of the SHA-256 of the checkbox text, trimmed, whitespace collapsed
(`criterionId`). The first and third criteria are not here.

## How to run

On a built checkout (`packages/*/dist`; the test runs the built CLI, `packages/cli/dist/main.js`), with the repo's
Node (24) first on `PATH`:

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1879-redraft-ac2 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1879-redraft-ac2/tsconfig.json
```

The proof lanes (`node scripts/affected.mjs`, `node scripts/proof.mjs`) run it with the repo's `vitest.config.ts` and
no flag, as `node node_modules/vitest/vitest.mjs run tests/acceptance/1879-redraft-ac2` does. Either way gives the same
verdict:

- **Timeouts are the test's own.** The test sets its timeout itself (`TEST_TIMEOUT` in `helpers.ts`, about 32
  minutes), so Vitest's 5 s default and any `--testTimeout` flag don't matter. Every wait inside it is bounded (`WAIT`:
  a hub's ready line 240 s, a hub's exit 90 s, the install 300 s, a hook's acknowledgement 75 s, an MCP reply 180 s),
  sized for a machine at load 100 to 200. The test's timeout is above their sum, so a hub that never answers fails with
  the wait's own message, headed `BLOCKED:` and naming what was waited for; it never hangs.
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment and
  points `HOME` at a temp folder. Every hub, `deep` command and agent stand-in runs with `HOME` in its own temp folder
  and none of `DEEP_*`, `CLAUDE*`, `CODEX*`, `XDG_*`, `TMUX*`, `VITEST*`, `NODE_OPTIONS`, so nothing touches the real
  `~/.deepbuild`. One exception, on the first hub only: `DEEP_HUB_TEST_CONFIRM`, the hub's own test setting that stands
  for the OS confirming you, which `deep install` needs. The hub under test gets no `DEEP_*` variable at all.
- **Temp folders:** everything is under `/tmp/dh1879r2-*`, real paths, removed after the file.
- **Processes:** the two hubs, the `deep install` command, the agent stand-in and its server are stopped by PID.
  Nothing is stopped by name, port or process group.
- **No network**, beyond the hub's own Unix socket. On Linux the package runs in the hub's sandbox, so the run needs
  what the hub's sandbox needs (`bwrap`).
- **One at a time.** It starts real hubs; the implementer adds `tests/acceptance/1879-redraft-ac2/` to the `alone` list
  in `scripts/lanes.mjs`, as #363's and #348's suites are (not done here: this job writes tests only). It doesn't
  depend on that to pass: no wait is a tight one.

## What the test does

1. Makes a temp home and a small git worktree for the agent stand-in.
2. Gives the home its one installed package: starts a first hub (`deep hub run`), runs `deep install <folder>` of the
   test package `test/hello@1.0.0` as a person does, and stops that hub with SIGTERM, waiting for it to exit.
3. **The start under test:** `deep hub run`, no `--safe`, over the same home. Its ready line must not say `safe`.
4. An agent stand-in establishes a session through its hooks and asks its own `deep-actions` server (`deep mcp
   actions`): `find_actions` must list `ext.hello.greet` of `test/hello`, and `call_action` must run it and return
   `{ status: 'done', output: { greeting: 'hello, you, from test/hello', letters: 3 } }`, an output only the package's
   handler makes.
5. The hub's stderr must hold no line naming `test/hello` as not loaded or refused, and no line about safe mode.

## Readings

- **"The same hub".** The first criterion's: a hub started with `deep hub run` and one installed package. So the
  package is installed before the start under test, and the hub is started over that home; a hub that only loaded a
  package at the moment of its install would not show what a start does.
- **"Loads the package", on a surface a user sees.** The package's action reaches an agent through `deep-actions` and
  runs. A hub that didn't load the package registers none of its actions, so `find_actions` doesn't list it and the
  test fails naming `test/hello@1.0.0`, quoting any refusal line the hub wrote.
- **"Names no refusal".** The base's hub writes `deep hub: extension <id>@<version> not loaded: <reason>` for a package
  it refuses at its start. The test fails on any stderr line that names the package with "not loaded" or "refused", and
  on any line saying "safe mode".
- **The first hub is also started without `--safe`.** It only installs; nothing is asserted about it.

## Can it fail?

Yes: steps 4 and 5 fail when the package isn't loaded. The criterion names no wrong program and holds at the base, so
this job checked it with a scratch run, not kept (`BASE-RESULT.txt`): a temporary copy of the test changed the
installed package's file between the two starts, the second hub refused the package, and the test failed at step 4
naming `test/hello@1.0.0` and quoting the hub's refusal. Once #1879 is implemented, `--safe` in step 3 is the same
case: a fixed hub loads nothing.

The README command leaves a Vite cache in the suite's folder; remove it after a run:
`rm -rf tests/acceptance/1879-redraft-ac2/node_modules`.

## Files

- `start.test.ts`: the one test.
- `helpers.ts`: the environment, temp folders, the package copier, `deep` commands, the hub, the agent stand-in, the
  waits.
- `fixtures/hello/`: the test package `test/hello`, one read action `ext.hello.greet`. Its code carries a `.fixture`
  suffix so Vitest and `tsc` skip it; `pkg()` copies it, renames it and stamps the digest with the host's
  `packageDigest`.
- `fixtures/agent.mjs`: the agent stand-in, #363's, with a hook client that waits 60 s for the hub instead of 10 s.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-RESULT.txt`: both runs on the base commit.
