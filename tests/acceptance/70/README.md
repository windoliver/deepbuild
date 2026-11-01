# Acceptance tests for #70, AC4: the bubblewrap backend passes the platform sandbox's suite

Written first, blind, from issue #70 (its text as of November 1, 2026: Scope, "bubblewrap with seccomp and Landlock
as the platform sandbox's Linux backend (#236)", its fourth checkbox criterion, Proof and References),
`docs/technical-design.md` (How it installs, its Platforms list, the sandbox bullet; Decided, the rows Grants and the
sandbox and Linux; the Access primitive, "hosts (the hub, which makes every outside call, and the supervisor's egress
filter)"), `AGENTS.md`, the acceptance tests of #236 for their conventions and for the seam suite they defined
(`tests/acceptance/236/README.md`, The surface under test, The suite's cases, AC5 and AC9), and the base commit
`6119bfa5` (`origin/main`), by a job that never saw an implementation of #70. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

This folder covers one criterion of #70's six, the fourth in the body's order:

| AC | Tag | Criterion | File |
| --- | --- | --- | --- |
| AC4 | `#70.ef8d1e25` | The bubblewrap backend passes the platform sandbox's suite (#236) on both distributions, and the planted backend that allows egress still fails it there; a profile without its network filter fails the egress case, naming it | `suite.test.ts` (3) |

The tag is `#70.<first 8 hex of the SHA-256 of the criterion's text>` (trimmed, whitespace collapsed, `- [ ] `
dropped), as `scripts/proof-change.mjs` computes it. The other five criteria are other jobs' folders.

## How to run

On Linux, on Ubuntu LTS or Fedora, with bubblewrap installed at `/usr/bin/bwrap`, `cc` (gcc or clang), the repo's
Node (`.node-version`, 24.22.0) and user namespaces enabled:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the seam suite runs the supervisor's built helper, packages/supervisor/dist/helper
npx vitest run --root tests/acceptance/70
node node_modules/typescript/bin/tsc -p tests/acceptance/70/tsconfig.json   # needs packages/supervisor
```

- The test runs on the Linux it is on and names the distribution it ran on, from `/etc/os-release`, in its output
  (`#70 AC4 on Ubuntu 24.04.5 LTS (arm64), bubblewrap 0.9.0 at /usr/bin/bwrap`) and in every assertion message.
  "On both distributions" is beyond one machine: the criterion is proven only by this folder passing on an Ubuntu LTS
  and on a Fedora, each run recorded.
- It is BLOCKED, by throwing, never a pass by skipping, off Linux, on a distribution that is neither Ubuntu (LTS) nor
  Fedora (by `ID` or `ID_LIKE`), or where `/usr/bin/bwrap` is missing. A machine without `cc` fails the two tests that
  need the probe as BLOCKED, naming the compile.
- Nothing needs the network: every "host" is a listener the test runs on 127.0.0.1, every "hub's socket" and "inbox
  socket" a Unix socket listener the test runs.
- The probe is `tests/acceptance/236/fixtures/probe.c`, compiled once per test process with `cc` into
  `/tmp/dh70-bin-*`. Only that fixture: #236's `bins()` also builds `devices.m` against macOS frameworks, which can't
  build here, so `helpers.ts` has its own small build.
- Every test makes its folders under `/tmp/dh70-*` (real paths, short enough for a socket path), sets `HOME` to a temp
  folder for itself and every child, removes the agent's own `CLAUDE*` and `DEEP_*` variables from its environment
  first (so no sandbox failure can ever reach a real inbox socket or hub), and never touches the real `~/.deepbuild`
  or a user service. It stops only processes it started, by PID; never by name or port.
- With `--root` here, Vitest may write its cache to `tests/acceptance/70/node_modules/.vite/`; delete that folder
  before committing.

## The surface under test

The criterion names the bubblewrap backend, the platform sandbox's suite of #236, the planted backend that allows
egress, and "a profile without its network filter", but no code API. #236's tests already defined the seam
(`SandboxBackend`, `Grant`, `Launch`), its suite (`sandboxSuite`) and its plants (`plantedBackends`) through
`@deepbuild/supervisor`'s public entry, `packages/supervisor/src/index.ts`, and the design says the Linux backend
runs the same `sandboxSuite` when it lands. These tests add the smallest surface that reaches AC4, on that entry:

<!-- SURFACE:BEGIN -->
```ts
// packages/supervisor/src/index.ts (public entry), beside #236's exports, which stay as they are.

/** The Linux backend of the sandbox seam: bubblewrap with seccomp and Landlock (design: Platforms, the sandbox). */
export const bubblewrap: SandboxBackend;      // name 'bubblewrap', platform 'linux'

/**
 * #236's planted backends, each built for the fixtures it will be run with, with one more key. On Linux each is
 * the bubblewrap confinement one rule wider, so `plantedBackends(fixtures).egress.platform === 'linux'` there;
 * 'no-network-filter' is bubblewrap's confinement built with its network filter (the egress part) left out, named
 * apart from `bubblewrap.name`.
 */
export function plantedBackends(fixtures: SuiteFixtures):
  Record<'egress' | 'write-outside' | 'hub-socket' | 'camera' | 'no-network-filter', SandboxBackend>;

// Unchanged from #236, as the tests reach them:
export function sandboxSuite(backend: SandboxBackend, fixtures: SuiteFixtures): Promise<SuiteResult>;
export interface SuiteFixtures { hubSocket: string; inboxSocket: string }
export interface SuiteResult { backend: string; passed: boolean; cases: { name: string; ok: boolean; detail: string }[] }
export interface SandboxBackend { readonly name: string; readonly platform: NodeJS.Platform; confine(launch: Launch, grant: Grant, run?: string): Promise<Launch> }
```
<!-- SURFACE:END -->

Nothing else is needed: no option, flag or export beyond these. What the tests hold the surface to:

- **`bubblewrap`** is the seam's Linux backend: `platform === 'linux'`, `name === 'bubblewrap'`. Its `confine` returns a
  launch that runs the process under bubblewrap, confined to the grant as #236's README holds Seatbelt to it: the run's
  folder and `grant.read` paths readable (their programs runnable), `grant.write` paths writable, the system's own
  runtime readable and runnable, everything else denied with `EPERM` or `EACCES`, every local socket and every host the
  grant doesn't name included. The suite's `hosts` case is paired: a granted `127.0.0.1:<port>` must be reachable while
  a port no grant names is refused by the filter with `EPERM` or `EACCES`, so a backend that unshares the network and
  reaches nothing fails the suite too (`ECONNREFUSED` or `ENETUNREACH` is no denial).
- **The suite's cases**, as #236's README names them: `egress`, `write-outside`, `read-outside`, `hub-socket`,
  `inbox-socket`, `camera`, `microphone`, `audio-output`, `screen-capture`, every one run on Linux. The device cases
  read the supervisor's own helper, as on macOS; what "denied" means for a device on Linux is the implementer's, read
  by the suite, and this folder holds only that the case is there and `ok`.
- **The plants on Linux** are bubblewrap's confinement one rule wider, each a real wrong program (the tests probe
  `egress` and `no-network-filter` through their `confine` with a probe of their own, so a suite that knew its plants
  by name couldn't pass), and `plantedBackends(fixtures).egress.platform === 'linux'` there. The egress plant and the
  profile without its network filter may be built alike (on Linux, "one rule wider" on the network may be "the filter
  left out"); each is still its own key, with its own name, and each fails exactly `egress`.
- **"A profile without its network filter"** is reached as `plantedBackends(fixtures)['no-network-filter']`, a
  `SandboxBackend` whose confinement is bubblewrap's with its network filter (the seccomp or Landlock part that
  enforces `grant.hosts`, the design's "egress filter") left out and everything else kept. The suite must fail it
  naming `egress` and no other case (the other eight pass), `result.backend` must be its name, and the failed case's
  `detail` says what happened.

## Criteria to tests

Each test's name starts with `AC4`, and the `describe` carries the criterion's ID `#70.ef8d1e25`. A test headed
`(wrong program)` runs the suite against the planted twin the criterion names and expects it to fail as the criterion
says; the scenario itself must run, so a plant that doesn't start fails that test.

| Test | What it holds | At this base |
|---|---|---|
| `AC4 the suite passes on bubblewrap, every case run, and nothing reached the hub's or the inbox socket` | `bubblewrap.platform === 'linux'`, `name === 'bubblewrap'`; `sandboxSuite(bubblewrap, fixtures)` has every one of the nine cases and `passed === true`; the test's hub and inbox socket listeners got no connection | fails: `bubblewrap` isn't exported (`TypeError`) |
| `AC4 (wrong program) the planted backend that allows egress is a bubblewrap one here, and still fails the suite, naming the egress case` | `plantedBackends(fixtures).egress.platform === 'linux'`; the suite fails it with `passed === false` and exactly `['egress']` failing, its `detail` non-empty; through the plant the test's own probe connects to a TCP listener no grant names (the listener sees the connection), through `bubblewrap` the same connect is denied with `EPERM` or `EACCES` and the listener sees nothing | fails at its first assertion: the base's egress plant is Seatbelt's, `platform 'darwin'` |
| `AC4 (wrong program) a profile without its network filter fails the suite's egress case, naming it, and no other case` | `plantedBackends(fixtures)['no-network-filter']` exists, `platform 'linux'`, named apart from `bubblewrap`; the suite fails it with exactly `['egress']`, `result.backend` its name, the egress case's `detail` non-empty; through it the probe reaches a listener no grant names | fails at its first assertion: no such key at the base |

## Readings

- **"On both distributions."** Ubuntu LTS and Fedora, from the first criterion and Decided's Linux row. One machine
  runs one; the test names the one it ran on and is BLOCKED elsewhere. The proof is two recorded runs.
- **"Passes the platform sandbox's suite (#236)."** `sandboxSuite` as #236 defined it, every case it has run and `ok`,
  not a Linux subset: the device cases included. The suite's fixtures are the test's own listeners, which must see no
  connection.
- **"The planted backend that allows egress still fails it there."** `plantedBackends(fixtures).egress`, which on
  Linux must be the Linux backend's plant, not Seatbelt's (a Seatbelt plant on Linux can't run, and a suite result on
  it would prove nothing). "Still fails": `passed === false` with `egress` the one failing case of the nine.
- **"A profile without its network filter."** The design gives the sandbox three parts: "an egress filter, path
  containment and no local socket its grant doesn't name"; a profile is a backend's confinement, and "without its
  network filter" is that confinement with the egress part left out. It is a wrong program a test can select, so it
  is a planted backend with a key of its own, `'no-network-filter'`, rather than an option on the real backend (no
  weaker mode under the same name: Decided, Grants and the sandbox).
- **"Fails the egress case, naming it."** `failing(result)` equals `['egress']`: the egress case is `ok: false` with a
  non-empty `detail`, the other eight are `ok`, and `result.backend` names the profile that ran.
- **"Denied."** `EPERM` or `EACCES` from the probe's own `connect`, as #236 reads a sandbox denial and the suite's
  `refused` does; Landlock denies with `EACCES`, seccomp with whatever errno the filter returns, which must be one of
  these. A connection refused because nothing listens inside an unshared network namespace is not a denial.

## Proof on a wrong program

The criterion names its two planted wrong programs, and both are in the surface: `plantedBackends(fixtures).egress`
(bubblewrap one rule wider on the network: a host no grant names is reachable) and
`plantedBackends(fixtures)['no-network-filter']` (bubblewrap with its network filter left out). The before lane's
twin for each is the surface itself: the implementer's plants. The test holds each to its own case and probes each
with a program of the test's own, so a plant that misbehaves only for the suite's fixtures, or a suite that
recognizes its plants by name, fails here.

| Plant | What it does | How the test fails on it |
|---|---|---|
| `plantedBackends(f).egress` | lets a sandboxed process connect to a host its grant doesn't name | the suite fails `egress` and nothing else; the probe reaches the test's listener |
| `plantedBackends(f)['no-network-filter']` | bubblewrap's confinement without its network filter | the suite fails `egress` and nothing else; the probe reaches the test's listener |

The first test (the suite passes on bubblewrap) names no twin. At the base it fails with a `TypeError` (no
`bubblewrap` export), which is no assertion; the mutation lane is its wrong program past that. The two `(wrong
program)` tests fail at the base at their first assertion, on the base's real `plantedBackends` (`BASE-FAILURE.txt`).

## Files

- `helpers.ts`: the Linux gate and the distribution's name, temp folders under `/tmp/dh70-*`, the probe's build from
  #236's `fixtures/probe.c`, what the probe wrote, listeners, and cleanup by PID.
- `suite.test.ts`: the three AC4 tests.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
