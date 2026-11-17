# #2330 — CLI hub lifecycle acceptance

Drafted independently from issue #2330, the design, and base
`1c4d1f0e2aaad8c6a6573848823566d04ff73d17`. No implementation checkout or
workspace-linked product source was read. Preserve **all files here byte-for-byte**
after drafting handoff; corrections belong to the independent drafting job.

## Run

Node >=24.22 and the repository's existing TypeScript dependency are sufficient.
No workspace/native build, install, agent account or service manager is needed.

```sh
node scripts/affected.mjs --list tests/acceptance/2330/lifecycle.test.mjs
node --test --test-concurrency=1 --test-reporter=tap tests/acceptance/2330/lifecycle.test.mjs
```

For the required base evidence, redirect the second command's stdout and stderr to
`../acceptance-base.log` (outside the repository). Never commit machine-local raw logs.

### Drafting base run

One complete run: **6 tests, 3 passed, 3 failed**, runner exit 1. The raw output is
`../acceptance-base.log`. This was not a qualified budget run: load was about 328
on 18 available CPUs. AC1 stopped at its fixture-validity assertion (listening at
319.220 ms instead of the scheduled 30 ms); its requested 60 ms regression proof
is **INCONCLUSIVE**, not demonstrated by this run. AC2's five raw exit-to-return
readings were 204.931–333.772 ms, all failing the literal 30 ms assertion, but are
not a formal budget FAIL on this loaded machine. The still-answering-at-15-s
safety guard failed: stop returned 0. The early-close guard, exact never-ready
message/exit 3 with the real 15 s wait, and missing-hub diagnostic passed their
behavioral assertions. No retry was made to obtain a better timing result.

The affected-selector command was attempted but **BLOCKED**: its Cargo metadata
prerequisite crashed (`result.stderr` was undefined). It produced no WIDE or
INCONCLUSIVE selection lines. The direct Node runner above executed the suite;
no full build or unrelated checks ran. A qualified AC1/AC2 timing proof remains
outstanding; the suite does not claim all three criteria proven on this base run.

## Criteria → proof

| Requirement | Test in `lifecycle.test.mjs` |
| --- | --- |
| AC1: socket answers 30 ms after hub start; start returns within 60 ms of first answer | Real `deep hub start --root`; one warm-up and five samples, **60 ms** on every measured return. Already-running start also stays silent, exits 0 and launches no second hub. |
| AC2: stop returns within 30 ms of hub exit and never while its socket answers | Real `deep hub stop --root`; one warm-up and five samples, **30 ms** on every measured return; immediate hello probe at CLI exit and hub-exit ordering. |
| AC2 safety, connection close alone is insufficient | Stand-in acknowledges stop and closes that connection, but serves new connections for another 230 ms. Success must wait until the listener is gone. |
| AC2 safety at the unchanged 15 s limit | Stand-in acknowledges stop, closes that connection, and keeps answering beyond 15 s. Stop must finish, but cannot report success. No invented error wording/code is required for this previously false-success case. |
| AC3: never answers → 15 s, today's message, exit 3 | Real detached start of a stand-in that never binds; exact full stderr including temporary socket/log paths, empty stdout, exit 3 and real elapsed deadline. |
| Unchanged ordinary messages/codes | Successful start/stop: exit 0, empty stdout/stderr; missing dev hub stop: exit 3, exact existing ENOENT diagnostic. |

The timeout test counts from CLI spawn (must not fail before 15,000 ms) and also
reports hub-process start to return (at most 15,100 ms, the base's one 100 ms
observation step). This is deadline-observation granularity, **not** a new 15.1 s
product deadline or an allowance on the 60/30 ms budgets. The 17 s harness watchdog
only bounds a hung child; hitting it fails. The stand-in's 25 s orphan fuse is not
part of any product timeout.

## Real surface and stand-in boundary

`build.mjs` transpiles the snapshot's CLI entry and its statically reached modules
into one disposable tree. It reads workspace sources through `packages/`, never
through `node_modules` links. Package export resolution follows the snapshot's
manifests. It does not rewrite production statements: CLI dispatch, argument
parsing, service spawning, credentials, real sockets, retries, timers, messages
and exit codes all run as shipped. Only `server.js` is replaced by the stand-in
`runHub`, the boundary required by the issue's Proof. No service function is
imported by a test or mocked, and no production/test-only export is added.

The same fixture is preloaded in children using `NODE_OPTIONS`. Only a `hub run`
child starts it; start/stop commands execute the real CLI. This lets the stand-in
start answering at process age 30 ms rather than after the real server's module
loading. The real start command still spawns its own detached child. Stop samples
launch a separate stand-in with the same `hub run --root` argv. `hub.mjs` speaks
the real newline JSON hello/CLI token/`hub.stop` exchange on a real Unix socket.
Each world has its own short `/tmp` root and HOME. Cleanup signals only direct
children or the detached child recorded by this world's stand-in; no name/port
kills, real home, login service or network service is touched.

## What the numbers mean

All intervals use the host monotonic `hrtime` clock shared across child processes.
The fixture schedules listening at Node process-start age **30 ms** (derived from
`performance.now`, not module entry). A 30–35 ms observed listening age and a
0–5 ms independent-witness delay are fixture-validity checks: missing these yields
INCONCLUSIVE, never a widened command budget.

`ready` is stamped in the server's listening callback, before the CLI need connect.
An independent immediate witness then gets a hello; `first-answer` is stamped at
that first server write. Both readiness→return and first-answer→return are printed.
The **60 ms** assertion uses first-answer, never the later first CLI polling
connection (which would hide the base bug). The fixture exits 30 ms after receiving
stop. Its synchronous exit hook timestamps the last instant before process exit;
CLI completion is timestamped at the parent's `exit` event, not output-stream
`close`. The **30 ms** interval includes the tiny exit-hook/OS-reaping overhead;
it does not subtract guessed overhead. The immediate post-return probe plus exit
ordering rejects success while the continuously serving fixture is still up.

These are fixed local regression readings, not a release-budget receipt. Five
samples follow one warm-up, with p50/p95 and all raw readings; no retry-until-green,
cache flushing or instruction-counter comparison. On a local all-within run the
timing cases are marked **INCONCLUSIVE (skip)**, not PASS. Over-budget readings
still fail the literal assertions to expose the base regression, without claiming
a formal machine-qualified budget FAIL. The environment row names only date,
Node/OS/model, CPU count, load and AC status, never host/user/serial identifiers.
Thermal state and Low Power Mode are not certified. The scheduled-window,
20-sample paired baseline and instruction-counter requirements remain unrun;
agents must not start that window. Missing setup/platform prerequisites are
BLOCKED; delayed fixture scheduling is INCONCLUSIVE, not a product timing failure.

This suite deliberately covers the issue's `--root` surface, not installed-hub
OS confirmation or setup/undo's indirect `stopIfRunning` route. It does not replace
those existing checks. Neither a different error for a still-running hub at the
stop deadline nor an unrelated service-manager behavior is specified here.
