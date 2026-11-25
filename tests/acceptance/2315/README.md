# Acceptance tests for #2315: the hub's stacks run through ExtensionHost's environment@1 provider, never env-local by hand

A blind draft of #2315's acceptance tests. It was written from the issue (Scope, the three checkbox criteria, Proof),
the design and the base commit `fd9be7a70` (origin/main) only, by a job that saw no implementation of #2315 and no
other branch, PR or copy of this folder. The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute
goes to this job's blind redraft (design: Dogfooding). The folder is named `-redraft-waits` because the repo's wait
ratchet (`scripts/wait-ratchet.mjs`) judges a suite's files from zero: nothing here waits for time to pass. Each wait
is for an event: a hub's ready line, a reply on its socket, a command's exit, or a write to the replacement's log. Each
wait is bounded by a deadline marked `// deadline:`.

## What was read

- Issue #2315: its Scope, its criteria AC1 `#2315.9f5b8ef0`, AC2 `#2315.7023c897` and AC3 `#2315.5fe7fed4`, and its Proof.
- `docs/technical-design.md`: the env-local row of First-party extensions that ship on by default; Extension API
  (TypeScript, in-process), `deep.registerEnvironment`; the Hub slots table's `environment@1` row; The stack a check
  runs against. Also `AGENTS.md`.
- At the base, to learn the surfaces: `packages/hub/src/{env,core,hub-runtime,environment-port,core-providers,
  trusted-actions,install,workspace-actions,wire,server,paths,client,confirm}.ts`,
  `packages/extension-host/src/{index,host,trust}.ts`, `packages/record/src/trust.ts` and
  `packages/env-local/src/{index,stack}.ts`. Also the suites `331` (its helpers and its env-local package, whose
  `envLocal({ host })` fill the replacement reuses), `2648`, `350` and `67`, for their conventions.

## How to run

On macOS, with Node 24.22 first on `PATH`, from the repo root:

```sh
npm ci && npm run build --workspaces          # the tests run packages/cli/dist and the packages' dist entries
cargo build -p deep-hook                      # a dev hub won't start without target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2315-redraft-waits --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/2315-redraft-waits/tsconfig.json
```

- **Lane.** Each file starts its own dev hub and stacks on the ports that hub's leases pick, so the folder should run
  alone, as `tests/acceptance/331/` does. A `lane.json` can't say so: `LANE_FILE` takes digits-only folder names.
  Listing the folder in `scripts/lanes.mjs` is a signed edit, so this job left it to the owner.
- **Times** in the recorded base run: about 6 s a file; a passing run starts more stacks and waits for their teardown.
- **Safety.** Every folder is under `/tmp/dh2315-*`. `HOME` is a temp folder for the test process and every child, and
  the caller's `CLAUDE_*` and `DEEP_*` variables are removed first. Every hub is a dev hub (`deep hub run --root`) on a
  temp folder, with the OS confirmation stood in for (`DEEP_HUB_TEST_CONFIRM`). So nothing reaches a real hub,
  `~/.deepbuild` or the network. The suite stops only processes it started (hubs, `deep` commands) or that its server
  fixture wrote a PID file for, by PID, after checking that the PID still runs one of its programs. It never stops a
  process by name or port. With `--root`, Vitest writes `node_modules/.vite/` here: delete it before committing.

## The surfaces under test

- **`deep env up` and `deep env down`** (`--root <hub> --json`), run in a worktree of a test repo. The repo's
  `.deepbuild/done.yaml` starts `fixtures/server.mjs` on the leased port `web`, with its health route. The server writes
  `.pids/server.<pid>` in the folder it started in, so a test counts the stacks started there without asking the hub.
- **The replacement environment@1 provider**, `fixtures/recorder` (`tests/env-recorder@1.0.0`). It registers the
  environment `local` through `deep.registerEnvironment`, and its manifest declares `replaces: ["deepbuild/env-local"]`.
  Its fill is env-local's own `envLocal({ host })`, opened on a supervisor of its own, as #331's env-local test package
  does, so it passes environment@1's kit at install. Each call the host makes of it is written, once finished, as a
  JSON line to a log that nothing else writes: `up` with its checkout, leased port and handle, and `down` with the
  handle. The log also holds the install kit's own calls on its temporary checkouts, and the tests read only the lines
  for their worktree.
