# Blind redraft for #1551: the still board's labels

Written by the blind redraft job (AGENTS.md, Proof; design: Dogfooding), from issue #1551, the design, the base
commit `dd83ac2f` and the original suite (commit `12b3ebb8`), never an implementation. It adds
`helpers-redraft.ts` and `window-redraft.test.ts`. No original file changes.

## The dispute

`window.test.ts` presents the canvas-idle lane's still board through `deep_show` with the label "Q3 revenue"
(`helpers.ts` `stillAsAgent`), and each hub event shows a new revision labelled "Q3 revenue, take <n>"
(`hubEvent`, n = 0, 3, 6). Both labels contain digits. `deep_show` checks the document first, and its number rule
(`crates/deep-canvas/src/document/rules.rs`, `shows_number`) refuses an unbound text item that shows a digit or a
number word as `number_unsourced`. So the board is never presented, and the window test cannot reach the display
link it means to measure. The lane works anyway because `benchmarks/canvas.mjs` sends `still.json` to
`deep-canvas-render idle`, which runs no document check.

## Evidence at the base

Release `deep-show` built from `12b3ebb8` (the base plus the suite only), kit ledger sealed by
`node scripts/canvas-kit.mjs` (PASS over every module). Each run sends the suite's own scenario to `deep-show run`:
`liveScenario({})` without `live`, plus `hubEvent(0)`, `hubEvent(3)` and `hubEvent(6)` as later `deep_show` calls.

With `helpers.ts`, all four replies are `"outcome":"refused"` with the same issue:

```
{"check":"document.validate","code":"number_unsourced","severity":"error","ids":["label"],
 "path":"items/label/params/text","actual":"Q3 revenue", ...}
```

The three hub events are refused the same way, with `actual` set to "Q3 revenue, take 0", "Q3 revenue, take 3"
and "Q3 revenue, take 6".

With `helpers-redraft.ts`, labels "Quarterly revenue", "Quarterly revenue, take a", "Quarterly revenue, take d"
and "Quarterly revenue, take g": all four replies are `"outcome":"presented"` with `"issues":[]`. The first creates
`card`, `label`, `q1`, `q2` and `q3`. Each hub event changes only `label`, so each is still a new revision of the
board, as C2 needs.

## The decision

Only the labels change. "Quarterly revenue" replaces "Q3 revenue". Hub event n is labelled
"Quarterly revenue, take <letters(n)>", where `letters` is bijective base 26 in lowercase (0 is a, 25 is z, 26 is
aa). Each label is different, and none contains a digit or a number word from the rule's list. The scenario,
the wakes, the planted programs, the timings and every assertion stay as `window.test.ts` has them.

## The exact diff from the originals

- `helpers-redraft.ts` re-exports everything in `helpers.ts`. It overrides three things. `stillAsAgent` now
  defaults to "Quarterly revenue". `liveScenario` is `helpers.ts`'s scenario with that board as its first call;
  it has to be overridden because `helpers.ts`'s version calls its own `stillAsAgent`. `hubEvent` uses the
  lettered label, with the same session, doc and `at`. It also adds `letters`.
- `window-redraft.test.ts` is `window.test.ts` with a header comment, the import pointing at
  `./helpers-redraft.ts`, and " (redraft)" at the end of each `describe` title. Nothing else differs.

`lane.test.ts` and `vendored.test.ts` don't send the board through `deep_show`, so they stand unchanged.
`window.test.ts` also stays in the suite, because no test is edited or deleted without an approved proposal.
`window-redraft.test.ts` proves C1, C2 and C4 in its place.
