# #25 AC2, live: blind redraft

A redraft of the live AC2 test in `../live/routes.live.test.ts` (its idle-wake pair), by a job that saw only issue #25,
the design sections it links (An ask, and your answer getting back; What each agent gives us; Hooks are evidence;
Numbers version 0 has to hold), `spikes/80/decision.json`, `adapters/claude-code.facts.json`, the recorded Claude Code
transcripts under `adapters/corpus/claude-code/` and the earlier blind job's `../live/` folder. It never saw an
implementation of #25. The implementing agent does not edit these files (AGENTS.md, Proof).

**Criterion:** AC2 `#25.ee0f30b0`, "An idle session wakes within 2 s of an answer at p95". **Proof line:** tests on
interactive sessions run by the harness (#48), never `claude -p`.

## How to run

```sh
node node_modules/typescript/bin/tsc -p tests/acceptance/25/live-redraft/tsconfig.json
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=... npx vitest run --root tests/acceptance/25/live-redraft   # by hand only: spends plan usage
```

Without `DEEP_HARNESS_LIVE=1`, the token, a `claude` on PATH or the harness's `deep-answer` scenario, both live tests
fail BLOCKED; nothing skips. The two instrument tests run anywhere, in milliseconds. The live pair takes about 15
minutes (six rounds of about two minutes, then one plant round that runs to the harness's 5-minute timeout). Safety,
temp folders and process handling are `../live/helpers.ts`'s (see `../live/README.md`, How to run). With `--root` here,
Vitest writes its cache to `node_modules/.vite/` in this folder; delete it before committing. The unit lane must not
run this file without the opt-in: like `../live/routes.live.test.ts`, it belongs in `scripts/lanes.mjs`'s by-hand list
and in a release lane run with `DEEP_HARNESS_LIVE=1`.

## The surface under test

Everything is `../live/README.md`'s contract, used as written there and imported from `../live/live.ts` and
`../live/helpers.ts`, not copied: the harness's `deep-answer` scenario with `--route idle-wake --rounds n` and its run
line and evidence (Additions, 1), the plant `waiter-never-wakes` (Additions, 2), the run (`live('idle-wake', …)`: a
temporary home, its hub, `deep setup`, your answer `b` with `deep inbox answer` 1 s after each round's turn is over),
the machine rule (`environmentProblem`) and the judge (`judge`, `percentile`).

## Defined here

1. **Your answer's time** is the record's `ask.answered` for the ask (its subject is the ask, or its data names the
   ask's ID), read from the hub after the run. A round whose record has no `ask.answered` with a readable time fails,
   naming the ask; the time `deep inbox answer` was started is never used in its place.
2. **Carries the answer**: the text holds one of the answer's IDs (the ask's, and every event the record keeps about
   it once answered), or the chosen option's label **without the other's**. The ask prompt the harness types names both
   labels, and so does any quote of it, so neither is ever read as the answer. A wake whose text names both labels
   must carry the ask's ID to count (the issue's AC4 has the transcript show the answer's ID).
3. **A wake** is a turn the harness didn't type, starting in session A, carrying the answer, seen in what Claude Code
   shows: a UserPromptSubmit payload the harness's hook recorded (#80: the waiter's stderr as a task-notification), or
   a transcript entry Claude Code wrote for it, the `queue-operation` enqueue of the prompt or the `user` entry of the
   prompt itself. Typed means: its text is one the harness typed, its `prompt_id` is a typed entry's `promptId`, or the
   entry is marked `promptSource: typed` or `origin.kind: human`. Tool results, the agent's words, subagent entries and
   other output Claude Code shows without starting a turn are never a wake.
4. **The window.** A wake counts for an answer only when stamped from 1 s before its `ask.answered` (two clocks on one
   Mac) up to the next prompt the harness typed after it. Past that prompt, the answer could have come with it, which is
   the next-prompt route, not a wake.
5. **A wake's time** is the earliest readable stamp among its pieces in the window: the hook payload's `at` (epoch ms)
   and each entry's `timestamp`. A missing, empty or unparseable stamp is never a number: such a piece proves a wake
   but gives no time. A round whose wake has no readable time fails, naming the ask; it never becomes NaN, a zero or a
   pass. **The delay** is the wake's time less your answer's time.
6. **The reply.** After the wake and before the next typed prompt, a Stop whose `last_assistant_message` holds the
   chosen label and not the other.
7. **The judgement.** Six rounds; round 1 is the warm-up and rounds 2 to 6 are five runs. The run's failures (any
   round without a wake, a readable time or the reply, fewer than six answered rounds, or a harness verdict other than
   PASS) fail the test on any machine. The five delays, each a finite number or the test fails, are judged by
   `../live/helpers.ts`'s `judge` against 2,000 ms ("at most"), and their p95 (nearest rank: of five, the largest) is
   printed and asserted at most 2,000 ms on a PASS. The machine's 1-minute load is read before, every 15 s during and
   after the run; off a reference Mac, with Low Power Mode on, a thermal state not nominal, or loaded past its cores
   at any reading, the timing is INCONCLUSIVE (the test skips with the readings), never PASS or FAIL. On a fit
   reference Mac, FAIL fails the test and INCONCLUSIVE skips with the five delays.

## Criteria to tests

| Test | Asserts | Wrong program it fails on |
|---|---|---|
| (live) six rounds | each answer wakes idle session A, carrying it, inside its window, with a readable time, and A replies with it; on a fit reference Mac rounds 2 to 6 are within 2 s of `ask.answered` at p95 | `waiter-never-wakes` (no wake, naming the ask); a wake over 2 s in all five judged rounds (FAIL); a wake whose time Claude Code doesn't show; the base: no `deep-answer` scenario (BLOCKED) |
| (live, wrong program) `waiter-never-wakes`, one round | the check above reports "didn't wake" naming the ask | a check that counts the typed ask prompt, a quote naming both labels, or the next prompt's context as the wake; a hub that doesn't know the plant (BLOCKED at start); the base (BLOCKED) |
| (instrument) time from Claude Code's stamps | on the recorded 2.1.304 `child-gates` transcript (a task-notification wake at 23:15:22.205Z, hook payloads with no `at`), with your answer at 23:15:10.000Z: the delay is 12,205 ms; with the queue entry's stamp removed, 12,218 ms (the prompt's); with no readable stamp on the wake, no time at all, while the wake is still seen | a reader that turns a missing stamp into NaN, or a missing hook `at` into a time |
| (instrument) a quote naming both labels | the same transcript with a queued text naming both labels at 23:15:15Z still reads 12,205 ms | a reader that matches the chosen label alone (it reads 5,000 ms) |

## Disputes

1. **Why redraft.** `../live`'s AC2 check reads the delay as the earlier of the wake's hook and a delivery entry,
   with `Date.parse` on an entry's `timestamp`: an entry without one gives NaN, which `Math.min` carries into the
   delays. Its "carries" matches the chosen label even beside the other, so a text quoting the ask prompt reads as the
   answer. And its judge passes an empty list. This redraft reads only finite stamps, requires the chosen label alone
   or an ID, bounds each wake by the next typed prompt, and requires a finite delay for each judged round.
2. **p95 over five.** The design's rule judges five runs; the nearest-rank p95 of five readings is their largest, so
   the judge's PASS (all five at most 2 s) is the p95 at most 2 s. A p95 over 2 s with some rounds under it reads
   INCONCLUSIVE, not FAIL, by the same rule.
3. **Hook `at` beside the transcript.** The harness's hook stamps `at` when Claude Code runs the wake's
   UserPromptSubmit, and Claude Code stamps the queued prompt and the prompt entry itself. The earliest of these is when
   the session first showed the wake; a correct wake can only be later than the answer, so taking the earliest never
   flatters a late one beyond the 1 s skew allowed for the two clocks.

## Files

- `ac2.live.test.ts`: the live pair and the two instrument tests.
- `tsconfig.json`: as `../live/tsconfig.json`.
