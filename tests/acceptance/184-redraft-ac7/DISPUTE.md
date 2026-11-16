# Dispute: #184 criterion 7, a policy on an undeclared control "refused before any run"

The first draft is `tests/acceptance/184/ac07-bots-refused.test.ts` (blind suite commit `0ae7a3977`, base `0e5572731`).
This folder is its blind redraft (`90b2141e3`): one fresh run of the acceptance job, given the issue, the design and the
base with the first suite, never the work, the diff or this dispute, which wrote criterion 7 alone.

**What fails, in both drafts.** Clause 1 (a logic bot that traps makes its run invalid, and the check can't pass) passes
in both. Clause 2 fails in both on one assertion, that no call reaches the replica at all:

```
first draft:  no replica played anything for it: expected 7 to be 6
redraft:      no play reached the replica: the refusal comes before any run: expected [ …(8) ] to deeply equal []
```

On the work, the policy's play is refused by the replica before it plays a step (`control_undeclared`, naming jump), the
check counts no run of it, doesn't pass, and names jump. The first draft sees that one refused call; the redraft, whose
route bot plays beside the policy, also sees the route bot's runs played before the policy's is refused.

**Why no program passes clause 2 in the suites' hub.** The hub both drafts open (`tests/acceptance/184/helpers.ts`,
`openHub`) gives the extension host a replica and no canvas core, and its replica (`Pool.hub`) logs every call it gets as
a play. A piece is named by `<doc>@<rev>`; only the replica holds its body, so nothing but a call to it can learn which
controls the piece declares. A refusal that names the undeclared control therefore needs one call to the replica, which
the log counts. In a real hub the plug-in could read the controls first through the canvas core (`deep.canvas.read`);
the suites' hub has none.

The design's rule holds: the redraft also fails on the work, so the first draft stands and nothing was edited.
`scripts/lanes.mjs` runs both folders alone.

## Your call, once

- **The replica's refusal is "before any run"** (recommended): the play is refused before its first step and the check
  counts no run, which is what the issue's Check input: playtest says ("refused before any run"). A third draft of
  clause 2 reads that from the replies (no step played, testsRun 0 for the policy, jump named) instead of the pool's log.
- **No call at all**: the plug-in reads a piece's controls through `deep.canvas.read` before any play, and a redraft of
  the suites' hub gives the host a canvas core that serves the maze pieces, so the playtest can refuse with no replica
  call.

## Ruled, Nov 15

The owner chose "The replica's refusal is 'before any run'" (their words in session: "Replica refusal counts"). A blind
job wrote clause 2 again on that ruling, in `tests/acceptance/184-redraft-ac7-2/`, which runs in its place; both
earlier drafts' files run by hand.
