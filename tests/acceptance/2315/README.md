# Acceptance tests for #2315: Stacks resolves its runtime provider through ExtensionHost instead of hardcoding env-local

Written first, blind, from issue #2315 (its Scope, the three checkbox criteria and Proof, as of November 23, 2026),
`docs/technical-design.md` (the env-local row of First-party extensions that ship on by default; Extension API,
`deep.registerEnvironment`; the Hub slots table's `environment@1` row; The stack a check runs against), `AGENTS.md`,
and the code at the base commit `118ec119f` (origin/main): the hub's `deep env` command and core wiring, the
extension host's public entry, the `environment@1` kit, and the conventions of the acceptance suites of #331 and
#2648. No implementation of #2315 was seen. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job.

The issue has three checkbox criteria, AC1 to AC3 in the body's order.

## How to run

On macOS, with the repo's Node 24 first on `PATH`:

```sh
npm ci                                  # once, if node_modules is missing
npm run build --workspaces              # the tests run the built CLI (packages/cli/dist/main.js) and conformance dist
cargo build -p deep-hook                # the hub refuses to start without target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2315 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2315/tsconfig.json   # type check
```

- Each test starts its own dev hub (`deep hub run --root <temp folder>`) and its stacks on ports the hub leases on
  127.0.0.1. Nothing needs the network, Docker or a GPU, and nothing is timed.
- Every folder is under `/tmp/dh2315-*`; `HOME` is a temp folder for the test process and every child; the agent's
  own `CLAUDE_*` and `DEEP_*` variables are removed first, so nothing reaches a real hub or `~/.deepbuild`. The suite
  stops only processes it started, or that the provider's log or env-local's markers name, by PID, after checking
  the PID still runs one of its programs (`helpers.ts`, `cleanup`); never by name or port.
- With `--root` here, Vitest writes its cache to `tests/acceptance/2315/node_modules/.vite/`; delete that folder
  before committing.

## The surface under test

- **The replacement provider** (`fixtures/swap`): an extension package `test/env-swap` whose manifest declares
  `"environments": ["swap"]` (the key #331's suite established) and whose `index.ts` calls
  `deep.registerEnvironment('swap', { slot: 'environment@1', revision: 1, up, down })`. Its fill is the
  `environment@1` kit's own reference fill (`cleanFills(kit)` from the built `@deepbuild/conformance` entry), so it
  passes the kit. Each call is appended, before the reference fill runs, to a log outside the package (`up` with its
  spec, lease and checkout; `ready` with the handle; `down` with the handle). A spec field the caller leaves out is
  filled from the lease (token) or a default (`/health`, no warm-up); the kit always passes all three, so this
  changes nothing the kit judges. The name `swap` is the fixture's; the tests require no particular name.
- **Installing and loading it** ("kitted"): installed into the hub's home with no hub running, through
  `openExtensionHost`'s public entry (`host.ready()`, `host.install`, `host.check`), with DeepBuild's release listing
  it so it is hub-bound and `environment@1`'s kit runs at install, as #2648's and #331's suites install packages. The
  test is BLOCKED unless `Installed.kits` holds `{ slot: 'environment@1', fill: 'swap', verdict: 'PASS' }` and its
  conformance passes. The hub is then started with `DEEP_HUB_TEST_RELEASE` naming that release, and loads every
  installed package at start (`core.ts`, `extensions.installed()` → check → load). The kit's own calls at install
  are dropped from the log before the hub starts.
- **`deep env up` / `deep env down`** (`packages/hub/src/env.ts`), run as a person runs them in a worktree, with
  `--root <hub> --json`. The worktree's `.deepbuild/done.yaml` has env-local's `environment:` block (#331's README):
  `up` runs the repo's own dev server (a copy of `fixtures/local-server.mjs` committed in the repo), `ports: [web]`,
  `ready: { http: "http://127.0.0.1:${web}/health", within: 20 }`. Only env-local reads `up`; the server leaves
  `.envlocal/ran.<pid>` in the folder it started in, so its absence proves env-local did not run.
- **`extension.restart`**, the hub's socket method (cli role) behind restarting an extension from your terminal
  (#2402).

## Criteria to tests

Each `describe` carries the criterion's ID, `#2315.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace
collapsed, `- [ ] ` dropped), and each test's name starts with its criterion.

| ID | Criterion (short) | Test (`provider.test.ts`) | At this base |
|---|---|---|---|
| AC1 `#2315.9f5b8ef0` | a kitted replacement gets `deep env up` and `down`, not env-local | AC1 (1) | fails: env-local's stack runs, the replacement's up is never asked |
| AC2 `#2315.7023c897` | provider disabled or untrusted: its active handle stops; `deep env up` refused naming it; no fallback | AC2 disabled in the running hub (1); AC2 trust revoked (1) | fail: env-local runs regardless (the first never reaches the disable; the second's up comes up ready on env-local) |
| AC3 `#2315.5fe7fed4` | with the default shipped setup, 331, 332 and 580 pass unchanged | none here | proven by running those suites (below) |

### How each criterion is read

- **AC1.** "Invoke that provider's up": `deep env up` in a worktree must ask the replacement's `up` with that
  worktree as its checkout (the design: env-local starts "your worktree for `deep env up`"; a replacement takes its
  place), exit 0 and report `ready`, and env-local's marker must be absent. "And down": `deep env down` in the same
  worktree must ask the replacement's `down` with exactly the handle its `up` returned, once, and exit 0.
- **AC2, disabled.** The hub publishes no way to disable an extension (no socket method or CLI reaches
  `host.disable`). The one reachable way a running hub unloads a loaded provider and keeps it unloaded is
  `extension.restart` refused: the test changes the installed package's files after its conformance ran
  (`Installed.folder`), and the restart unloads it (the host's own unload, the path `disable` takes too) and
  refuses to load it again, its files' digest no longer the one checked. The test is BLOCKED unless the restart
  answers `refused`. Then: the active handle (from a `deep env up` in worktree A through the replacement) is
  stopped, its `down` asked with that handle exactly once and its process gone within 15 s; and a `deep env up` in
  worktree B exits non-zero, isn't `ready`, says the provider's name (`swap` or `test/env-swap`) on stdout or
  stderr, never asks the replacement's `up` again, and env-local's marker is absent in B.
- **AC2, trust revoked.** The hub's trust for a first-party package to run in the hub is DeepBuild's release (core:
  "sandboxed until a signed release lists it"; `host.environment` refuses a fill whose package has no passing
  install kit in the release). Project trust (`trust.answer`) applies only to a project's packs and is set only
  from the app's trusted path, which a dev hub's socket doesn't reach, so the test reads "revoking trust" as: a hub
  that loaded the provider (its release listing it; BLOCKED unless `extension.restart` answers `restarted`) is
  stopped and started again on the same home, the package still installed, with a release that no longer lists it.
  Then `deep env up` must exit non-zero, not be `ready`, name the provider, never ask its `up`, and env-local's
  marker must be absent. This test proves only the refusal half: the restarted hub has no active handle of the
  earlier load (stopping a hub ends its stacks anyway). The handle half is proven by the disabled test.
- **AC3.** No new test: it is proven by running, unchanged, on the change with the default shipped setup (no
  replacement installed, no `DEEP_HUB_TEST_RELEASE`):

  ```sh
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/331 --no-file-parallelism
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/332 --no-file-parallelism
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/580 --no-file-parallelism
  ```

  each against its own README's run instructions and its known BLOCKED/environmental results on this Mac (for
  example 331's AC11 without Docker), compared with the same suites on the merge base: no test that passes on the
  base may fail on the change.

## Wrong programs

None is planted. The base is AC1's and AC2's wrong program: its `core.ts` wires `Stacks` to env-local directly, so
env-local's stack runs whatever provider is loaded, and nothing refuses (BASE-FAILURE.txt).

## Files

- `helpers.ts`: temp folders, the test repo and worktrees, the replacement package and its log, its install through
  the extension host's entry, the dev hub as a process with the release, the line-protocol client, `deep env up` /
  `down`, cleanup by PID.
- `provider.test.ts`: AC1, AC2 (two tests).
- `fixtures/swap/` (`deepbuild.json`, `index.ts.fixture`, renamed `index.ts` in the copy installed, so neither Vitest
  nor the type check picks it up): the replacement provider.
- `fixtures/local-server.mjs`: env-local's stack, which leaves its marker.
- `tsconfig.json`: as #331's, with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
