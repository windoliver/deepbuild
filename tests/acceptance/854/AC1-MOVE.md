# #854's first criterion, split with #896

On Oct 31, 2026 the owner moved holding patch to settled frame to 4 ms out of #854 and into #896 ("Patch to
settled frame in O(dirty)"), so #854 can close on the bar it builds while #896 makes the patch path fast enough to
meet it.

| | Criterion | Its tests |
|---|---|---|
| #854, now `#854.ad11ae91` | Patch to settled frame is timed over 200 one-item patches on a 10,000-item board, CPU plus GPU, and fails past 4 ms at p95; a planted scheduler that runs every node on each frame fails, naming the frame and the nodes it ran | `patch.test.ts`'s first block (the release-built recording, the planted scheduler, the judge's made-up readings) and `budgets.test.ts`'s task entry, retagged from `#854.a24082e8` |
| #896, `#896.b89e4aff` | Patch to settled frame holds 4 ms at p95 over 200 one-item patches on a 10,000-item board, CPU plus GPU, on the reference Mac, judged by #854's `canvas-patch-settled` task | `patch.test.ts`'s last block: the reference-Mac p95 check and the lane's PASS, kept as written and retagged |

No assertion changed; the tests moved between tags only. Why the hold moved: in a release build on the reference Mac
every stage between a patch and its frame costs in proportion to the board (about 1 ms a patch at 1,000 items, 4 ms
at 3,000, 16–34 ms at 10,000), and GPUI's repaint of 10,000 quads alone takes about 5.7 ms; #896 lists each stage.
`BASE-FAILURE.txt` keeps the old tag as the base run printed it.
