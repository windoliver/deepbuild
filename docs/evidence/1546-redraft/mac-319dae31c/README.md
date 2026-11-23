# The #1546 redraft on the Mac (MacBook Pro, 2026-11-22)

Run from the redraft's first branch at 319dae31c, whose `tests/acceptance/1546/` is the same as this PR's (a30638eb2 carries 319dae31c's edit unchanged). Local merges only, never pushed; `exits.txt` has load, power, display and each exit code.

| clone | `ac1-journey.test.ts` |
|---|---|
| main 678622403 with the redraft, and #3077's AC5 redraft (7c8d9a28d, `tests/acceptance/1172/` only) merged too, as `exits.txt` shows | 4 failed, 2 passed of 6 (`base-1546-ac1.txt`): the three seeds and the planted-view seed die on the resize panic (`entity_map.rs:164:36`), which #3012 fixes |
| #3012 at 5630469a7 with the redraft | **6 passed of 6** (`fix-1546-ac1.txt`), among them both redrafted tests |

The planted record-in-thread-local test passes at the base too: its planted program fails the judge there as well, which is what it asserts. Load was 41 to 121 across the round; one display, the built-in screen.
