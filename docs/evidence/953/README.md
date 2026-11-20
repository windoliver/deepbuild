# #953 mods.lib@1: evidence

Every number here comes from real `deep-logic` bakes at 0ae6fcd98 on macOS arm64 (2026-11-20). Each piece links `mods.tree@1.0.0` through `mods.lib@1`, and each total it read sits beside the brute-force recompute in `tests/acceptance/953/model.ts`. The pieces, scenes and wrong twins are the blind suite's own (`tests/acceptance/953/helpers.ts`, `scenes.ts`, `programs.ts`), baked once more to draw them. The acceptance tests are the proof; these files show what they saw.

- `evidence.png`: the whole page.
- `evidence.html`: the same page, interactive. Hover a node or a fuel bar to see its numbers; the fuel chart has a table of every step.
- `walkthrough.mp4`: 39 s, 13 frames of 3 s each, taken from the same page.

| Criterion | What the bakes read |
|---|---|
| 1 | 25 seeded trees × 50 edits: 174,420 totals, none off the rule. The stale twin is wrong on 24 trees; its first wrong total is node 20's attack, 42 (its value before the edit), where the recompute gives 61 |
| 2 | Before the move, holder A's archers read 12. After the item moves to B, A's archers read 10 and B's archer reads 12. The on-source twin reads 10 where the recompute gives 12 |
| 3 | 16 with the cap, 18 without. The percent-first twin reads 17 |
| 4 | The side aura raises nodes 1 to 6 by 3 and none of side blue's. The 3-round add reads 15, 15, 15, 15, then 10 |
| 5 | The 500-node, 2,000-row tree in a figure piece: logic.budget PASS. Its busiest step used 3,262,944 fuel, 27.2% of the 12,000,000 ceiling (merge base 86b99ac36, 0.25 ns per fuel) |
