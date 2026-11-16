# #2594 — socket creation must not strip the core's directory search bits

Frozen authoring base: `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`.
Inputs: issue #2594, `AGENTS.md`, the installation/platform and proof sections of
`docs/technical-design.md`, and this base's code/tests. No implementation changes,
other worktree, network, build or test run were used.

## Criterion → assertions → wrong program

| Criterion (verbatim) | Behavioral assertions | Wrong program |
| --- | --- | --- |
| AC1: While the hub makes its socket, a folder the core makes at the same time gets the mode the core asked for | `startup.test.ts`: an actual core worker in the hub PID completes the issue's `agents/syncs` mkdir while the main thread is held inside socket creation; requested mode is 0700, no mkdir error, both `agents` and `syncs` are directories with mode exactly 0700 **before main is released**; hub reaches ready and serves its hello | Base: process-wide 0177 remains active over this forced window, so mkdir throws EACCES or creates mode 0600. An after-start chmod repair cannot erase the captured failure/mode. Root privileges cannot conceal the mode assertion. |
| AC2: The socket still can't be opened by another user, from the moment it exists | `startup.test.ts`: immediately after native Unix listen, before any hub callback or post-listen chmod, the socket belongs to the owner and either its mode excludes group/other access (Linux), or a hub-controlled ancestor denies search to both group and other (Linux/macOS). Final mode is 0600; owner opens it and gets the real hub hello. Reuse `../16/socket.test.ts` AC4 unchanged for installed/dev roots, ownership, mode after serving hooks and restart. | A removal of the umask without protecting the path/socket exposes permissions under incoming umask 000 and fails AC2. A post-listen chmod alone cannot hide that observation. If a private hub directory already prevents access, it correctly satisfies confidentiality, rather than requiring the old umask mechanism. |

AC2 is regression protection, not the expected base failure. Existing #16 AC4
polls with `setImmediate`; that is useful steady-state/restart coverage but can
miss a transient exposure. The one new test adds the missing boundary observation
and simultaneous core operation, not a duplicate restart or dev-root suite.
`tests/acceptance/2573/` is absent from this base.

## Deterministic schedule and real components

`spawnHub` from #16 starts the built `deep hub run` CLI under umask 000, with a
fresh HOME. `overlap.mjs` is a normal Node `--import` preload, inherited by workers.
It wraps only external Node boundaries: `fs.mkdirSync` and `net.Server.listen`.
Every intercepted operation delegates to the original with unchanged arguments;
errors are rethrown. There is no core stand-in, replacement worker, production
import, source-text assertion, loader rewrite, environment-controlled production
hook, or alteration of umask by the preload.

The worker's real mkdir for the path explicitly named in the issue waits for the
socket boundary. Main delegates to real listen, captures socket/ancestor metadata,
then releases mkdir and waits for its result before returning from listen. Thus
neither a fast worker nor a fast listen callback can avoid the overlap. Small
bounded file-handshake waits are synchronization, not race retries. Reports use
atomic rename; the main thread cannot observe a partial result. The named mkdir,
PID/thread identity, and both reports must be observed; an instrumentation failure
is explicitly BLOCKED, never an empty-log success. Reports are outside the hub
root, in the disposable HOME. Cleanup uses the existing PID-owned #16 helper.

The observation targets the issue's filesystem paths and Node boundaries, not
private hub classes, source line numbers, worker filenames, or workerData shape.
A refactor that changes the named filesystem operation or stops inheriting Node
preloads needs independent review of this frozen test; a missing handshake is
not evidence that the criterion passed.

## Run commands (from repository root, implementing job only)

Use the repository's required Node version (>=24.22), installed dependencies and
native build toolchain. Build this checkout, not another worktree's artifacts:

```sh
npm run build --workspaces
node node_modules/vitest/vitest.mjs run tests/acceptance/2594/startup.test.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/16/socket.test.ts -t 'AC4'
```

Run the frozen files against base, then unchanged against the fix. Preserve both
outputs, including BLOCKED diagnostics. The second command must fail at AC1 on
base; a missing module/build/native prerequisite or missing report is not the
required red proof. The reused AC4 command keeps both existing installed/dev
cases and all their assertions. No pre-existing test or check was modified.

## Limits and unrun checks

- **UNRUN:** all builds, tests, typechecks, base failure and fixed pass. Only
  read-only inspection and authoring occurred. No claim of a proven red/green run.
- POSIX discretionary permissions on a normal local filesystem are the
  confidentiality oracle, as in #16. No second user is created and no credential
  switching is required; this is not an actual cross-UID connect probe. Root and
  capabilities that bypass DAC are outside “another user”. ACL/security-policy
  environments that invalidate this POSIX oracle require separate proof and must
  be reported **BLOCKED**, not treated as covered by these mode assertions.
- macOS does not get credit for socket mode alone: a non-searchable hub-controlled
  ancestor is required. The test's temporary ancestor and HOME are deliberately
  searchable and never counted as protection.
- Native Node Unix `listen` must expose the socket synchronously. The observation
  occurs before control returns to hub JavaScript, so a later hub chmod cannot
  repair the evidence. This does not instrument arbitrary native code inside
  Node/libuv or a separate helper process; a replacement native socket-creation
  mechanism requires its own creation-time proof. Missing boundary observations,
  unsupported platforms (including Windows), and handshake timeouts explicitly
  fail as **BLOCKED**, never skip or pass.
- Coverage is one deterministically forced startup interleaving, not a stress
  test, ACL audit, login-service test, or proof of recovery from old damaged roots.
  Existing final-mode/restart checks remain required and unchanged.
