# Blind redraft of #1550's C1 and C3: how a `shape_text` row's text is read

Written from issue #1550, `AGENTS.md`, `docs/technical-design.md` (Dogfooding, Disputes), the original suite
(`../README.md`, `../wrap.test.ts`, `../helpers.ts`, `../probe.rs`, `../fixtures/texts.json`, `../BASE-FAILURE.txt`),
`DISPUTE.md`, and at the base `vendor/gpui-pre/src/text_system/line.rs` (`paint_line`, `line_paint_bounds`,
`aligned_origin_x`), `line_layout.rs` (`WrappedLineLayout`, `WrapBoundary`, `compute_wrap_boundaries`,
`_index_for_position`, `position_for_index`) and `text_system.rs` (`WindowTextSystem::shape_text`), on commit
`54e690e9` (base `dd83ac2f`, the original suite `f19d53a9`, the dispute). Not seen: any branch, worktree, pull request
or implementation of #1550. Nothing in `../` was edited.

## Judgement: the dispute holds

The original reads each later line's start on the `shape_text` route as the text offset of the glyph a wrap boundary
names. At the base that glyph is not where a row's text starts; it is the glyph drawn at the row's left edge:

- `paint_line` walks the glyphs in run and glyph order. At a boundary's glyph it moves down a row and sets the pen to
  `aligned_origin_x(origin, …, glyph.position.x, …)`, which for left-aligned text is `origin.x`, and places every later
  glyph by its `position.x` less the one before. `line_paint_bounds` takes a row's width as the next boundary glyph's x
  less this one's. So a row is a slice of the glyph sequence, drawn left to right, and the boundary's glyph is its
  leftmost.
- A right-to-left row, laid out correctly, has its logical end at the left. Whatever a correct wrapper does with the
  glyph order, the glyph it names is that leftmost glyph: the last letter of the row's last word (or its trailing
  space, or the paragraph's closing `?`). Read as a line start, a correct Hebrew or Arabic row reads as a break inside a
  word. The same holds for a pre-base vowel sign (Devanagari `ि`, U+093F), which CoreText draws, and reports, before the
  consonant it follows in the text.

So on those cases the original reading fails every correct program and can't tell a right wrap from a wrong one. That
breaks invariant 1's other side: a check result must be evidence, and a check no correct program can pass isn't. The
reading asked for reads what the row draws, as text, and is one a correct program can meet:

- A row is the glyphs from its boundary's glyph up to the next boundary's (the first row: from the first glyph). Each
  glyph covers its own offset up to the next larger glyph offset in the whole line, or the text's end; a row's text is
  what its glyphs cover. That handles a ligature (one glyph, several code points), a reordered cluster (`ि` before `म`)
  and a cluster of several glyphs at one offset (split across rows, it shows up in two rows).
- The rows must cover the text as consecutive ranges in text order. A wrap is the text cut into lines read top to
  bottom; rows that hold the text out of order (a right-to-left paragraph wrapped in visual order shows its last words
  on the first row) or that overlap don't say where any line starts, so they fail, never pass (invariant 2).
- A row's start is the smallest offset it covers, and that is what C1 and C3 judge, unchanged: not inside a word (C1),
  a `÷` of the case (C3).

