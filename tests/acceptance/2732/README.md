# Acceptance tests for #2732: a stop that arrives before init creates the job pool leaves `<root>/jobserver` behind

Written first, blind, from issue #2732 (`gh issue view 2732 --repo windoliver/deepbuild --json title,body,comments`),
the design (`docs/technical-design.md`: Dogfooding, Proven on the base, Criteria in a checked shape), `AGENTS.md` and
base commit `2eaaeb0e6` (origin/main), by a job that never saw an implementation of #2732, a diff, a pull request,
another branch or another job's notes. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue: What is wrong, Effect, Fix (proposed) and its two acceptance criteria. It has no comments.
- At the base, only for how its surfaces are driven: `packages/hub/src/core.ts` (`init`, `openResources`, where the
  `JobPool` is made, `stop` and its two passes), `packages/hub/src/heavy.ts` (`JobPool`: its constructor runs
  `mkfifo` in a root with no pipe, `close(true)` removes the pipe), `packages/hub/src/core-worker.ts` (the core is
  created, so its `init` starts, before the worker adds its message listener), `packages/hub/src/server.ts`
  (`coreWorker`, `Hub.stop` posting `{ op: 'stop' }`, the ready line), `packages/hub/src/children.ts` (it runs
  `execFileSync` through `spawnSync`), `packages/leases/src/index.ts` (whether `declare` waits on anything) and
  `scripts/proof-change.mjs` (`criterionId`).
- `tests/acceptance/2573/`, for form only. No other suite's files are imported.

## Run

```sh
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH   # node 24
npm ci --no-audit --no-fund                              # once, if node_modules is missing
npm run build --workspaces --if-present                  # the hub runs from packages/*/dist
cargo build --locked -q -p deep-hook                     # the hub's core needs target/debug/deep-hook
node node_modules/vitest/vitest.mjs run tests/acceptance/2732/
node node_modules/typescript/bin/tsc -p tests/acceptance/2732/tsconfig.json   # type-check
```

The suite takes about 3 s. It waits only on events, never on a timed sleep, so it needs no lane of its own. Each test
makes its own sandbox under `/tmp/d2732-XXXXXX` (socket paths stay short) with a HOME of its own, starts only a dev hub
(`deep hub run --root <sandbox>/r`, as `deep hub start --root` starts it: its own session, both outputs in
`<root>/logs/hub.log`, no service manager), and after the test stops any hub still running by the PID it started and
removes the sandbox.

## The scene

Both tests wait for the hub to answer on `<root>/hub.sock` (its hello), say hello as `cli` with the root's
`control.token`, make the `hub.stop` call and check the hub answered `stopping: true`. Then they wait for the hub
process to exit and `lstat` `<root>/jobserver`: anything there, of any file type, is a failure.

- **AC1, stopped during init**: the hub runs with `NODE_OPTIONS=--import=<stall.mjs>` and `D2732_MARK=<sandbox>/mark`.
  The stop is sent once the stall wrote `init-running`.
- **AC2, stopped after a ready start**: no stall. The stop is sent once hub.log holds the hub's `"ready":true` line,
  and only after `<root>/jobserver` is checked to be a named pipe (else BLOCKED).

## The stall

`stall.mjs` changes no product file, and the product has no seam for it. It acts only in `deep hub run` and only when
`D2732_MARK` is set.

- In the hub's main thread it wraps `Worker.prototype.postMessage`: once the hub posted `{ op: 'stop' }` to its core's
  worker, it writes `stop-posted`.
- In the core's worker thread (the one whose `workerData` carries `core`) it wraps that thread's `parentPort.on`.
  `core-worker.js` creates the core, which starts `init`, and then adds its message listener; at that call the stall
  writes `init-running` and holds the thread (`Atomics.wait` in 10 ms naps) until `stop-posted` is in the marker file,
  at most 120 s (then `gave-up`). No message reaches the core meanwhile, so once the listener is added the hub's stop is
  the core's next message, and it is handled the next time `init` waits on anything: `init` is still running. The
  listener is wrapped to write `stop-received` as the stop reaches the core, just before the core's own `stop` runs.
- It watches `execFileSync` and `spawnSync` (the hub's `children.js` runs the first through the second) and writes
  `pool`, with `stopSeen`, when the core runs `mkfifo <root>/jobserver`: the `JobPool` constructor makes its pipe so
  in a root that has none. It also writes `started` or `fatal` as the worker tells the hub its start ended.

Before its assertion, AC1's test checks the scene played, each as a `BLOCKED:` assertion so a mis-timed play fails
loudly and never passes: no `gave-up`; a `stop-received`; if `started` came, it came after `stop-received`; and every
`pool` line has `stopSeen: true` (the pool was made after the stop reached the core). A fix that makes no pool at all
once stopped writes no `pool` line and is not refused for it. At the base the marks are
`["init-running","stop-posted","stop-received","pool","started"]`: the stop came, then init made the pool, then init
finished, then the stop's second pass ran and the hub exited 0 with the pipe left.

## Tests and criteria

Criterion IDs are `#<issue>.<first 8 hex of sha256 of the criterion's text, spaces folded>`, as `criterionId` in
`scripts/proof-change.mjs` makes them, from each criterion's full line as the issue states it, `AC<n>: ` included.

| Test in `jobserver-stop.test.ts` | Criterion | At the base |
|---|---|---|
| `#2732.86d07610 AC1: stopped while init is running, before it creates the job pool, the hub leaves no <root>/jobserver once it has exited` | AC1: a hub stopped while `init` is running, before it creates the job pool, leaves no `<root>/jobserver` once the stop has finished. | FAILS at its last assertion: `expected 'a named pipe' to be 'nothing'` |
| `#2732.9eef3fb9 AC2: stopped after a ready start, the hub still removes <root>/jobserver` | AC2: a hub stopped after a ready start still removes `<root>/jobserver`, as it does today. | passes (pins today's behavior) |

"Once the stop has finished" is read as once the hub process that took `hub.stop` has exited.

Note for the trace lane: `readIssue` in `scripts/proof-change.mjs` reads criteria under a `### Acceptance criteria`
heading, and the issue's heading is `## Acceptance criteria (proposed)`. As written, the trace lane finds no criteria
in #2732; the IDs above are computed from the criterion lines themselves. Left to the issue's author, since this job
edits only this folder.

## Wrong programs

Run by this job on APFS clones of the built worktree in its scratch folder, with only `packages/hub/dist/core.js`
changed in the clone (nothing here or in the product was changed):

- The base itself (`2eaaeb0e6`): fails `#2732.86d07610` (a named pipe left), passes `#2732.9eef3fb9`, in each of four runs of the files as kept (and a fifth, earlier one).
- A hub whose stop never removes the pipe (both `this.pool?.close(true)` made `close(false)`): fails
  `#2732.9eef3fb9` (a named pipe left after a ready stop), and `#2732.86d07610` too.
- For contrast, the issue's proposed fix (`this.pool?.close(true)` beside the second pass's `this.work?.close()`):
  both tests pass, so AC1's test can be met.

No twin files are written here.

## Proof on the base

`BASE-FAILURE.txt` holds the command and output of the suite at the base: AC1's test fails at its named assertion with
the pipe still there and the marks of a well-played scene, AC2's test passes.
