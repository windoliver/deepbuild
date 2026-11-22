# Blind redraft of #1101's criterion 1: the push held 10 s on the hub's clock

A redraft of AC1 in `tests/acceptance/1101/push.test.ts`, written blind at the first draft's commit `6a4df9a89`, which
has no implementation. It was written from issue #1101, the design (`docs/technical-design.md`, Plans before acting, "A
hold before what can't be undone"), the first draft and the base, and from a base fact the coordinator passed on
(below). No other worktree, branch, pull request, stash or plan was read, and no code that implements the hold. The
implementing agent doesn't edit these files (AGENTS.md, Proof). This folder's `push.test.ts` runs in place of the first
draft's `push.test.ts` as a whole: AC3 (`#1101.2d545cc0`) is copied into it unchanged. Nothing under
`tests/acceptance/1101/` changes; the swap is the coordinator's.

Criterion 1, `#1101.5140ae1c`: "Approving a fixture push starts no git process for 10 s. The receipt shows "Starts in
10 s · Undo", counting down on a virtual clock, and the push starts at 10 s. A planted card that starts the push at the
click fails, naming the step".

## Why a redraft

On a candidate implementation, on the MacBook Pro, run alone twice, the first draft's AC1 failed with "a git process
pushed main to origin before 10 s into its hold", and its plant test failed because the clean hold already failed. AC3
passed both times.

The base fact, a timing log taken in the first draft's `scene()` just before its `hold` list, relative to the yes on the
hub's clock: both tries, sent at 0.4 s and at 9.0 s, were kept waiting by the hub and let through at 10.04 to 10.08 s,
and both ran. The first draft's `remoteHas(main)` was read at 10.09 to 10.17 s and found main.

So the hub let nothing through before 10 s, as the design says ("starts only after a 10 s hold the hub keeps"). The
first draft's check of the tries found none let through inside the hold, rightly. But its next check read origin with
no regard to the hub's clock: `attempt()` waits up to 3 s of real time for a reply, the hub's clock runs with real time,
so by the time the 9 s try's `attempt()` returned the clock was past 10 s and the push had run. A push that started at
10 s was reported as one before 10 s, and an honest program failed.

## What the redraft holds

Same surfaces as the first draft, from `../1101/helpers.ts` (read only): `world`, `Agent`, `held`, `pressAllow` and
`allowOnCard`, the fixture `git push origin main` to a bare `origin`, `heldReceipt` over a copy of the record taken during
the hold, and the plant `hold-starts-at-click`. The flow is the first draft's: a try right after the yes, the clock
stepped to 9 s, a try there, then the clock stepped to 10 s and the push let through.

- **No try let through before 10 s.** Unchanged: a try whose `at` (the hub's clock read right after its reply, never
  earlier than the hub's decision) is before the yes + 10 s fails, naming the step. A try kept waiting and let through at
  or after 10 s isn't counted.
- **Origin is read only inside the hold.** Each read of the bare repository sits between two reads of the hub's clock,
  and counts only when the second clock read is before the yes + 10 s. Origin holding main at such a read fails, naming
  the step, whether or not a try was let through, so a host or card that runs `git push` itself is caught too. Origin is
  read three times: after the first try's `attempt()`, right after the clock is stepped to 9 s, and after the 9 s try,
  whose `attempt()` now waits only half a second of real time so the read lands before 10 s.
- **The hold must be seen.** As in the first draft, a run with no try made inside the hold is INCONCLUSIVE. New: so is a
  clean run whose every read of origin ended at or after 10 s, since then no push inside the hold could be seen. Neither
  is ever a pass.
- **The push starts at 10 s.** Unchanged: once the clock is stepped to 10 s a waiting try comes back let through, or a
  new try is, and the push reaches origin.
- **The receipt** is read as in the first draft (`heldReceipt`): "Starts in 10 s" with Undo 200 ms into the hold, and
  "Starts in 6 s" with it 4.2 s in.
- **The plant** `hold-starts-at-click` lets the push through at the click: the try right after the yes is let through
  at about 0.4 s, and origin holds main at the read after it, both well inside the hold. Each failure names
  `git push origin main` with its ask. The plant test still holds the clean run to the same judge first.

## What it leaves out

- **Two pushes for one yes.** In the base fact both waiting tries were let through, so `git push` ran twice for one
  yes. The issue says the step "starts only after a 10 s hold" and "the push starts at 10 s"; the design says the same.
  Neither says whether a call the agent repeats during the hold is let through once or each time it was made, so this
  redraft doesn't count how many tries the hub let through. The judge reads the first one let through. A criterion or a
  design line that settles it would need its own test.
- **A push in the last moments of the hold that isn't through a try.** Origin is last read about half a second of real
  time after the 9 s try is sent. A program that runs `git push` itself between that read and 10 s isn't seen. A push
  through a try let through then is still caught by the try's `at`.
- **How promptly the push starts after 10 s.** As in the first draft, the push is waited on for up to 30 s of real time,
  then a new try for up to 60 s, once the clock reads 10 s. A hold kept on real timers rather than the hub's clock isn't
  told apart from one on the hub's clock by this bound.
- As in the first draft: the other steps that can't be undone (a send to a public target, a delete outside staging, an
  external post) and the app quitting during the hold.

## Run it

As the first draft's suite runs (README of `1101/`), on macOS, one file:

```sh
npx vitest run --root tests/acceptance/1101-redraft-ac1 push --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1101-redraft-ac1/tsconfig.json   # type check
```

| Test | ID | Asserts | Plant |
|---|---|---|---|
| `#1101.5140ae1c approving a fixture push starts no git process for 10 s, its receipt reads "Starts in 10 s · Undo" counting down, and the push starts at 10 s` | `#1101.5140ae1c` | the bullets above | none |
| `#1101.5140ae1c a planted card that starts the push at the click (hold-starts-at-click) fails, naming the step` | `#1101.5140ae1c` | the clean hold passes; the planted one fails naming the step | `hold-starts-at-click` |
| `#1101.2d545cc0 after the push runs, …` and `… a planted receipt that still shows Undo …` | `#1101.2d545cc0` | the first draft's AC3, unchanged | `receipt-keeps-undo` |

Not run here (no Mac, no implementation). At the base the push runs at the click with no hold, so AC1 is expected to fail there as the first draft does; that is unverified.

## Files

- `push.test.ts`: AC1 redrafted, AC3 copied unchanged. Imports `../1101/helpers.ts`.
- `tsconfig.json`: the first draft's.
