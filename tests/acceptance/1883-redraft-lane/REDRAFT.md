# #1883 blind redraft for the proof lane: the same three tests, each with its own timeout

The frozen suite `tests/acceptance/1883/` (commit `6e143b48f`) has one file, `trust.test.ts`, with three tests: AC1
`#1883.cba928bb`, AC2 `#1883.6b16b1ac`, AC3 `#1883.dd68075b`. Run as its README says (`--root tests/acceptance/1883
--testTimeout=300000`) they read as they should. In the repo's proof lane (`node scripts/affected.mjs`), which runs
vitest with the root `vitest.config.ts` and passes no `--testTimeout`, all three fail with "Test timed out in 5000ms":
each test makes a world, starts a real `deep hub run`, raises and answers an approval and runs `deep start`, which
takes longer than vitest's 5 s default. The hub-starting suites in this repo give each test its own timeout
(`}, 180_000);` / `}, 600_000);` in `tests/acceptance/2119` and `1856`); the frozen suite gives none. No criterion is
in dispute and none is touched: only the test's own time limit is.

## What was read

- Issue #1883 (2026-11-16): Scope, the three criteria, Proof, Depends on (#1330).
- `docs/technical-design.md` (Dogfooding; How it installs) and `AGENTS.md` (Proof).
- The frozen suite at `6e143b48f`: `README.md`, `trust.test.ts`, `helpers.ts`, `fixtures/claude.mjs`,
  `tsconfig.json`, `BASE-FAILURE.txt`; and the hooks in `tests/acceptance/1330/helpers.ts`, which it imports.
- At the base `c740dede7`, for surfaces and conventions only: `vitest.config.ts` (`include: testGlobs('ts')`, the
  setup file, no `testTimeout` or `hookTimeout`), `scripts/lanes.mjs` (`testPaths`, `testGlobs`, `alone`),
  `tests/vitest-setup.ts` (its `afterAll`), and the per-test timeouts of `tests/acceptance/2119` and `1856`.
- `tests/acceptance/823-redraft-2073/REDRAFT.md` and `tests/acceptance/1417-redraft-ac1/` for form.

I never read an implementation of #1883, a diff, a pull request, another branch or another worktree.

## What changed, test by test

| Frozen test (`1883/trust.test.ts`) | Criterion | In the redraft (`1883-redraft-lane/trust.test.ts`) |
|---|---|---|
| with ~/.claude.json a symlink to a file elsewhere, a start that records trust leaves it a symlink and writes the trust key into its target | `#1883.cba928bb` | The same name, body and assertions, with the test's timeout `TEST_TIMEOUT` (720 s) |
| with ~/.claude.json a regular file, the start writes byte for byte what the merge base writes | `#1883.6b16b1ac` | The same name, body and assertions (the expected bytes spelled out line by line), with `TEST_TIMEOUT` |
| a planted Starts.trust that renames over the link (trust-renames-over-link) fails the first criterion, naming the path | `#1883.dd68075b` | The same name, body and assertions, with `TEST_TIMEOUT` |

The only other change is the import line: `from '../1883/helpers.ts'` in place of `from './helpers.ts'`, and the
file's header comment. `diff tests/acceptance/1883/trust.test.ts tests/acceptance/1883-redraft-lane/trust.test.ts`
shows exactly that, the `TEST_TIMEOUT` constant and its comment, and the three `}, TEST_TIMEOUT);` lines.

**Why 720 s.** It is past the sum of the frozen helpers' own bounds on one test: 120 s for the hub's ready line
(`runHub`, else BLOCKED), 15 s for the `ask.created` event (`waitFor`), 180 s for each of the three `deep` commands
(`deep`, killed past it): 675 s. So a step that hangs ends with the helper's own message (a BLOCKED hub, a killed
command and its exit), never with vitest's timeout, which would say nothing about the criterion. A test that runs as
it should takes seconds (BASE-RESULTS.txt).

**Hooks.** No hook timeout is added. The world is opened inside each test, not in a hook, so the test's timeout
covers it. Teardown is the frozen helpers' `afterAll` (`1883/helpers.ts` and `1330/helpers.ts`), each declared with
its own `120_000`, which hold under the root config; the root setup file's `afterAll` (`tests/vitest-setup.ts`) only
holds left processes and is fast. Under vitest's default `stack` order the helpers' hooks, registered after the setup
file's, run before it.

## Kept as they are

- `tests/acceptance/1883/helpers.ts` and `fixtures/claude.mjs`: imported by path, not copied; nothing there had to
  change. The fixture is read by `helpers.ts` relative to its own folder, so it is the frozen one.
- `tests/acceptance/1883/README.md`'s readings (the start, the stand-in, how each criterion is read, known limits)
  all hold for this file unchanged.
- The world, the start, every scenario, every assertion and every message, the criteria's IDs in the test names.

## Run it

Linux or macOS, the repo's Node, from the repo root, after `npm ci`, `npm run build --workspaces` and
`cargo build --locked -p deep-hook` (as the frozen README says):

```sh
# The lane's own config (root vitest.config.ts: its include, setup file and no --testTimeout)
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1883-redraft-lane
# As the frozen README runs its folder, with no config file and no --testTimeout
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1883-redraft-lane
# Through the proof lane's own command
node scripts/affected.mjs tests/acceptance/1883-redraft-lane/trust.test.ts
# Typecheck
node node_modules/typescript/bin/tsc -p tests/acceptance/1883-redraft-lane/tsconfig.json
```

The folder needs `tests/acceptance/1883/` beside it (this commit sits on `6e143b48f`, the frozen suite's commit,
whose parent is the base). The `affected.mjs` line was not run by this job (its brief excluded it); the first line
runs the same config the lane runs vitest with.

In a worktree nested under another checkout, cargo also reads the enclosing checkout's `.cargo/config.toml`; at the
base that broke `cargo build --locked -p deep-hook` here, so deep-hook was built from `git archive c740dede7` outside
it with `--target-dir` this checkout's `target` (BASE-RESULTS.txt).

## At the base

At `6e143b48f` (the base `c740dede7` plus the frozen suite only), both ways: AC1 FAIL for the issue's reason (the
path became a regular file, its target unchanged, naming the path), AC2 PASS, AC3 BLOCKED (the base lists no plant
`trust-renames-over-link`, so its hub refuses to start). No test times out. BASE-RESULTS.txt has both runs.

## At merge

The frozen `tests/acceptance/1883/trust.test.ts` stays as written: this job doesn't edit it, and nor does the
implementing agent. Whether to swap it for `tests/acceptance/1883-redraft-lane/trust.test.ts` as #1883's proof in the
lane (keeping `1883/helpers.ts` and `1883/fixtures/`, which this file imports) is the owner's call. Not decided here:
whether the folder joins `scripts/lanes.mjs`'s `alone` list, as other hub-starting suites do.
