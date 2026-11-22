# Dispute: #1101 AC1's first draft reads origin after the hold has ended

This redraft exists because of this dispute. The first draft is `tests/acceptance/1101/push.test.ts`, AC1
(`#1101.5140ae1c`) and its plant test; AC3 in the same file passes.

## What fails

PR #3062 (#321's push after your yes) has the hub keep a call sent during #1101's 10 s hold waiting, and let it through
once the hold ends, as the design says a step that can't be undone "starts only after a 10 s hold the hub keeps". Run
alone twice on the MacBook Pro (Mac18,1) at 994a4b076 (Nov 21, 2026), AC1 failed both times:

```
× #1101.5140ae1c approving a fixture push starts no git process for 10 s, … and the push starts at 10 s
  the step `git push origin main` (ask:…): a git process pushed main to origin before 10 s into its hold
× … a planted card that starts the push at the click (hold-starts-at-click) fails, naming the step
  the clean hold already fails, so the plant can't be told from it
```

A temporary timing log in the first draft's `scene()` (reverted, never committed) read, relative to the yes on the
hub's clock:

| Run | `remoteHas(main)` read at | try 0 (sent → let through) | try 1 (sent → let through) |
| --- | --- | --- | --- |
| 1 | 10.090–10.099 s, true | 0.413 s → 10.042 s, ran | 9.001 s → 10.042 s, ran |
| 2 | 10.143–10.167 s, true | 0.418 s → 10.080 s, ran | 9.002 s → 10.047 s, ran |

No try was let through before 10 s, and the first draft's check of the tries finds none. But `attempt()` waits up to
3 s of real time and the hub's clock runs with it, so its next check reads origin past 10 s, finds the push that ran at
10 s, and reports it as one before 10 s.

## How the redraft was made

The owner approved a blind redraft in the session on Nov 21, 2026. AC1 went to a blind job in its own worktree at the
first draft's commit (`6a4df9a89`, no implementation), given the failing message and the timing log above as the base
fact. It read no implementation. Its README says what it holds and leaves out; in short, origin counts only when read
while the hub's clock is still inside the hold, and a clean run with no such read is INCONCLUSIVE.

One yes let both waiting tries through, so `git push` ran twice. The issue and design don't say whether a call repeated
during a hold runs once, so the redraft doesn't count it (its README).

## The swap

`scripts/lanes.mjs` runs `1101-redraft-ac1/` alone, in place of `1101/push.test.ts`, which runs by hand.
Nothing under `tests/acceptance/1101/` changes.
