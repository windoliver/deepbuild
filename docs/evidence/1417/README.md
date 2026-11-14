# Evidence for #1417: graph.layout's cost and the size cap at check

The criteria, and where each is proven. Commits named here other than 131354fe and 6952e777 are from before the
2026-11-09 history rewrite; the branch holds each one's tree under a new hash: 93bf3553 is 8550bcbb, 3df7db49 is 77739248, db54f8cb is c90504cb and f735d8b9 is
605827b9.
`acceptance-linux.txt` and `acceptance-redraft-ac1-linux.txt` record no commit; each was committed straight on top of
the head it ran at (their commits' parents, 8550bcbb and 77739248). `acceptance-redraft-ac3-linux.txt` records db54f8cb with
the redraft's folder not yet committed; `acceptance-redraft-ac3-linux-head.txt` records 131354fe.
The Linux runs and the screenshots were taken in this worktree on the Spark (an NVIDIA DGX Spark, Linux aarch64). The
five `acceptance-*linux*.txt` files show the worktree's path, and the two AC3 ones name the machine; `e2e.txt` and
`shots.txt` record only Linux aarch64 and the `fail-*.txt` files nothing, so for them this is the author's word.

- **AC1** (a 100,000-node graph is refused with `over_budget`, naming the operator and its estimate):
  `acceptance-redraft-ac1-linux.txt`, AC1's blind redraft `tests/acceptance/1417-redraft-ac1`, at 3df7db49. Both
  tests pass: the board is refused naming `graph.layout` and its estimate, and main's own build presents the same
  document; both pass again at 131354fe in `acceptance-head-linux.txt`. It replaces
  `tests/acceptance/1417/over-budget.test.ts`, whose board #494 made invalid (approved by the
  user; the PR body quotes the approval).
- **AC2** (the `layered` fixture passes, its layout byte-identical) and **AC4** (a planted `layout` with no cost fails
  the module's check): `tests/acceptance/1417/layered.test.ts` and `planted.test.ts`, passing in
  `acceptance-linux.txt` (at 93bf3553) and `acceptance-head-linux.txt` (at 131354fe, the plant's kit failures printed);
the reruns after each merge between those aren't kept here, only the PR body's log of them.
- **AC3** (the estimate is within 2× of the measured layout time at 100, 1,000 and 10,000 nodes):
  `mac-air-redraft-ac3-pass.txt`, AC3's blind redraft `tests/acceptance/1417-redraft-ac3` on the MacBook Air M3 at
  f735d8b9, on mains power at load 2.23: PASS at all three sizes. It replaces `tests/acceptance/1417/estimate.test.ts`,
  whose gate took only one Mac (approved by the user; the PR body quotes the approval). The pass file's header says the graph
  crate is unchanged since f735d8b9; that's not quite so: main's 6952e777, merged since, changes
  `crates/deep-canvas-graph/src/route.rs` (edge routing, which the view calls, not the layout AC3 times), and main's
  merges change other files in `deep-canvas` and `deep-show`, which compute the estimate. `cost.rs`, `costs.json` and
  the test are unchanged, and `acceptance-redraft-ac3-linux-head.txt`, the redraft run at 131354fe, prints the same
  three estimates to the last digit as the pass (0.10403…, 1.26340… and 16.54089… ms); the layout it times changed
  only in routing it doesn't call. Readings that don't count, each for the reason in its file:
  `acceptance-linux.txt`, `acceptance-redraft-ac3-linux.txt` and `acceptance-redraft-ac3-linux-head.txt` (not a reference Mac; `acceptance-linux.txt`'s pairs,
  0.958, 0.982 and 1.024, were taken on the Spark with the old test), `mac-air-reading.txt` (the old test's one-Mac
  gate), `mac-air-redraft-ac3-reading.txt` (loaded by its own builds) and `mac-air-redraft-ac3-rerun.txt` (on battery).
- Regressions the reviews found: `fail-unbudgeted-warning.txt` and `fail-recheck-with-old-gate.txt`, the new tests'
  output on the code before each fix (the commits that added them say which). The first test in
  `fail-unbudgeted-warning.txt` passes at the head under its name. The second,
  `a_patch_that_makes_an_unbudgeted_item_costly_is_warned_on_recheck`, was rewritten before it was committed as
  `a_patch_to_one_costly_item_is_warned_on_what_the_whole_document_declares` (two costly items rather than one, the
  same assertion); `fail-recheck-with-old-gate.txt` is that test failing against the old gate, and it passes at the
  head.
- `e2e.mjs` / `e2e.txt`, at 3df7db49: the canvas check path, `deep-show run`'s `deep_show` call on the shipped build,
  one `graph@1` item per board. In the data view class (2 ms of frame CPU), 1,000 nodes present (about 1.28 ms by
  the layout's cost below; a presented board's reply carries no estimate). 10,000 and 100,000 nodes are refused with
  `over_budget`: `ids` holds the graph, `actual.operators["graph.layout"]` is the layout's estimate (16.5 ms and
  204.9 ms), and `what` names the costliest operator, `graph.layout`. The same 100,000 nodes beside a rect a clip
  moves are refused too; there `graph.layout` is 204.8765 ms, 10,792 ns less, because an item still while others
  move pays what its operators declare but not their per-item terms (`crates/deep-canvas/src/cost.rs`, by design).
  In the export class (no frame cap) they present.
- `shots.mjs` / `shots.txt` / `shots/` / `shots-check.txt`: the screenshots, below.

The layout's coefficient, 46 ns per row and doubling (rows = nodes + edges), was fitted on the Spark from
`deep-graph layout`'s `timed` answers at 100 to 10,000 nodes, which gave 44 to 49 ns (the comment above
`NS_PER_ROW_DOUBLING` in `crates/deep-canvas-graph/src/module.rs` gives the range; the PR body names the machine; the
fitting runs weren't kept). AC3's pass on the
Air checks it. It sits in the graph module, not in `costs.json`: the bench fits the operator's per-item term apart
from it and doesn't measure it, a deviation from "coefficients come from micro-benchmarks on the reference Mac"
until a follow-up moves it into the bench.

## Screenshots

`shots.mjs` / `shots.txt`, at 131354fe on the Spark (`shots.txt`'s first line, the command, commit, time and platform, was
added by hand; a rerun prints the rest): the same check path as `e2e.mjs`, asking each reply for the
pixels of t = 0 too. Each board places its one `graph@1` item at (8, 8), scaled so the whole layout fits the
1280 × 720 frame with 8 px to spare; the 2 px outlines straddle the boxes' edges, so dark pixels start at 7. `graph@1` draws only its nodes' boxes, as 2 px outlines that don't scale (#494's
drawing, unchanged here). So the more nodes a board holds, the less of its structure its image shows: at full size
and at 0.318 every box can be counted; at 0.0604 the 150 ranks, 4.7 px apart, still show as 150 dark bands, but the
100 boxes in each mostly merge (a few rows still part into up to 99 runs) and can't be counted reliably, and the gaps between bands vary in brightness in a cycle of about seven ranks (the 4.7 px
pitch aliasing on the pixel grid), which can read as fewer stripes by eye;
at 0.0158 the 100,000 nodes fill a solid band, so that image shows only the layout's extent. What each board does is
in its reply; warnings and refusals aren't drawn. The scales differ, so compare the images' shapes, not their sizes:
the 15,000-node column (100 boxes a rank) is narrower than the 1,000-node board (50 a rank) only because it's drawn
at 0.0604 against 0.318.

