# AC6 blind redraft

A fresh run of this suite's blind job, redrafting one test (AGENTS.md, Proof; technical design, Dogfooding):
`ask-redraft.test.ts`, test `AC6 … (redraft)`. Written at 1370d7eb (base 5f63620c plus this suite) from the issue,
the design and that commit only; no implementation of #1162 and no later commit was read. `ask.test.ts` is left as
it is.

## What was read

- Issue #1162: Scope, AC6, the Proof line ("the point-and-ask message as received"; "the planted point-and-ask box
  must … fail, naming the criterion").
- `docs/canvas-primitives.md`: Handles; the path grammar's sub-address; Selection (session state): the attachment
  `{handles, t, doc_rev, precision, region, u, quote}`, "selectable per item (true for parts and keyed rows)",
  `hit: {margin: 3 px, test: geometry | box = geometry}`, "The text of a text item under the pointer goes as
  `quote`, exactly as the document holds it and apart from your words"; Document envelope (`aspect`: "letterbox for
  films", and "letterbox scales the frame to fit, centered"); Item and kind (`role`); Item and kind: relations (box
  points, `beside`, `onto`); Vector and formula `vector@1` (parts `<item>#<id>`, `size`); Order keys (2D draws by
  layer, then item `order`); Marks in 3D and Overlay, only to see that a 3D label's place under a 2D pointer depends on
  readings this test shouldn't rest on.
- This suite's README, `helpers.ts`, `fixtures/` (`piece.json`, `formula.svg`), `BASE-FAILURE.txt` and `ask.test.ts`.
- The merged suites' READMEs and helpers for their surfaces: #384 (`ask`, `messages`, the playhead control, the
  planted boxes, "a text item by its text box, `at.pos` plus `params.box {w, h}`"), #400 (`pop_out`, `windows`,
  `presented` with `window`, "its panel keeps its ID, so `input`, `scope` and `presented` still name it, with
  positions in its own window's px"), #383 (`scope`'s `state.rect`, the canvas's rect in window px).

## Readings

1. **The pointer is on the `=` sign's ink**, the centre of its upper bar (SVG 52, 25), not the sign's centre
   (52, 32). The centre lies in the 8 u gap between the bars, 4 u from each: under Selection's default
   `test: geometry` with a 3 px margin it hits nothing of `eq` at one px per u, and under `test: box` it hits. The
   bar's centre is inside `eq`'s box and on its ink, so it names `#formula#eq` under either test.
2. **Where `eq` is**: the formula's evaluated box at 1.5 s from deep_query `items/formula/bounds` (this suite's added
   surface), with `eq` mapped in by the SVG's own geometry: the 240 × 64 viewBox fills `size: [240, 64]` edge to edge,
   so the box is the viewBox.
3. **Window px in the popped-out window** come from the view itself: `scope`'s `state.rect` after the pop-out, and the
   frame letterboxed into it, centred, at `min(w ÷ 960, h ÷ 540)` (the piece is a film; Document envelope: `aspect`).
   When the rect is 960 × 540 this is one px per u from its top-left, the reading the first draft assumed, so a view
   that opens at the panel's size passes under both; a view opened at another size is read as the design says.
4. **The text under the pointer is the title's own text item.** Quote is "the text of a text item under the
   pointer"; pointing at a part of a vector, the title's text can only arrive if a text item carrying it lies under
   the pointer, beneath the formula. The fixture's title sits at the top, nowhere near the formula; the first draft
   relied on the label in depth (a `mark.text@1` in the 3D layer) projecting behind the `=`. Whether that label counts
   as under a 2D pointer, where its anchor sits, and whether the 2D formula draws over it are readings neither the
   issue nor the design fixes. So the test's piece is `piece()` with two changes, built in the test file:
   - the title's `at.pos` set so its 600 × 40 text box is centred on the `=` sign's centre at 1.5 s (`at.pos` plus
     `params.box`, #384's text box; no relation, so it holds whether or not a text box is read through `at.place`).
     Its text, font, size and box are unchanged. The formula is placed beside the chart, which the title doesn't
     touch; the test reads the formula's box again with the title moved and requires the pointer inside the title's
     box with 2 u to spare.
   - the label in depth moved to `[-6, -5.25, -1]` m: 240, 480 px through the orthographic camera (24 m across 960
     px, 40 px a metre about the frame's centre), clear of the formula under any anchor, so no second item, 2D or 3D,
     with that text is under the pointer and nothing in 3D can take the pick.
   The handle stays `#formula#eq` under both hit readings: the formula draws above the title (`order` a2 over a0 in
   one layer), and the title's role is `label`, not selectable.
5. **"Paused at 1.5 s"** is #384's playhead control set to 1,058,400,000 flicks at 1.0 s on the clock; the ask goes at
   1.2 s, so a box that sends the clock's time fails.
6. **"The revision you saw"** is the `rev` of the last frame the popped-out window presented at or before the ask
   (`presented`, frames whose `window` is the pop-out's), not the current revision read separately. In this run the
   two are the same revision.
7. **"That handle"** is exactly one handle, `doc:<doc ID>#formula#eq`, the doc ID case-folded as #384's suite does.
8. **"Your words apart"** is `words` exactly "too small". **"The title's text arrives only as quote"** is `quote`
   equal to "Sales by region" byte for byte, and that text in no other string of the message as the session reads it.
9. **The planted boxes** are #384's `box_drops_doc_rev` and `box_folds_quote`, run through the same check; it must
   fail naming `AC6 doc_rev` and `AC6 quote`. A quote folded into `words` is named `AC6 quote` even if `quote` is
   also sent.
10. **One message** is the session's `messages` read after the ask; the message as sent is kept as proof only.

Proof files: `ac6-redraft-ask.json`, `ac6-redraft-ask-<planted>.json` and `ac6-redraft-planted.json` in the suite's
proof folder, named apart from the first draft's.

Not run: no implementation is this job's input. `npx tsc -p tests/acceptance/1162/tsconfig.json` exits 0.

## Swapped in

On the implementation, the first draft (`ask.test.ts`) failed only on the quote; this redraft passed:

```
AC6 quote: undefined, not the title's text "Sales by region"
```

The first draft placed the 3D label's anchor 150 px left of the `=` sign and read its text box as holding the pointer
"whichever corner or centre anchors it". The label draws centred on its anchor (203 px wide), so its box ends about
48 px short of the pointer: no program that hit-tests the label where it draws can quote it there. The redraft took
the swap on that mechanical defect (as #671's AC1 redraft did); `ask.test.ts` is removed.
