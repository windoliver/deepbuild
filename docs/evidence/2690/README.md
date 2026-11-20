# Evidence for #2690

- `guard-a6a183c45.txt`: the proof guard at a6a183c45, the first fix: PASS (2 commits).
- `mac-a6a183c45-blocked/` (Mac): BLOCKED at base setup, because the base b4c099e2e didn't build (main's `footprint_unknown`, #2858, fixed by #2868). Nothing was tested. Main was merged in (53ef834e8).
- `mac-53ef834e8/` (Mac, 2026-11-19): the base (main a0d3713a7 + the blind tests) and the first fix, merged.
  - `#2690.50174a03` failed at both. At the fix, each ask row's name read `<question> · Approval` (or `· How it looks`, `· Pick one`), because the first fix named `row.word`, and in the app's list an ask row's `row.word` is its kind, not the hub's word. Fixed in the next commit, which names `needs you` in the language shown.
  - #1461 AC27 and #1172 AC3 (`rows.test.ts`) passed at the fix, so #1172's earlier failure (at e4dea91f3) didn't recur.
  - #1810's redraft failed only on the same word line.
  - #1459 AC6 failed before and after the retake, on the same structural difference: the "Needs you" heading has 1 child in the replica and 2 in the live tree (its count and the `needs-you-pop-out` button, on main since #1592). The stored captures already hold both, so this doesn't come from #2690; a run at main checks it.
  - `git-status-after-fix.txt` lists 15 staged `tests/acceptance/1810` files the Mac script's restore left behind. They didn't affect steps e–g.
- Linux affected runs at 53ef834e8: INCONCLUSIVE. The first was stopped for the main merge, the second by the Spark reboot (2026-11-19 20:24), the third was OOM-killed at its 24G cap, and the fourth was stopped when the fix changed. None was read.