| Board | Reply (`shots.txt`, which lists every issue a reply holds) | Screenshot |
|---|---|---|
| 24 nodes, data view | presented, no `over_budget` | `shots/small-data-view.png`: 4 ranks of 6 boxes at full size |
| 1,000 nodes, data view | presented, no `over_budget` | `shots/1000-data-view.png`: all 20 ranks of 50 boxes, at scale 0.318 |
| 100,000 nodes, data view | refused: `over_budget` error naming `graph.layout` at 204.887 ms (AC1's refusal again; its proof is the redraft) | none: a refused board draws nothing |
| 100,000 nodes, export | presented, no `over_budget` (no frame cap) | `shots/100000-export.png`: a solid band of the layout's extent, 79,976 u by 7,752 u, at scale 0.0158 |
| 1,000 nodes, no budget class | presented, no issues at all | `shots/1000-no-class.png`: byte-identical to the data-view board's, since the class doesn't change the drawing; its reply is the evidence |
| 15,000 nodes, no budget class | presented with an `over_budget` warning: the items cost 26.1 ms a frame, past the 16 ms budget | `shots/15000-no-class.png`: a column of 150 dark bands, the layout's extent 7,976 u by 11,652 u, at scale 0.0604 |

A reply carries an estimate only with an `over_budget` issue. By the layout's cost (46 ns · rows · log2(rows), rows
being nodes and edges) plus `costs.json`'s per-item terms (graph.layout's 10,792 ns and the other operators' about
0.0124 ms for one item), the 1,000-node board costs about 1.28 ms, under the data view's 2 ms and the 16 ms frame. Where a class refuses a board, the pair above shows it: the same 100,000 nodes
are refused in the data view and presented in export.

Fresh agents checked these screenshots in rounds, each round's findings fixed before the next, until round 16 found
nothing; `shots-check.txt`
records each round: how many agents, what each was shown, what it found and what changed. Round 1 checked an earlier, unscaled capture; every
later round checked these images. Each agent got the issue and the evidence files. Rounds 1 and 2 had no review log to read; from round 3 on,
the files included `shots-check.txt`, so each agent knew the earlier rounds' findings. Their word isn't evidence: the replies,
images and `shots.mjs` are, and anyone can rerun the script and compare its images with the sha256s `shots-check.txt`
lists.

Seen and left alone, as they aren't #1417's:
- `graph@1` draws no edges or labels, and its boxes start at the item's origin; the 8 px space is the board placing
  the item (#494's drawing).
- The no-class warning prints its total unrounded and doesn't name `graph.layout` (#138's wording). It sums what kinds
  and operators declare, so it leaves out `costs.json`'s per-item terms: for one graph item, graph.layout's 0.0108 ms
  and the other operators' (core.fields, core.transform, core.world, look.palette and marks2d.frame) about 0.0124 ms, about 0.023 ms in all. No outcome here changes.
