# Dispute: #2764's first draft names a criterion ID the issue doesn't have

**The first draft's tests are tagged `#2764.d93a7447`, which isn't #2764's criterion.** `tests/acceptance/2764/`
(`helpers.ts`, `AC = '#2764.d93a7447'`) names that ID in every test. #2764's one criterion, never edited
(GitHub shows no edit of the issue body), is `#2764.f88db370` by `criterionId` in `scripts/proof-change.mjs`, and by
the hub's own tagging in `packages/hub/src/acceptance.ts`: the first 8 hex digits of the SHA-256 of its text, trimmed
and with white space collapsed. Neither rule gives `d93a7447` for the issue's text.

So the trace lane at `e10eb0cae` (the change's commits say `Closes #2764`) reads:

```
FAIL trace: Closes #2764 refused: this change is Part of #2764; open: #2764.f88db370
```

Once the first draft runs in the before lane, trace also fails its tag as one that names no criterion of #2764.

**The redraft.** A fresh run of the blind job wrote `tests/acceptance/2764-redraft/` (commit `72fdadae3`). It was given
#2764's live body, its design sections (`node scripts/design-section.mjs --issue 2764`) and the base `914bd5f29`.
It never saw the work, the diff, the first draft or this dispute. It verified the tag `#2764.f88db370` from the issue
text itself (its README). It names its plant `proceed-ends-at-child-prompt`. The work's plant, the same query,
takes that name in `4983ccb14`.

Not yet run: the redraft on the work, on the merge base and on its plant. They come from the PR's bounded affected run
and the before and trace lanes at the head. The PR comment gives their lines.

## Your call, once

- **Swap in the redraft** (recommended): it runs in the first draft's place. `scripts/lanes-lists.mjs` maps
  `tests/acceptance/2764/` to the redraft and lists it in `byHand`; the signed approval tag on that commit is owed with
  it. Note: trace still reads a by-hand file's tags (#3310), so the first draft's `#2764.d93a7447` keeps trace at FAIL
  ("names no criterion of #2764, by hand") while that folder stays. Closing #2764 also needs one of these:
  - the first draft retired: removed, with your tag on that removal, as #2043's was (`0d5a32d6b`);
  - or a ruling that a by-hand first draft's stale tag is exempt from trace, which is a change to the check.
- **A third draft**: name the reading to change, and a blind job writes the criterion's test again on that ruling.

Neither draft was edited.
