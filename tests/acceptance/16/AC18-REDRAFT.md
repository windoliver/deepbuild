# AC18 blind redraft: the hot path holds while every sync takes 50 ms

Test: `hotpath-ac18-redraft.test.ts`, one `describe` ("AC18 #16.0edb254f with every sync held 50 ms, the hooks stay
fast beside FULL commits, a checkpoint and a backfill (redraft)") with two `it`s: the run ("AC18 30 sessions send
1,000 PreToolUse hooks beside ten FULL verdicts, a WAL checkpoint and a 50,000-event backfill: round trip under 2 ms
at p95, no reply 50 ms") and its wrong program ("AC18 (wrong program) commit-on-event-loop: the same check fails,
naming the first late reply"). New fixture: `fixtures/load-ac18.mjs`. `helpers.ts`, `tsconfig.json` and the other
fixtures are the suite's, copied unchanged.

The criterion's ID is `#16.0edb254f` (SHA-256 of its text, trimmed, whitespace collapsed, `- [ ] ` dropped).

## What I read

- Issue #16 (`gh issue view 16 --repo windoliver/deepbuild --comments`): Scope, the criteria, Proof, Depends on,
  "Added Oct 9", "Done when", and the comment moved from #311.
- `docs/technical-design.md` at `4f6dec5`: "Hook protocol (deep-hook and the hub)", "One event log, with tables built
  from it" (the paragraph on `synchronous=FULL`, the writer worker and parsing off the event loop), and in "How we know
  version 0 works": Fault injection, Wrong programs and Dogfooding; also the "Hot path" row of the numbers table it
  points to.
- The suite's `README.md`, `helpers.ts` and `fixtures/` (read-only copies), for the surface: the hello on accept,
  `DEEP_HUB_TEST_VFS` (`syncDelayMs`, `points`), `test.load` (`verdicts`, `checkpoint`, `backfill`),
  `DEEP_HUB_PLANT=commit-on-event-loop`, `events.read`.
- Base files: `packages/contracts/schemas/verdict.made@1.json` and `packages/adapters/src/shipped.ts` (the shape of a
  Claude Code transcript entry), `tests/acceptance/14/AC6-REDRAFT.md` for this file's style.

Nothing under `packages/hub`, no other test of #16, no other branch, worktree or PR.

## The scenario

1. A hub with `DEEP_HUB_TEST_VFS={"syncDelayMs":50,"points":<file>}` (planted with `commit-on-event-loop` in the
   wrong-program test). 30 Claude Code sessions in fresh working folders, and a 31st whose transcript holds 50,000
   entries (user and assistant by turns, from seed 16) and which sends no hooks.
2. The test reads the whole log (`events.read`) before the load: it must hold no `verdict.made`.
3. `fixtures/load-ac18.mjs`, a process of its own, sends each session's SessionStart (untimed), opens a `cli`
   connection with the control token, then sends PreToolUse hooks on a fixed timetable, open loop: one every
   33/30 ms in turn across the sessions (about 900 a second), each started when due whether or not earlier ones have
   their replies, each on a new connection as deep-hook makes it: connect, read the hello, write the request, read
   the ack and the reply. Once 100 have replies it sends `test.load {verdicts: 10, checkpoint: true, backfill:
   {agent, session, transcript}}`. The hooks keep coming until the load call has returned, 300 ms more have passed,
   and at least 1,000 have started. Every hook records when it was due and when it connected, got the hello, wrote
   its request, got the ack and the reply, and ended.
4. The test reads the whole log again and the VFS's points file.

## Assertions, the sentence each comes from, and the wrong program each catches

| # | Assertion | Source sentence | Wrong program it catches |
|---|---|---|---|
| 1 | `test.load` returns `{done: true}`; at least 1,000 PreToolUse hooks from all 30 sessions | "30 scripted sessions send 1,000 PreToolUse hooks while the hub commits …" | A hub that refuses or never finishes the load, or a run with too few hooks |
| 2 | At least 100 hooks answered before the load call was sent, and a hook started after it returned | "while the hub commits ten verdicts …, checkpoints the WAL and backfills" | A run where the heavy work doesn't overlap the hooks: a hub that did it before the hooks started, or one that answers the load at once and works after the hooks stop |
| 3 | The log held no `verdict.made` before the load; after it, exactly ten new ones, each with `ts` inside the load call, each written by a VFS commit point with mode `full` (failure names the event ID) | "commits ten verdicts with `synchronous=FULL`" | A hub that commits the verdicts NORMAL, outside the load call, or not at all |
| 4 | At least 50,000 new events after the log's head before the load, none of them a hook's or a verdict (failure names the transcript) | "backfills 50,000 transcript events" | A hub that skips or cuts the backfill, which would leave the hot path idle |
| 5 | Every judged hook got its reply; none took 50 ms or more from its connect to its reply | "no reply takes 50 ms"; design: deep-hook falls open "when no acknowledgement arrives within 50 ms of the hook's start" | A hub whose event loop waits on a sync: a hook in flight when a sync starts waits the whole sync |
| 6 | The round trip (connect to reply) is under 2 ms at p95 over all judged hooks and over every 540 judged hooks in a row | "the socket round trip stays under 2 ms at p95" | Any hold of the event loop that keeps the hooks arriving during it waiting; the window stops a long backfill from averaging the holds away |
| 7 | (wrong program) On `DEEP_HUB_PLANT=commit-on-event-loop` the scenario runs (1 to 4 pass), there is a late reply, and the same check throws with the first late reply's request ID in its message | "A hub that commits through the synchronous binding on its event loop holds replies for the sync and fails, naming the first late reply" | A test that can't see the hold; a check that fails without naming the reply |

The first late reply is the earliest-connected judged hook that was never answered, took 50 ms or more, or is over
2 ms inside a failing window (or in the whole run when its p95 fails). The FAIL message reads `AC18 FAIL: the first
late reply is to <request ID> (session …, started … ms after the load call was sent): <its round trip>; <summary>`.
Every ID is written into the message as text, never as an array or object Vitest might shorten.

## Why the plant is caught whatever moment its holds fall

- **The hello.** A hook client may write its request only after the hub's hello, and the hub writes the hello on
  accept, on its event loop. A hook that connects while the loop is held gets no hello until the hold ends, then
  writes its request and is answered at once: timed from the request written (the README's reading), it looks fast.
  So the round trip here runs from the connect, the moment the hook started on the socket.
- **Requests waiting unread.** A hook whose request reached the hub just before a sync began waits, unread, for the
  whole sync: from its connect it takes 50 ms or more, which assertion 5 catches.
- **Arrivals during a hold.** The hooks run open loop on a timetable the hub can't slow, so a 50 ms hold always has
  hooks arriving all through it: at about 900 a second, about 43 of them wait more than 2 ms. Any 540 hooks in a row
  (about 0.6 s) that contain that hold have a p95 over 2 ms, since 28 slow ones are enough, so assertion 6 fails at
  every hold, wherever it falls. This doesn't depend on a hook being in flight at the instant the sync starts.
- **However fast or slow the work.** The hooks keep coming until the load call returns, so every sync the load causes
  falls inside the measured run, and assertion 2 checks they overlapped. The window, not the whole-run p95, is what
  survives a slow backfill: with the backfill stretched (below), the plant's whole-run p95 was 0.41 and 0.99 ms, under
  2 ms, while its worst window was 77 and 92 ms.

## Readings where the issue left a choice

- **Round trip and "takes"** are both from the hook's connect to its reply line read, the whole socket exchange,
  hello included (above). For a correct hub this adds one hello to what the README measured.
- **"Stays under 2 ms at p95"** is read as holding through the run: over every 540 hooks in a row as well as over all
  of them (the design's hot-path row: a backfill must not "push a hook reply past the hook overhead budget; those run
  in slices").
- **1,000 hooks** is a floor: the hooks keep coming until the load call returns, so a slow backfill means more hooks.
- **Each transcript entry is one event:** the backfill of 50,000 entries appends at least 50,000 events. Which kinds
  they become is the hub's catalogue mapping; the test counts new events that are neither hooks nor verdicts.
- **The checkpoint** has no point kind in the VFS, so the test takes `done: true` as its proof; the ten verdicts'
  FULL commits are proven through the `points` file.
- **The load process's own stalls.** A hook that starts more than 10 ms after it was due shows the machine stalled
  the test's process, not the hub (the plant's holds never delay it: the load process kept within 4.0 ms of its
  timetable in every plant run analysed). Hooks whose exchange overlaps such a stall (from the late hook's due
  time to 50 ms after it started) aren't judged. When more than 5% of the hooks are set aside, or fewer than 1,000
  are left, a run with no late reply among the judged hooks is INCONCLUSIVE (skipped, never passed). A late reply
  among the judged hooks fails the run whatever else was set aside. The wrong-program test skips the same way only
  when it found no late reply.
- **No reference-Mac gate.** The criterion names no machine, unlike AC12's budgets, so the thresholds hold anywhere;
  on an oversubscribed machine a correct hub's own process can be descheduled for tens of ms and fail (below).

## What I left out

- Acks within 20 ms (AC19's and the protocol's), and anything about the hooks' events in the log beyond telling them
  from the backfill's.
- The reference-Mac gate and repeated runs of `judge` (AC12's budgets).
- Checking which thread did the work: the criterion judges by the replies, and the plant is caught by them.

## What the stand-in checks showed

Throwaway stand-in hubs in my scratchpad, run through a copy of this suite whose `packages/cli/dist/main.js` was the
stand-in (deleted afterwards). Each kept its record on a writer worker and answered hooks on its main thread; the
plant (`DEEP_HUB_PLANT=commit-on-event-loop`) waited every sync (the ten verdicts' FULL commits and the checkpoint)
on its main thread instead, with Atomics.wait for the 50 ms, and nothing else different. Variants moved the holds:
a random 0 to 15 ms or 0 to 300 ms before each verdict, or none (setImmediate), and a backfill stretched by 40 ms a
slice (20,000 to 70,000 hooks per run). The machine was oversubscribed throughout (load averages 45 to 170 on 12
cores).

- **The plant was caught every time**: about 17 runs across all variants and the drafts of this test, 4 of them on
  the final version (holds 0 to 15 ms apart, none apart, 0 to 300 ms apart with the stretched backfill, and two syncs
  per checkpoint). Each time the same check threw naming the first late reply's request ID, and the test's own
  recomputation found that ID. The worst window's p95 was 45 to 157 ms. The window alone would have caught each:
  in the stretched-backfill runs the plant's whole-run p95 was 0.41 and 0.99 ms (under 2 ms), its worst window 77
  and 92 ms. Replies of 50 ms or more: 40 to 529 a run. The load process's lag behind its timetable stayed at most
  4.0 ms in the five plant runs analysed (p95 1.2 to 1.3 ms), so no plant hook was set aside.
- **Heavy work before the hooks** (`before`: the ten verdicts committed at start, with the loop held, before any
  hook; the load then skipped them): both tests failed at assertion 3, "the log held verdict.made <ten IDs> before the
  load call was sent", twice.
- **Heavy work after the load returned** (`after`: `done` at once, the work 2 s later): both tests failed at
  assertion 3, "the load appended 0 verdict.made events, not 10", twice.
- **The correct stand-in passed, but not every time on this machine.** On the final version it passed once and
  failed twice on noise: no reply of 50 ms, nothing unanswered, overall p95 0.64 and 0.80 ms, but one window at 8.9
  ms and one at 3.2 ms. In those windows the hub process was descheduled while the load process stayed on time, so
  nothing was set aside. With the stretched backfill, its load call didn't finish within the 300 s limit (twice), so
  that case isn't shown for the correct hub. Earlier drafts of the same check gave the same picture: passes with
  worst windows of 0.44 to 0.86 ms, and noise failures of 2.3 to 4.6 ms. So on an oversubscribed machine a correct
  hub can fail this test, and a dispute should rerun it on a machine that isn't. I didn't wait for a quieter machine.

## Type check

`node node_modules/typescript/bin/tsc -p tests/acceptance/16/tsconfig.json` (Node 24.22.0): no errors.

## Run on the base

Node 24.22.0, `npm ci`, `npm run build --workspaces` (the first failed on build order, the second passed), then
`node node_modules/vitest/vitest.mjs run --root tests/acceptance/16 hotpath-ac18-redraft` (exit 1). Both tests fail
where they should: the base's CLI has no `hub` command, so `deep hub run` exits 2 and `startHub` reports BLOCKED.

```
 RUN  v5.0.5 ~/dev/claude-worktrees/github-issue-16-acaf52/agent-abdb2fc80884ae5da/tests/acceptance/16

 ❯ hotpath-ac18-redraft.test.ts (2 tests | 2 failed) 472ms
   ❯ AC18 #16.0edb254f with every sync held 50 ms, the hooks stay fast beside FULL commits, a checkpoint and a backfill (redraft) (2)
     × AC18 30 sessions send 1,000 PreToolUse hooks beside ten FULL verdicts, a WAL checkpoint and a 50,000-event backfill: round trip under 2 ms at p95, no reply 50 ms 295ms
     × AC18 (wrong program) commit-on-event-loop: the same check fails, naming the first late reply 176ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  hotpath-ac18-redraft.test.ts > AC18 #16.0edb254f with every sync held 50 ms, the hooks stay fast beside FULL commits, a checkpoint and a backfill (redraft) > AC18 30 sessions send 1,000 PreToolUse hooks beside ten FULL verdicts, a WAL checkpoint and a 50,000-event backfill: round trip under 2 ms at p95, no reply 50 ms
Error: BLOCKED: the hub didn't start (deep hub run): exit {"code":2,"signal":null}; stderr: Unsupported command. Run deep --help for available commands.

 ❯ startHub helpers.ts:249:11

 ❯ scenario hotpath-ac18-redraft.test.ts:84:15
 ❯ hotpath-ac18-redraft.test.ts:243:15

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  hotpath-ac18-redraft.test.ts > AC18 #16.0edb254f with every sync held 50 ms, the hooks stay fast beside FULL commits, a checkpoint and a backfill (redraft) > AC18 (wrong program) commit-on-event-loop: the same check fails, naming the first late reply
Error: BLOCKED: the hub didn't start (deep hub run): exit {"code":2,"signal":null}; stderr: Unsupported command. Run deep --help for available commands.

 ❯ startHub helpers.ts:249:11

 ❯ scenario hotpath-ac18-redraft.test.ts:84:15
 ❯ hotpath-ac18-redraft.test.ts:250:15

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  1 failed (1)
      Tests  2 failed (2)
   Start at  20:09:57
   Duration  687ms (tests 90%, transform 6%, import 3%, worker 1%)
```
