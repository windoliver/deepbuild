# #1101 AC1's blind redraft, made under the Dogfooding rule, fails on this change

The first redraft (`tests/acceptance/1101-redraft-ac1/`, a60466d22) wasn't blind: its job was given the failing
message and a timing log measured on this change. The review of ccdd0d871 sent AC1 to a fresh blind job. This folder
holds that job's draft and what it did on this change and on main. Nothing under `tests/` was changed by it.

## How it was made (Nov 23, 2026)

- **Its repository** held one commit, the base `6a4df9a89`, fetched alone by SHA (`git fetch --depth=1`) into an
  empty folder, so no branch, other commit or implementation could be read there. `6a4df9a89` holds the first blind
  suite, `tests/acceptance/1101/`, and no implementation of the hold.
- **Its inputs** were issue #1101's text, the design and the base at that commit, and criterion 1 with its ID
  `#1101.5140ae1c`, plus `#1101.2d545cc0` for the criterion-3 tests it copies unchanged. It was told to read nothing
  else: no other checkout, remote, PR or the network. It was given no dispute, no failing output, no timing log and
  nothing about this change. It was told only that its file runs in place of `1101/push.test.ts` as a whole.
- **Its output** is `push.test.ts.txt` and `redraft-README.md` here, byte for byte. `tsc` passed on them at the base.
  The job didn't run vitest.

## What it did

Run with `npx vitest run --root tests/acceptance/1101-redraft-ac1 push`, its two files copied over the first redraft's
in this worktree, uncommitted, on the MacBook Pro, on AC power at load 75–150:

| Program | Runs | AC1 `#1101.5140ae1c` (test, plant test) | AC3 `#1101.2d545cc0` (2) |
| --- | --- | --- | --- |
| This change at 066982297 (main ce6866e65 merged in) | 3 | **fail** each time: "the step `git push origin main` (ask:…): a git process pushed main to origin before 10 s into its hold"; the plant test fails because the clean run already fails | pass |
| main's hub (holds.ts, server.ts, wire.ts from ce6866e65; same tree otherwise) | 2 | pass | pass |

A temporary log, added beside the redraft's read of origin and then reverted, never committed, read the hub's clock,
relative to the yes:

```
tries [{"sent":412,"at":10039,"ran":true},{"sent":9501,"at":10039,"ran":true}] remoteHas read 10149..10180 ms -> true
```

Both tries were let through at 10.04 s on the hub's clock, after the hold. The redraft read origin at 10.15–10.18 s and
counted the push it found there as one before 10 s. The hub's test clock runs on with real time between steps
(`clock()` in `../1101/helpers.ts`). The redraft steps it to 9.5 s, sends a try, and waits up to 1 s for the reply.
This change keeps that try waiting until the hold ends at 10 s, so origin is read after 10 s. On main the hub refuses
that try at once, so origin is read at 9.5 s.

## What the rule says

Dogfooding (`docs/technical-design.md`): "When the new draft also fails on the work, the test stands and no one is
asked." This draft fails on the work, so #1101 AC1 stands as written, and the swap of the first redraft for it doesn't.
Each test is redrafted at most once. #321 AC1 (`#321.69952336`) still fails on main
(`../failing-first.txt`). A hub that keeps a call sent during the hold waiting until the hold ends passes #321 AC1 and
fails this draft and the first one (the first at 994a4b076, `tests/acceptance/1101-redraft-ac1/DISPUTE.md`). A hub
that refuses it at once does the opposite.