On left-to-right text with no reordering, the smallest offset is the boundary glyph's, so this judges the same starts
as before. A program can meet it: break the logical text by UAX #14, then lay each row out in its own visual order
(the way UAX #9 orders a line after line breaking), so each row's glyph slice is one logical range. The base fails it:
its visual-order walk gives Hebrew and Arabic rows out of text order, and starts inside words elsewhere.

`wrap_line` is unchanged: its `Boundary.ix` is a byte of the text, so its starts are logical already.

## What changed

| | Original (`../wrap.test.ts`) | Redraft (`wrap.test.ts` here) |
|---|---|---|
| `shape_text`'s starts | the boundary glyph's offset, `runs()[b.run_ix].glyphs[b.glyph_ix].index` | the smallest offset each later row covers (`readRows`) |
| Row order | not judged; out-of-order starts judged where they fall | rows must be the text cut in text order; else a problem naming what each row holds |
| `wrap_line` | `../probe.rs`, `wrap` call | the same, unchanged |
| C3's plant | the allow-list twin's starts, judged by `caseProblems` | the same twin's lines as rows of code points, read by `readRows` and judged by `caseRowProblems`, the criterion's own judge |

Kept as they were: both criteria's full text and IDs, test names, expected values, `../fixtures/texts.json`, the
widths (C1: every px from the longest word to the whole sentence; C3: `narrowWidths`), the oracle
(`LineBreakTest.txt` via `lineBreakCases`, every start a `÷`, mandatory-break cases left out), the plant (gpui-pre's
allow-list as a greedy twin, `allowListStarts`) and its messages, the probe's font (`.SystemUIFont`, 12 px) and
`measure`.

C3's judge, `caseRowProblems`, runs the original `caseProblems` over the starts and adds one problem per wrap whose rows
aren't in text order, in the same form: `LineBreakTest.txt:<line>: <route> at <w> px draws rows that aren't the case cut
in text order (row 1 holds …, row 2 holds …): <case>`. C1 adds `<script>, shape_text: draws rows that aren't the
sentence cut in text order (first at <w> px: row 1 holds …)`.

## The surface

The same as the original's (`../README.md`, "The surface"), with one more probe for the one thing the original probe
doesn't answer, each row's glyph offsets:

- `../probe.rs` (`acceptance_1550_probe`), unchanged: `measure`, and `wrap` for the `wrap_line` route.
- `probe.rs` here (`acceptance_1550_redraft_probe`): `{"call":"rows","text":s,"widths":[px...]}` →
  `{"ok":true,"rows":[[[k...]...]...]}`, for each width `WindowTextSystem::shape_text(text, 12 px, runs, Some(width),
  None)`'s rows in the order `paint_line` draws them, each the code point offset of each of its glyphs in glyph order
  (`-1` for a byte inside a code point). It reads only `WrappedLine::runs()` and `wrap_boundaries()`, both public, the
  same two the original read, and judges nothing.

`helpers.ts` here holds the redraft probe's build and run (`useRowsProbe`, `rowsAll`), the reading (`readRows`,
`rowsOf`) and C3's judge (`caseRowProblems`); everything else is imported from `../helpers.ts`.

## Tests, as `vitest list --root tests/acceptance/1550/redraft` names them

```
wrap.test.ts > #1550.1699487d (C1) Greek, Arabic, Hebrew and Devanagari sentences wrapped at every width from the longest word up never break inside a word
wrap.test.ts > #1550.8fc59257 (C3) every boundary chrome picks over LineBreakTest.txt at narrow widths is a break the file allows
wrap.test.ts > #1550.8fc59257 (C3) wrong program: a planted allow-list path fails, naming the line
```

The names are the originals', so a swap keeps any row that names them; top-level, plain strings, no `describe`.

## Run them

```sh
npm ci                                                     # once
npx tsc -p tests/acceptance/1550/tsconfig.json             # covers redraft/ too
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/1550/redraft --no-file-parallelism --testTimeout=600000
```

The file builds both probes (`useProbe` from `../helpers.ts`, then `useRowsProbe`) with
`cargo build --locked -p deep-replica --features env-plants --example <name>`; a failed build fails every test
`BLOCKED` with cargo's words.

## What the base shows

Run once on `54e690e9` (`BASE-FAILURE.txt`, with the wiring below added for the run and taken out again):

- **C1 fails on its assertion**, 642 problems on both routes. `wrap_line` as the original found it (`κόσμ|ε,`,
  `بال|عالم،`, `עו|לם,`, `द|ुनिया,`). `shape_text`, read as rows: Greek breaks inside words as before; Arabic and Hebrew
  draw their rows in visual order, the sentence's last words on row 1, and break inside words (`ה|שינוי`); Devanagari
  splits the cluster `र्क` of `पार्क` across two rows (its reph's glyph, drawn after `क`, starts the next row), which the
  original read as a start at the reph, and breaks inside words (`मौस|म`).
- **C3 fails on its assertion**, 14,185 problems, each naming its `LineBreakTest.txt` line: `wrap_line`'s forbidden
  starts as before (first `:15209`), `shape_text`'s rows out of text order on right-to-left cases (first `:132`,
  `× 2757 × 0020 ÷ 05BE ÷`: row 1 holds 1–2, row 2 holds 0) and their starts at offset 0. The original counted 8,466;
  the redraft counts order problems as well as starts.
- **C3's plant passes**: the planted allow-list path, read as rows through the criterion's judge, fails it with 2,276
  problems, the first `LineBreakTest.txt:15209: the planted allow-list path at 20 px starts a line between U+0308 and
  U+2757, where the file has ×: × 0020 ÷ 0308 × 2757 ÷`, and each of the first 50 names the line holding its case.

What the redraft doesn't show at the base, and can't: that a correct program passes. No implementation exists on this
commit. The argument that one can is the paragraph above (break the logical text, then order each row visually).

## What the implementer adds (outside this folder; this job edited nothing there)

`crates/deep-replica/Cargo.toml`, beside the original's `acceptance_1550_probe` block (no new dependency, so `Cargo.lock`
doesn't change):

```toml
# Issue #1550's redraft of C1 and C3: shape_text's rows as the glyphs each draws (tests/acceptance/1550/redraft/REDRAFT.md).
[[example]]
name = "acceptance_1550_redraft_probe"
path = "../../tests/acceptance/1550/redraft/probe.rs"
```

When the owner swaps the redraft in, `../wrap.test.ts`'s C1 and C3 tests (and C3's plant) give way to these; C2, C4
and `../probe.rs` stay, so the original `[[example]]` stays too. `scripts/lanes.mjs`'s line for
`tests/acceptance/1550/` covers `redraft/` as a path prefix.
