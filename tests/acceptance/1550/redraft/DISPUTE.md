# Dispute: how C1 and C3 read a line start on the `shape_text` route

C1 (`#1550.1699487d`) and C3 (`#1550.8fc59257`) read each later line's start on the `shape_text` route as
`line.runs()[b.run_ix].glyphs[b.glyph_ix].index`, the text offset of the glyph a wrap boundary names (README, "The
surface"; probe.rs). No correct wrapper can meet that reading for right-to-left text or for a cluster whose glyphs
are reordered, because of how the base paints a wrapped line:

1. **A boundary glyph is a row's leftmost glyph.** `paint_line` (`vendor/gpui-pre/src/text_system/line.rs`) resets
   the pen to the row's left edge at each boundary glyph and places every later glyph by its x position relative to
   the one before; `line_paint_bounds` takes a row's width as the next boundary's x less this one's. So whatever a
   wrapper does, the glyph a boundary names is drawn at the row's left.
2. **The leftmost glyph of a right-to-left row is the row's logical end.** A row of Hebrew or Arabic, correctly laid
   out, runs right to left: its first letter is at the right. `שלום עולם` on its own row shows `ם` at the left. Read
   as a line start, that is `עול|ם`, inside a word, for every correct row. This is what the 47 C1 problems and the
   3,084 C3 problems on right-to-left cases (`05BE`, `05D0`, Arabic) report, and what the base's visual-order walk
   reports too (README, "What the base shows": starts at offset 0 and out of order).
3. **A pre-base vowel sign comes first.** CoreText draws Devanagari `ि` (U+093F) left of the consonant it follows
   in the text, and reports the glyph at `ि`'s own offset. A row that correctly starts with `मिलाने` has `ि` as its
   leftmost glyph, read as `म|िलाने`.

So the reading fails every correct program on these cases and can't tell a right wrap from a wrong one there.

## The reading asked for

A row is the glyphs from its boundary glyph up to the next boundary's (or the end). Its text is the set of offsets
those glyphs cover, each glyph covering its offset up to the next larger glyph offset in the whole line. Then:

- the rows must cover the text as consecutive ranges, **in text order**: row k's offsets all precede row k+1's;
- a row's **start** is the smallest offset it covers, and that is what C1 and C3 judge, as now (inside a word for
  C1; a `÷` of the file for C3).

This keeps every expected value and fixture, judges the same starts on left-to-right text with no reordering (there
the smallest offset is the boundary glyph's), and still fails the base: its visual-order walk gives rows out of text
order on right-to-left text, and starts inside words elsewhere. It adds one thing the old reading can't see: a
right-to-left paragraph wrapped in visual order shows its last words on the first row, which reads wrong to anyone
reading it.

Asked of the redraft: redraft C1 and C3 only (their tests and their planted program), reading `shape_text`'s rows
as above, `wrap_line` unchanged. Keep `texts.json`, the widths, the oracle, `probe.rs` and the other criteria as they
are; if the probe must report more (each row's glyph offsets), name the smallest addition.
