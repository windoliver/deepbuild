# #182 oracle: the climb port disputed, and its blind redraft

`character-controller-rapier.test.ts` ports upstream's `character_controller_climb_test`. The port drops upstream's
−0.1 m downward push each step, so the body climbs the 0.6 rad slope about three times faster than upstream's. It
crests near step 136 and walks off the slope's end, where it is briefly airborne and stops below the crest's height.
Upstream's own comment rules that out: "the slope is long enough that the character never reaches its crest within the
iteration budget".

Under Dogfooding the test went back to the same blind job, with the issue, the oracle page, the upstream file and the
base, never the work or its diff. Its redraft, `182-oracle-redraft-climb/character-controller-climb-rapier.test.ts`,
lengthens the slope to keep upstream's reason. It passes on the work, and the first draft fails. Nothing in either
draft was edited.

| Criteria | First draft (disputed) | Blind redraft |
|---|---|---|
| 1, 3, 8, 10 (`character_controller_climb_test`) | `182-oracle/character-controller-rapier.test.ts`, its climb test | `182-oracle-redraft-climb/` (1 test, pass) |

On the owner's word on Nov 16, 2026 ("close whatever gaps you see"), the redraft runs in its lane in the first
draft's place. Lanes work by file, so the first draft's file runs by hand, its ground-detection and impulses tests with
it (both pass on the work). `controllers-py-rapier.test.ts` keeps its lane.

## The failing output on the work

```
character_controller_climb_test holds, and a body that ignores its own slope limit is rejected
AssertionError: rapier3d:
  can: airborne at step 147 (2 in all, 2 in a row): not grounded at all times up to isolated flickers
  the character that can climb ends at (16.188507080078125, 1.4743266105651855), not past x 6 and above y 3
  ❯ tests/acceptance/182-oracle/helpers.ts:51
```