- **Installed and loaded through ExtensionHost.** The hub runs with `DEEP_HUB_TEST_RELEASE` (#2402) listing the
  package's digest, so it is a release package the hub loads in its own process. That matters because
  `host.environment(name)` serves only a hub-bound fill with a passing install kit. `swap.test.ts` and
  `disable.test.ts` install it into the running hub through the hub's own install path, `extension.install` on its
  socket as the cli role (#351: install, conformance with each slot's kit, then load). `trust.test.ts` installs it for
  a project through the extension host's public entry (`openExtensionHost`, `install` with `project`, `check`). That
  install runs on the dev hub's folder and its own record before the hub starts, with the project trusted through
  `openTrust`'s `answer`, as #2648's suite installs a package. The hub then loads it at its start.

### Choices: names the implementation has to provide

At the base the hub has no way to disable an extension or to revoke your trust in a project while it runs. The host's
`disable(id)` and project trust's `answer(…, false)` exist, but nothing in the hub reaches them. So these tests name
three surfaces, close to the hub's own:

1. **`extension.disable`** on the hub's socket, as the cli role, with `{ id }`. It disables the loaded package as
   `extension.restart` (#2402) restarts one, and replies with a result, not an error.
2. **`project.trust`** on the hub's socket, as the app role (project trust's trusted path), with
   `{ folder, trusted: false }`. It records your answer that the folder is no longer trusted, through the hub's project
   trust, and replies with a result, not an error.
3. **The refusal names the provider by its package ID** (`tests/env-recorder`), on `deep env up`'s stdout or stderr,
   with a non-zero exit and no `ready` status. The environment's name alone, `local`, is the name env-local's fill
   carries too, so it would not name the missing provider.

The tests also take two readings of the issue. "Stops its active handle" means the provider's own `down` ran for the
handle its `up` returned, and that stack's process no longer runs. The tests wait up to 120 s after the disable or
revoke for that `down`, not for the next `deep env up`. "Never silently falling back to env-local" means the refused
`deep env up` starts no stack in the folder, so no new server PID file appears there.

## Criteria to tests

| Criterion | Test (file › title) | Asserts |
| --- | --- | --- |
| AC1 `#2315.9f5b8ef0` | `swap.test.ts` › deep env up in a worktree asks the replacement's up, with the worktree as its checkout, and reports the stack it returned | exit 0, `ready`; one replacement `up` with the worktree as its checkout; the reported `web` port is its handle's; one stack in the worktree, running |
| AC1 `#2315.9f5b8ef0` | `swap.test.ts` › deep env down in that worktree asks the replacement's down for the handle its up returned, and the stack stops | exit 0; one replacement `down` for that handle; the stack's process stopped |
| AC2 `#2315.7023c897` | `disable.test.ts` › disabling the replacement stops the stack its up started, once, and the next deep env up refuses naming tests/env-recorder, starting no stack | the stack came up through the replacement; after `extension.disable`, its `down` ran once and the stack stopped; the next `deep env up` exits non-zero, isn't `ready`, names `tests/env-recorder`, starts no stack and asks no `up` |
| AC2 `#2315.7023c897` | `trust.test.ts` › revoking trust in the project the replacement came with stops the stack its up started, once, and the next deep env up refuses naming tests/env-recorder, starting no stack | the same, after `project.trust` with `trusted: false` on the project the replacement came with, run in that project's folder |
| AC3 `#2315.5fe7fed4` | none here | proven by running `tests/acceptance/331/`, `tests/acceptance/332/` and `tests/acceptance/580/` unchanged with the default shipped setup; no test in this folder carries AC3's tag |

## On the base

`BASE-FAILURE.txt` is the recorded run at `fd9be7a70`. All four tests fail at an assertion, for the expected reason:
the base's `deep env up` comes up `ready` through env-local, called directly, and the installed replacement is never
asked. Its log holds only the install kit's calls on its temporary checkouts. AC2's two tests stop at that same
assertion, because no stack is up through the replacement for a disable or revoke to stop. `tsc` on this folder passes.
`scripts/wait-ratchet.mjs`, `alone-lint.mjs`, `size-ratchet.mjs` and `repo-rules.mjs` print no finding naming a file
here. Their findings on main are other files'.
