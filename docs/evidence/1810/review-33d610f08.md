# Independent review of the final diff at 33d610f08 (2026-11-19)

A separate agent reviewed `git diff $(git merge-base origin/main HEAD)...HEAD -- . ':!docs/evidence'` read-only, given the issue and the code, not the author's conclusions.

**Result: no correctness defect.**
- `verdict-chat.test.ts` and `line.test.ts` pass: 2 files, 13 tests (the dist was built and held the change).
- **Width:** the tail ` (for X) · needs you: N` is counted in code points, as `verdictLine` counts, and taken off the 80 columns before the line is fitted. `room` never goes negative.
- **The count is never cut:** when even the shortest verdict line can't fit, the line passes 80 with the count still at its end. That is #83's rule for what wasn't verified and the outcome, and the unit test's twelve-INCONCLUSIVE case pins it.
- **Give-way order:** `verdictLine`'s own order goes first. Then the held reasons and the watch's reason give way, used only if that makes the line fit. The design sets no order for those two.
  - Design note, not a defect: they drop together. No input was found where keeping the watch's reason would have fit.
- **Empty reasons:** an empty held reason is filtered out. `watch-only` with an empty reason only arises on this path, because every production `watch.why` comes from `watchWords().short`, which is never empty. The other callers (`stop-judging.ts`, `status.ts`, `hub-readings.ts`) see no change.
- **The plant:** unplanted, nothing changes. Planted, it adds every `defaulted` ask, a fit wrong program, registered in both `Plant` and `PLANTS`.
- **AGENTS.md:** no new export, option or dependency, and imports go through public entries. The unit test checks exact lines and fails on the merge base, without the fallback, without the `<= room` guard, or without the `line.ts` change.
- **Criteria:**
  - AC1 is met (it already held at the base, as BASE-FAILURE.txt records).
  - AC2 is met.
  - AC3 is met by the code: the fixture's line was 98 columns at the base and fits at the head.
