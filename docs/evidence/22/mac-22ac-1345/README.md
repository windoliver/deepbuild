# Mac round 22ac: 1345 AC8 on main and before this PR's fold commits (2026-11-18)

Round 22ab found that #1345's AC8 failed at 4d7224ce5, with "the list has no row for ask:… to say when its recommended answer applies". This round ran `tests/acceptance/1345/batch.test.ts` once at each of two heads on the reference Mac (AC power, thermal 1, Windows App in front, no load wait):

| Head | AC3 | AC7 | AC8 |
| --- | --- | --- | --- |
| 3f2f86464, this branch's merge of main d4cef00fb, before its last four fold commits | pass | pass | **fail**, same text |
| f17fa347c, origin/main | pass | pass | **fail**, same text |

AC8 fails on main itself, so this PR didn't cause it. It started failing on this branch with the main merge, which came after round 22aa passed at 4c5617fe. Read the raw `1345-batch.txt`: `exits.txt`'s AC lines say "not found" because the runner's grep didn't strip vitest's colour codes.
