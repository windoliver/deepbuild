# #2330 — approved proof repairs

**Approved in the owner's follow-up request to close these gaps.** The isolated
proposal commit `d7b423dec` applies items 1–3; item 4 is the separate benchmark
integration. The original draft is preserved in parent commit `eca90a7f5` and
the original external drafting workspace. No signed approval tag is fabricated.

The issue's limits stay **30 ms readiness,
60 ms start return, 30 ms stop return, 15 s timeout**, with unchanged ordinary
messages and exit codes. No change below waives a product assertion or allows a
missing measurement to pass. The original draft and one permitted blind redraft
are preserved byte-for-byte.

## 1. Current-main runtime asset in both disposable builds

Main now imports `setup-steps.ts` from `service.ts` for #2203's temporary-home
login-service safety guard. That module reads `contracts/setup-steps.json` at
import time. Both frozen builders copy source modules but omit that asset:

- `tests/acceptance/2330/build.mjs`
- `tests/acceptance/2330-redraft/build.mjs`

The public hub entry fails with ENOENT before any lifecycle call. This also blocks
`packages/hub/test/lifecycle-events.test.mjs`, whose builder is the first file.

Proposed repair: add `copyFileSync` to each builder, create the disposable
`contracts/` folder and copy **the checkout's own bytes** of
`contracts/setup-steps.json` into it. No module substitution, no invented asset,
no expected-value change. Apply to both sides' builds, not just the candidate.

Proof: both public-entry smoke checks load; negative control omitting the asset
fails the same smoke check. The existing lifecycle assertions then run unchanged.

## 2. First draft's peer lifetime and event framing

`tests/acceptance/2330/lifecycle.test.mjs` starts the stand-in through
`command(root, 'run')`, which gives **every verb** a 17-second watchdog. The
stubborn-hub scenario then spends another CLI's startup and the 15-second stop
limit while that watchdog is counting. The fixture may be killed before its
required final hello probe. Its `hub.mjs` also has a 25-second lifetime fuse.
Neither death is evidence that stop worked.

Proposed repair: own `hub run` through explicit cleanup plus owner-disappearance
cleanup, not a command watchdog or fixed lifetime. Retain bounded watchdogs for
`start` and `stop`. Buffer/re-read only complete newline records in `trace()`;
its current `.trim().split('\n').map(JSON.parse)` can parse an in-progress file.
The independent redraft reached these two designs without seeing the first
fixture or its failure output; see its `hub.mjs` and `run.mjs`.

Proof: the unchanged stubborn-hub assertion fails against the base's false exit
0 and passes only when the candidate refuses success with the peer still
answering. An intentionally truncated event never supplies a measurement.

## 3. Existing stop fixture assumes the polling implementation

`packages/hub/test/hub-waits.test.ts` waits for **zero client connections** before
calling its stand-in's `server.close()`. A stop implementation that retains the
request connection until peer shutdown cannot satisfy that fixture's idle
precondition; Node also keeps `server.close()`'s callback pending while accepted
connections remain open.

Proposed fixture-only repair: its `gone()` must model a real process exit by
closing the listener **and destroying its own accepted sockets**; pre-shutdown
checks must wait for `hub.stop` to be acknowledged, not for the CLI to drop the
connection. Preserve the existing assertions that stop remains pending while
answers continue, then returns within the existing **20 ms controlled-clock**
bound. Preserve the existing start and timeout tests unchanged.

This conflict was found by source inspection; the selected affected run ended
**INCONCLUSIVE: no test grant came within 30 min**, so it is **not yet a recorded
test failure**. Approval should follow the actual result, not treat the
inspection as evidence.

## 4. Formal budget registration, never a forced local PASS

The first draft unconditionally skips a successful local latency reading. The
blind redraft independently keeps standalone runs INCONCLUSIVE because the
repository's scheduled-window policy requires exact-commit/base measurement.
Neither is a PR-closing budget receipt, and agents cannot start the window.

Proposed integration: expose the same sealed scenario/oracle through a benchmark
entry and register start/stop tasks in `benchmarks/budgets.json` with literal
60/30 ms targets and criterion IDs `#2330.c6939f4f` / `#2330.c4ac049d`. The
scheduled window must run 20 samples per side, retain the five-run target
qualification and environment/counter evidence, and fail on the original
100 ms-polling wrong program. Missing reads remain non-PASS. Do not modify
`scripts/budget-window.mjs`, the timing judges, or any budget to make this pass.

A task newly named on main is not retroactive proof of earlier commits. The PR
must say **Part of #2330** until a qualifying window proves the remaining
criteria; it cannot truthfully say Closes based on controlled-clock tests alone.

## Approval boundary

The owner approved the collected repairs after this proposal was presented.
The dedicated harness-repair commit contains only the five named fixture/test
files, with every original acceptance assertion unchanged. The benchmark
integration extracts the sealed sample and oracle without changing its assertion
multiset; all 133 previously registered budget tasks retain their definitions.
No skip list, known-failure baseline, timing threshold or scheduled tool changes.
A protected-check approval still needs the owner's signed tag if the proof guard
requires it; chat authorization is recorded, not forged into a machine signature.
Production fixes are separate from these proposal commits.
