# #2249: affected.mjs leaves a deleted test out of the run

These are the end-to-end runs for PR #2251, made on 2026-11-13 on Linux arm64. Each image is a screenshot of the `.txt` file of the same name. Scratch paths are redacted.

| Image | What it shows |
|---|---|
| [before.png](before.png) | Main's `scripts/affected.mjs`, run with no paths on PR #2091's head (acbfbf3a8), which deletes `tests/acceptance/303/checkfile.test.ts` and `tests/acceptance/322/approved.test.ts`. It crashes with `ENOENT` in `plan()` and exits 1. |
| [after.png](after.png) | The same run with #2251's script (81b630054), copied in first. It exits 0, and neither deleted test is selected. |
| [makeup.png](makeup.png) | What the after list is made of. #2091's own 21 tests are identical to what main's script picks when given #2091's surviving paths, which is the workaround. The other 20 are the tests reached by the copied-in script and the untracked `node_modules` symlink of the run's worktree. |
| [names.png](names.png) | The other half of #2249, not end to end, since no test on #2091 imports or names its deleted files. Each script's `select()` and `plan()` runs on temporary repos. Main also selects the deleted file and crashes, while the fix drops only that file. #2251's new unit test fails on main's script and passes on the fix. |

A separate agent checked the images against their sources over three rounds and re-derived every count. Its last verdict: valid, with no findings.
