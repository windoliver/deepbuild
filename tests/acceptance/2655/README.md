# #2655 acceptance: the hub's event loop loads no scrubber, validator or TLS it never runs, copies a hook line once, and bounds its command history in bytes

Written blind from the issue, the design (One hub per user; Numbers version 0 has to hold; Dogfooding; parallel-proof section 6) and base `9ae04c6cd980`. No implementation was seen.

## Run

Both checkouts built (`npm run build --workspaces`). From the checkout under test:

```
export DEEP_2655_BASE=/path/to/built/merge-base     # required by every comparison with the merge base
node scripts/throttle.mjs test --wait 30 -- node --test tests/acceptance/2655/loads.test.mjs         # AC1, under a minute
node scripts/throttle.mjs test --wait 30 -- node --test tests/acceptance/2655/tls.test.mjs           # AC2, under a minute; needs git
node scripts/throttle.mjs test --wait 30 -- node --test tests/acceptance/2655/start.test.mjs         # AC3, about 2 minutes; macOS and cc for the instruction count
node scripts/throttle.mjs test --wait 30 -- node --test tests/acceptance/2655/line-copies.test.mjs   # AC4, under a minute
node scripts/throttle.mjs test --wait 30 -- node --test tests/acceptance/2655/history.test.mjs       # AC5, about 2 minutes
```

`DEEP_2655_CHANGE=<checkout>` tests another built checkout than the one these files are in. Sanity runs, which read INCONCLUSIVE at best: `DEEP_2655_ROUNDS=2` (start), `DEEP_2655_COMMANDS=30` (history).

Each test reaches the code from outside: `deep hub run` of a built checkout on a home of its own, its socket's lines as deep-hook and the CLI write them, `deep join` and `deep status`, a preload in the hub's process (`NODE_OPTIONS=--import`, as `packages/hub/test/startup-memory.test.ts` reads its load lists) and Node's inspector (as `benchmarks/hub-churn.mjs` forces a full collection). `gh`, `claude` and `codex` are stand-ins on the hub's PATH that fail, as #1338's world makes them, so no test starts a real agent or reaches a forge. A missing or unbuilt side, a list that never armed, a count the host can't read, or fewer rounds than required is BLOCKED or INCONCLUSIVE: the test fails and says which.

## Criterion, test, proof

| Criterion | Test | Measures | On the base `9ae04c6cd980` |
|---|---|---|---|
| AC1 main thread loads no module of `@deepbuild/evidence`, and of `@deepbuild/contracts` only the one it names | `loads.test.mjs` | The load hook's list after a start and a session's first four hooks; the main thread is the one that loaded `packages/hub/dist/server.js`. Passes when it lists no `packages/evidence/` module and at most one `packages/contracts/` module. BLOCKED when no other thread loaded the scrubber and the validator. Prints the merge base's list beside the change's. | FAIL, naming 7 contracts modules (`runtime.js`, `json.js`, `errors.js`, `validate.js`, `canonical.js`, `schemas.js`, `lifecycle.js`). It names no evidence module: this base's main thread already loads none (see below). |
| AC2a a hub with no member loads no `node:tls` on any thread | `tls.test.mjs`, first test | `tls-preload.mjs` on every thread: a load hook, and the thread's own list of loaded built-ins every 100 ms. Passes when no thread is named, nothing accepts on the `hub.listen` port, and, once bob is invited, the port accepts and the list does name a thread (else BLOCKED). | FAIL: `thread 0: load-hook node:tls; thread 0: built-ins node:tls`. |
| AC2b a hub whose project gains a member opens its listener and serves a joined client as on the merge base | `tls.test.mjs`, second test | On each side: the owner invites bob, the port accepts, bob's home runs `deep join` and `deep status`; exit codes and output equal the merge base's. The same read with the hub stopped must differ. | PASS (base against itself). |
| AC3a main thread's heap after two full collections at least 0.5 MB under the merge base's | `start.test.mjs`, second test | 20 alternated rounds a side; inspector, two `HeapProfiler.collectGarbage`, `heapUsed` of the main thread, once the hub is ready and its socket answered; medians. | FAIL: 0 MB under. |
| AC3b the hub's own process retires no more instructions from start to its socket's first answer | `start.test.mjs`, third test | 20 alternated pairs; the hub is stopped (SIGSTOP by PID) at the first bytes its socket writes, and `proc_pid_rusage` instructions of its process read. FAIL when above the base at p < 0.01, PASS when "2% or more above" is rejected at p < 0.01, else INCONCLUSIVE. | INCONCLUSIVE on the saved run (-0.16%, p 0.048 that it is under 2% above); the run before it read PASS (-0.64%, p 0.0092). Base against itself sits at the edge of the margin (see below). |
| AC4a a 512 KiB hook line reaches the parser with one copy made on the event loop | `line-copies.test.mjs`, first test | `copies-preload.mjs` in the hub's main thread; bytes copied between the line's write and the reply, in whole copies of the 524,288-byte line. One required; none counted is INCONCLUSIVE. | FAIL: 2 copies (`Buffer.concat 524288, postMessage 524288`). |
| AC4b its event is the merge base's | second test | The event read back by `events.read` on both sides from the same bytes, less `log_pos`. | PASS (base against itself). |
| AC4c a planted server that hands over a view of the socket's chunk fails, naming the line that changed under the parser | third and fourth tests | The judgment (the 512 KiB line's event, and three requests written at once on one connection, each answered as sent) passes on the checkout as it is, and must fail on `DEEP_HUB_PLANT=hands-over-socket-chunk`, each failure naming a line. | Third PASS. Fourth BLOCKED: the base has no such plant. |
| AC5a 2,000 commands of 100 KB in the history, main thread holds under 20 MB | `history.test.mjs`, first test | 2,000 different 100,000-character Bash commands, each a PreToolUse and a PostToolUse; main-thread heap after two full collections, after less before. | FAIL: 190.87 MB. |
| AC5b the expected time the history gives a repeated command is the merge base's | second test | The 2,000th command takes 2.7 s, is run again and left 4.8 s; the hub's line at its end says "about 3 s was expected". Equal on both sides; none on the base is BLOCKED. | PASS (base against itself). |

