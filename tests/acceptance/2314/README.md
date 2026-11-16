# #2314 — supervised check probes (blind acceptance)

Drafted only from `ISSUE-2314.md`, `AGENTS.md`, the supplied base
`1c4d1f0e2aaad8c6a6573848823566d04ff73d17`, and the design's **One hub per user**,
**Blocks for plug-ins that host something live**, **One host contract**, and
**Dogfooding** sections. No implementing checkout was read. These tests are frozen
for delivery; implementation must copy them unchanged.

## Criterion → assertion

| Issue criterion | Proof in `probes.test.mjs` |
| --- | --- |
| AC1: checks-numbers records tracked/ended through the extension host and real supervisor | The real public `numbersFill().run` executes a SQLite query returning the stated `7`; asserts `passed`, one assertion, no failures, then fresh `core`-written `process.tracked` events for this checkout and matching later `process.ended` events for every tracked PID/run. |
| AC1: checks-work does the same | The same path using public `workFill('data').run`, with expected row `{n: 7}`. One work kind suffices to exercise that package's probe runner; no duplicate numeric/data semantics suite. |
| AC2: detached descendant is gone when an overran run resolves | A hub-bound check calls public `@deepbuild/conformance/findings.runProbe` with `fixtures/detached-probe.mjs`. OS observations establish its child belongs to the probe, is alive, and leads a different process group. The child sleeps 60 s, beyond the 4 s deadline. Snapshot liveness in the run promise's resolution callback; require `overran` and already absent, then require tracked/ended records including the child. No post-resolution grace or cleanup can satisfy the liveness assertion. |
| AC3: compatibility | Existing `tests/acceptance/68/` and `tests/acceptance/87/` remain the checks, unchanged and not duplicated here. **UNRUN** in this drafting job. |

The temporary release-listed extension is a thin adapter, not a substitute runner:
public fills receive the original host context. Its names are namespaced as the
manifest requires. Installation and sandboxed conformance registration run for
real; their events are excluded by each test's log-position watermark. The real
`openExtensionHost`, `openSupervisor`, record and asks are used with no supervisor
mock, planted backend, `own_sandbox`, environment preload, or sandbox exemption.
The custom probe is needed because the production SQLite probes expose no command
injection surface; it tests their shared **public** probe API without editing them.

## Build and run (repository root; no network)

Requirements: Node **>=24.22.0**; already-installed workspace dependencies and a
working `better-sqlite3` native binding; `cc`; and a usable real platform sandbox:
macOS Seatbelt (`/usr/bin/sandbox-exec`), or Linux bubblewrap with the supervisor's
required namespaces, Landlock and seccomp support. `/bin/ps` must expose
`pid,ppid,pgid,lstart,args`. Unsupported/unusable environments are BLOCKED, not
skipped or replaced with an unsandboxed host. Linux was not exercised here.

Build exactly the package dependency closure used by this file:

```sh
npm run build \
  --workspace=@deepbuild/contracts --workspace=@deepbuild/adapters \
  --workspace=@deepbuild/evidence --workspace=@deepbuild/record \
  --workspace=@deepbuild/asks --workspace=@deepbuild/conformance \
  --workspace=@deepbuild/leases --workspace=@deepbuild/budget \
  --workspace=@deepbuild/supervisor --workspace=@deepbuild/runner \
  --workspace=@deepbuild/extension-host --workspace=@deepbuild/verdicts \
  --workspace=@deepbuild/checks-numbers --workspace=@deepbuild/checks-work
```

This builds the platform supervisor helper too. Tests resolve **built public
package exports**; do not add the `development` condition or run against stale
`dist` files. No Rust build or network service is needed by the new test itself.

Normal verification, in a git checkout with local Cargo metadata available:

```sh
node scripts/affected.mjs tests/acceptance/2314/probes.test.mjs
```

Exact isolated test invocation (used for the saved base result):

```sh
node --test --test-concurrency=1 --test-reporter=spec tests/acceptance/2314/probes.test.mjs
```

Allow 60 s for the suite. Both fixture processes have a finite 60 s safety lifetime.
Teardown signals only observed test PIDs after checking their recorded start time,
or asks this test's supervisor to clean run tokens from its private record. It
never stops by name or port. The random child marker identifies the fixture for
observation only; the parent relationship is checked before recording its PID.

## Observed base proof and limitations

- Dependency-closure build and setup imports succeeded on macOS, Node v24.22.2.
- Two setup-only attempts failed manifest validation before any test body ran:
  bare check names, then a hyphen in the custom check's own name. Only registration
  names were corrected; no behavior assertion was changed. Their outputs are
  `SETUP-FAILURE.txt` and `SETUP-FAILURE-2.txt` (not behavioral proof).
- The single execution after successful setup is `BASE-FAILURE.txt`: **3 failed,
  0 cancelled, 0 skipped**. Both production checks passed their SQLite assertions
  and then failed specifically on missing `process.tracked`. The descendant test
  reached `overran` and failed specifically because the detached child was alive
  at resolution. Its `finally` ran only after that observation.
- `AFFECTED.txt`: selector **BLOCKED** before selection because Cargo is absent;
  this supplied directory also has no `.git` metadata. It emitted no WIDE or
  INCONCLUSIVE lines. Direct execution above is the disclosed verification
  deviation, not a successful affected run.
- No compatibility suite, Linux run, full preflight, post-fix run, network access,
  commit or release. AC3 and eventual green results remain unproven.
