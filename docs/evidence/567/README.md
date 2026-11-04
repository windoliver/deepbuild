# #567: the verdict spine's exit, in a real Claude Code session

`tests/acceptance/567/session.live.test.ts` ran on spark-c89f (Linux arm64) on 2026-11-04 with Claude Code 2.1.308,
the harness's Haiku launch (`claude-haiku-5-5`), `deep setup`'s entries in a temporary home and the hub at this
branch's head. It passed twice in a row, and once more after the branch was rebuilt on origin/main 636cde1e; each
session cost about $0.003 to $0.004. The screenshots replay the second run's
terminal (its `screen.log`, 120×40, home folder and temp paths redacted) in xterm.js.

1. [1-held-and-sent-back.jpg](1-held-and-sent-back.jpg): the seeding prompt, the edit that fixes nothing, the false
   "Done. Expired tokens are rejected and all tests pass.", DeepBuild's Stop entry holding it while the repo's `unit`
   check ran, its verdict line `sent back 1/3 · 2 tests · next: agent · receipt`, and the send-back naming the check:
   "DeepBuild sent this claim back: the repo's spec check unit FAIL."
2. [2-fixed-and-let-through.jpg](2-fixed-and-let-through.jpg): sent back, the agent read the failing test, fixed
   `checkToken`, ran the tests (2 of 2 pass), and its true "done" was let through: `says done 1/1 · 2 tests · next:
   DeepBuild · receipt`.

The record of that run, in order: `user.ask` from `person`, opening the session's task; `agent.stop` (turn 1, a
claim); `claim.made`; the `unit` run failed; `claim.sent_back` (round 1); `agent.stop` (turn 2); `claim.made`
(attempt 2).

## What the live run found

Before the fix in `packages/hub/src/core.ts`, every live run failed AC1 at "no run.started for it on the claim": the
hub held the stop, but no check ran and the stop went through with `says done · next: DeepBuild`. Claude Code 2.1.308
writes a typed prompt's transcript entry only once the prompt's `UserPromptSubmit` hooks have returned. Measured
without DeepBuild, with a harness hook that returns at once, the entry landed 154 ms after the hook fired; with a hook
that sleeps 3 s, 3,166 ms after. The core read the prompt's origin while DeepBuild's hook was still held, found no
entry, and recorded the prompt as `unknown`. An `unknown` prompt opens no task, so the stop's claim had nothing to
judge. The fast test's Claude Code stand-in writes the entry before it fires the hook, which is why it never showed
this.

The fix sets such a prompt aside and places it once its entry is written: before the session's next hook, or 3 s
later, or when the hub stops. `packages/hub/test/prompt-flush.test.ts` fails without the fix (`unknown`) and passes
with it.