`start.test.mjs`'s first test checks the judging on planted numbers: 0.4 MB under and 3% more instructions fail, 0.6 MB and 1% fewer pass, a missing count is INCONCLUSIVE.

## What the tests name, for the change to provide

`DEEP_HUB_PLANT=hands-over-socket-chunk`: `deep hub run` under it is the planted server of AC4, which hands its parser a view of the socket's chunk in place of the line's own bytes. No other name, flag or file is assumed.

## Where the base differs from the issue's account

The issue was read on `ccbdefd1f`. On base `9ae04c6cd980` the main thread loads no `@deepbuild/evidence` module, and from `@deepbuild/contracts` it loads `runtime.js` and the six modules that entry imports, the validator among them. So AC1 fails on the base for the contracts modules alone, not for "both entries". The test was not bent to fail on evidence.

## The instruction count's spread

One pair's counts differ by up to about 10% on this machine under load, because the count at the first answer holds whatever the core's and the parser's threads had done by then. Twenty pairs of one program therefore sit at the edge of rejecting "2% or more above": two runs of the base against itself read PASS and INCONCLUSIVE. A change that lowers the count by a few percent passes clearly. `DEEP_2655_ROUNDS=60` gives the judgment more pairs; more than 20 is allowed, fewer is INCONCLUSIVE.

## Choices the issue left

- **"The one it names" (AC1)** is one module file, so the main thread may list at most one `packages/contracts/` module. The title says the event loop loads no validator, and an entry counted with everything it imports would pass the base, which the issue says fails.
- **When the list is read (AC1, AC2a)**: after a start and a session's first hooks, not at the start alone. The event loop never runs the scrubber, so serving a hook must not load it either.
- **How TLS is seen (AC2a)**: the load hook and each thread's list of loaded built-ins. `process.getBuiltinModule` passes no load hook, so the hook alone would miss it.
- **"Serves a joined client" (AC2b)**: `deep join` and `deep status` of the same checkout as the hub, compared with the merge base's own pair.
- **MB** is 2^20 bytes, as `startup-memory.test.ts` counts it; 100 KB is 100,000 characters.
- **Samples (AC3)**: 20 a side, as the design's budgets take them. The machine is not checked against the reference Macs: heap after two full collections and instructions retired are not timings.
- **"No more than" (AC3b)**: the design's judgment of an instruction count (paired, seeded sign-flip tests, 2% margin for PASS), with FAIL at any rise shown at p < 0.01, as #2332's test fails one.
- **"One copy" (AC4a)** is exactly one whole copy of the line. `new Uint8Array(bytes)` is not counted; a line copied only that way reads INCONCLUSIVE.
- **"Changed under the parser" (AC4c)** is judged from the socket: a line answered or recorded as other than it was sent. Node gives each read its own buffer here (8,192 bytes on this socket), so "the socket's pooled chunk" is read as the chunk several lines share.
- **"Holds for them" (AC5a)**: heap growth over the 2,000 commands, after 50 small ones. The commands are ASCII and differ from their first line, so 2,000 keys cut at 8,192 characters are 2,000 keys of 16.4 MB.
- **The expected time (AC5b)** is read from the hub's own line at the repeated call's end, in whole seconds as the hub words it.

## Not done, outside this folder

No lane list was edited. `start.test.mjs` counts instructions and may belong in `scripts/lanes.mjs`'s lists for measured files; it runs by its command as it is. `start.test.mjs` imports `counter` and `flips` from `tests/acceptance/2332/measure.mjs`.
