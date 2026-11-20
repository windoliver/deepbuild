# Acceptance tests for #732: PPTX export, a staged piece as an editable deck, one slide per stage, its text as text boxes

Written first, blind, from issue #732 (live, `gh issue view 732 --repo windoliver/deepbuild`: its Scope, Fields, eleven
acceptance criteria and Proof line), the issues it depends on (#501, #157, #507, #417, #373, #392), only for what they
say their surfaces do, the design sections it links and those they lean on, and the base commit `a0d3713a7`
(`a0d3713a74ce38caf4fdb4219cd34a0b971ade0e`, "Merge pull request #2847 …", main), by a job that never saw an
implementation; none existed, and no other worktree, branch, pull request or session was read. There is no oracle page
for #732. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

## What was read

- The issue and its dependencies, as above.
- `docs/technical-design.md`: Films and figures on the canvas (its Interactive figures and Export bullets), Dogfooding,
  and Tests written first.
- `docs/canvas-primitives.md`: Export (fields, receipt, Semantics: all or nothing, the export.fidelity floor,
  `export.target@1`, readers apart from writers), Export: Lottie (the closest sibling: what a format can't hold is listed
  by item; fidelity judged outside listed items' boxes), Marker: present mode (stages, notes, the `pdf` handout), Look
  `look@1` (roles, fonts with `license` and `embed`), Status binding, Bound value, Text `text@1` and its styled runs,
  Rect, Circle, Path, Paint (flat and gradient fills, strokes) and Paint: noise fill, Inset, Frame and group (passes,
  draw order, blend modes).
- At the base, only for surfaces: `crates/deep-show/src/{main,export,query,frames,hub}.rs`,
  `crates/deep-show/src/export/{run,pdf,lottie,tools,frames,test_guards}.rs`, `crates/deep-canvas-export/src/module.rs`
  (the export module registers only `lottie` in `export.target@1`), `crates/deep-canvas-marks/src/{look,scene,relations,
  noise_fill}.rs`, `crates/deep-canvas-marks/looks/clean.json`, `crates/deep-text/src/fonts.rs`,
  `crates/deep-canvas/src/document/rules.rs` (`number_unsourced`), `crates/deep-canvas-motion/src/doc/channel_of.rs`,
  `crates/deep-canvas-scene3d/src/inset.rs`, `scripts/{proof-change,benchmark,lanes}.mjs`; and the suites `507/`, `162/`,
  `501/`, `157/`, `169/` (the agent's record with a verdict and a reading), `392/`, `1653/`, `504/`, `506/`, `1162/`,
  `538/` and `1479/` (how a taste criterion's pictures are taken by the check run), `2760/` (budgets).
- Every fixture document below was shown with `deep show` at the base, its stills exported and its texts evaluated
  (`eval`), before any test ran on it: the base presents each, with no issue (README: Fixtures, at the base).

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
npm ci                                                                         # once, if node_modules is missing
scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/732 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/732/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/732/node_modules/.vite
```

Each file builds `deep-show` once in `beforeAll` (#501's `useShow`: `cargo build --locked --bin deep-show
--no-default-features --features full`, honoring `CARGO_TARGET_DIR`), and `ac9-atomic.test.ts` also the feature set
`full,test-export-guards` (#157's test canvas module, for `test.device_loss@1`), so after the first file the others reuse
cargo's build. Every `it` passes #501's one-hour timeout. Temporary folders (evidence stores, exports, LibreOffice's
profiles and renders) are made under the system temp folder and deleted after each test; no process is stopped by name
or port, and LibreOffice is stopped only by its own `spawnSync` timeout.

- **Needs:** LibreOffice for the files that render slides (`ac2`, `ac5`, `ac7`, `ac11`): found at
  `/Applications/LibreOffice.app/Contents/MacOS/soffice` or as `soffice` or `libreoffice` on PATH, its version logged
  with every render. Without it those tests fail `BLOCKED:` with one line (`brew install --cask libreoffice`; the pin is
  the cask's LibreOffice 26.8.3).
- **No decision:** a test that can't decide here fails with a message starting `INCONCLUSIVE:` or `BLOCKED:`; it never
  passes and is never skipped. A reply missing a field a test reads fails naming the field.

The implementer adds these lines to `scripts/lanes.mjs` (this job writes only its folder):

```js
// #732's files each build deep-show (ac9-atomic.test.ts also with test-export-guards), export decks through the GPU and
// render slides with LibreOffice; ac10-budgets.test.ts times exports and reads the machine's load.
alone.push('tests/acceptance/732/');
timed.push('tests/acceptance/732/ac10-budgets.test.ts');
```

## Criteria to tests

IDs are `#732.` and the first 8 hex digits of the SHA-256 of each criterion's text after `- [ ] `, trimmed, white space
collapsed (`criterionId` in `scripts/proof-change.mjs`). Every suite and test name starts `AC<n> #732.<h8>`.

| AC | ID | File (tests) | What it asserts |
|---|---|---|---|
| 1 | `#732.d05596c6` | `ac1-text-boxes.test.ts` (2) | The four-stage piece: four slides, the receipt's in stage order; on slide k one text box per text item stage k draws (`eval`'s `texts`: the title, the lede, the bound value's text) holding its string, its box within 0.5 pt of the evaluated box on every edge, each grapheme in its role's family, size, bold for weight ≥ 600 and role colour; no other text box. Planted `pptx_title_as_picture` fails, naming `tide_title` and a slide |
| 2 | `#732.3c7fee5e` | `ac2-renders.test.ts` (2) | Each slide rendered by LibreOffice at 1920 × 1080 meets export.fidelity's floor (PSNR-Y ≥ 40 dB or SSIM ≥ 0.98) against its stage's `still {marker}` outside the text boxes' boxes. Planted `pptx_drops_picture` passes slide 1 and fails first at slide 2, the first slide the noise panel shows on |
| 3 | `#732.c0dd433b` | `ac3-draw-order.test.ts` (2) | The inset piece's slide holds, in z-order, exactly a picture, the caption's text box and a picture over the caption's box. Planted `pptx_flattens_behind_text` fails, naming `wall_caption` |
| 4 | `#732.9492d8fd` | `ac4-receipt.test.ts` (2) | Each slide's receipt lists `checker` (every slide) and `grain_panel` (from slide 2) in pictures, each picture with why, one entry per picture the slide holds. Planted `pptx_receipt_lists_fewer` fails, naming the item left out |
| 5 | `#732.35428855` | `ac5-status-chip.test.ts` (2) | The status piece: the receipt lists `gate_chip` in a picture with why; no editable shape on any slide carries a status colour; LibreOffice's render shows the chip's glyph (ink in its box at least half the frame's, centred within 4 px). Planted `pptx_chip_as_shape` fails, naming `gate_chip` |
| 6 | `#732.a31af211` | `ac6-notes.test.ts` (1) | Each slide's speaker notes hold its stage's notes and no other's; each slide has a text box saying the bound value's text (42); each slide's notes hold its source (the reading's handle) and its as-of time |
| 7 | `#732.87ae4836` | `ac7-edit.test.ts` (1) | The title on slide 1 edited by this suite's reader to "Tide Stone": LibreOffice's render of the edited slide equals the original's at every pixel outside the title's box (grown 1 px), differs inside it, and there matches the render of a twin piece exported with that title, within the floor |
| 8 | `#732.6a9b72a2` | `ac8-fonts.test.ts` (1) | The named-font piece: the runs name Inter; no embedded font names Inter and no font data is left unlisted; the receipt lists `{family: Inter, embedded: false}` and never Inter as embedded |
| 9 | `#732.b38a3ba1` | `ac9-atomic.test.ts` (2) | `test.device_loss@1 {frame: 120}` (stage 3's frame): `stopped`, `device_lost` at frame 120, nothing left in out's folder; three exports of one revision (two in one run, one in another) have one SHA-256, each folder holding only its deck |
| 10 | `#732.bbcc6582` | `ac10-budgets.test.ts` (2) | `benchmarks/budgets.json` has a task whose reason names `#732.bbcc6582` and is valid against the merge base's; on a reference Mac in a fit state, five runs after a warm-up of the twenty-stage piece's export, each receipt's `timing.wall`, judged under 5 s by `judgeLimit` |
| 11 | `#732.1b8af42a` | `ac11-taste.test.ts` (1) | Takes the pictures and reads the recorded call (The taste call) |

## The surface under test

No new binary, subcommand or call: `deep-show run` (one scenario line on stdin, one answer line
`{"ok": true, "replies": [...]}`), its `planted` key naming the wrong writers (as #157's, #162's and #507's suites do; an
unknown name answers `bad_input`), and the file the export writes, read by this suite's own reader. **Every name below
that the issue or the design doesn't give is this job's choice**; the implementer builds exactly these, or a dispute
goes to a blind redraft.

### The scenario and the documents

`{evidence, sessions, processes, panels, docs, record, planted?, calls}`, as #162's and #169's suites write it: each
document is shown with `deep show` from the agent's tree (the peer `{pid: 4102, start: 1200}` under the session
`sess-732`), and the agent's record holds `verdict:01JB732V000000000000000001` failed (the status chip's source) and
`reading:01JB732R000000000000000001`, value 42 as of 1,794,475,800,000 (ms since the epoch: 2026-11-12T09:30:00Z, as
#169's world writes it; the bound value's source). Every document names its look by asset (`look: {asset, theme:
light}`, `assets.<id>.sha256` in the evidence store): the shipped clean look, copied from
`crates/deep-canvas-marks/looks/clean.json` at test time, so the families and colours the tests expect are the
document's own look's. Fields used, all accepted at the base: `markers.<id>: {kind: stage, name, t, notes}`;
`bound_values.<id>: {target: items/<id>/params/text, source}`; `status_bindings.<id>: {target:
items/<id>/params/paint/fill, source}`; `text@1 {text, font, size, weight, box: {w, h}, autosize: none, paint: {fill:
{role}}, runs: [{from, to, weight | role | font}]}`; `rect@1 {box, radius, paint}`; `circle@1`; `path@1 {d, paint}` with a
stroke, or a `gradient {kind: linear, stops}` fill; a `noise {…}` fill; `image@1 {asset, box, fit, alt}`; `group@1
{passes: [{op: blur@1, params: {radius}}]}`; `display@1`, `inset@1 {face, size, px_per_unit, content}`, `sky@1`,
`material@1`; hold-keyed channels on `items/<id>/adjust/opacity` and `items/<id>/at/pos/*`.

### Calls

| Call | Request | Reply read | New or existing |
|---|---|---|---|
| `deep show` | `peer`, `doc`, `document`, `include: ["issues"]` | `outcome: "presented"` | existing |
| `eval` | `doc`, `t` (a stage's time, flicks), `texts: true`, `paths: items/<id>/{at/pos/0, at/pos/1, params/box/w, params/box/h, params/size, params/weight}` | `texts` (each text item the frame draws, with its string; a bound value's as it shows), `values` | existing (#507's `texts`) |
| `export` (still) | `doc`, `out` (a folder), `range: {still: {marker}}`, `video: {codec: png_seq}` | `outcome: "exported"`; one PNG in `out` | existing (#501, #507) |
| `export` (pptx) | `doc`, `out` (the `.pptx` file), `range: "stages"`, `video: {codec: "pptx"}`, `pptx: {slide: [1920, 1080], notes: true, fonts: "embed_allowed"}` | see below | **new** (the issue's fields; `range: "stages"` is #507's handout form) |

The pptx export answers, as #157's and #162's exports do: `{outcome: "exported", receipt}`; `{outcome: "failed" |
"refused", issues}` from its own fidelity check, nothing written; `{outcome: "stopped", issues: [{code, frame}]}`,
nothing written; `{outcome: "blocked", …}` (read as BLOCKED, never a pass; the base's `no_encode_tool` for an unknown
codec is read as missing behaviour). The receipt is read for:

| Field | Shape | From |
|---|---|---|
| `slides` | `[{stage, native: [item], pictures: [{items: [item], why}], fonts: [{family, embedded: bool}]}]`, one per slide in slide order; `stage` the stage's marker ID or its number from 1 *(either accepted)*; `why` a non-empty string or list of strings *(its words aren't read)* | the issue |
| `timing.wall` | seconds from the command to the file | the design's Export receipt (criterion 10 only) |

### The independent reader (`ooxml.ts`)

The criteria's "independent reader" is this suite's own: no Office Open XML library is installed and Node has no XML
parser, so it holds a zip reader and writer (Node's zlib inflates deflated entries; the writer stores entries at the
format's first date), a namespace-resolving XML parser that keeps each element's place in its source, and the deck
model. It reads a file as follows *(each a reading this job chose; README: Readings)*:

- The presentation part from `_rels/.rels`; the slide size from `p:sldSz` (EMU), which must be 16:9; the slides in
  `p:sldIdLst` order through `ppt/_rels/presentation.xml.rels`.
- A slide's shapes in z-order: its `p:spTree` in document order, groups (`p:grpSp`) flattened through their `a:xfrm`
  (`a:off`, `a:ext`, `a:chOff`, `a:chExt`). A **text box** is a `p:sp` with text in its `p:txBody` and its box its own
  `p:spPr/a:xfrm` (a placeholder's box inherited from a layout isn't read). A **picture** is a `p:pic`, a `p:sp`
  filled with `a:blipFill` and no text, or the slide's background (`p:bg`) filled with a picture, read as the picture
  under every shape. Any other `p:sp`, a `p:cxnSp` or a `p:graphicFrame` is an **editable shape**.
- A text box's string: its runs (`a:r`, `a:fld`; `a:br` a line feed) in order, paragraphs joined by a line feed. A run's
  size (`sz`, hundredths of a point), bold (`b`), italic (`i`), family (`a:latin@typeface`, the theme's `+mn-lt` and
  `+mj-lt` resolved) and colour (`a:solidFill`) are its own `a:rPr`'s, else its text body's level defaults
  (`a:lstStyle`), else the master's `p:otherStyle`, else the presentation's `p:defaultTextStyle`.
- Colours: `a:srgbClr`, `a:schemeClr` (through the master's `p:clrMap` and the theme's `a:clrScheme`), `a:sysClr`'s
  `lastClr`, `a:scrgbClr`, and black, white, red, green and blue as `a:prstClr`; a colour with a modifier other than
  `a:alpha` reads as unknown. A shape's colours are every colour element anywhere in it.
- Speaker notes: the slide's `notesSlide` relationship; the text of its body placeholders (`p:ph type="body"`), or with
  none, of its shapes other than the slide image, number, header, footer and date.
- Fonts: `p:embeddedFontLst/p:embeddedFont` (`p:font@typeface`, its `p:regular` … parts); font data: any part under
  `ppt/fonts/`, with a font file's extension (`fntdata`, `ttf`, `otf`, `odttf`, `eot`, `woff`, `woff2`) or a font content
  type.
- Two edits: a copy of the package whose `p:sldIdLst` lists only slide n (what LibreOffice renders as slide n), and a
  copy whose one text box saying a string says another (criterion 7: the first `a:t` of its runs holds the new string,
  the others nothing; every property and every other byte of the slide part as they were).

**Units.** The pieces are 1920 × 1080 u and export at 1920 × 1080 px, so a document unit is a slide pixel; a slide pixel
is `p:sldSz`'s width over 1920 EMU, and a point 12,700 EMU. A 12,192,000 × 6,858,000 EMU slide (13.33 in) gives 0.5 pt a
pixel, so the 96 u title is 48 pt, but any 16:9 size reads the same.

### LibreOffice

Each slide is rendered by LibreOffice itself, laying out and drawing it: for each slide n, the reader's copy of the
exported package listing only slide n is converted by LibreOffice's own PNG export, which writes a deck's first slide, in
one headless run with a throwaway profile, so two runs never share a profile lock:

```sh
soffice -env:UserInstallation=file:///<temp>/profile --headless --invisible --nologo --norestore --nolockcheck \
  --convert-to 'png:impress_png_Export:{"PixelWidth":{"type":"long","value":"1920"},"PixelHeight":{"type":"long","value":"1080"}}' \
  --outdir <temp>/png <temp>/slide-1.pptx <temp>/slide-2.pptx …
```

Each render must be 1920 × 1080; its PNG is read by this suite's decoder (8-bit grey, palette, RGB or with alpha;
anything not opaque is read over white). Its version (`soffice --version`) is logged with every render.

## The planted writers

Each is a wrong writer the implementation builds, accepted in the scenario's `planted` and reachable no other way; at the
base each answers `bad_input`. A planted run fails when the export's own check refuses or fails it (not delivered,
nothing left beside `out`, its answer naming what the criterion says) or when it is delivered and the criterion's judge
fails it with a failure naming that.

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `pptx_title_as_picture` | writes the first text item of each slide in draw order (the four-stage piece's title, `tide_title`) as a picture in place of its text box | 1 | `tide_title` and a slide |
| `pptx_drops_picture` | leaves out every picture that holds a noise-filled item (the panel `grain_panel`, shown from stage 2) | 2 | slide 2, and nothing on slide 1 |
| `pptx_flattens_behind_text` | draws every non-native item of a slide into one picture behind every native shape and text box | 3 | the caption `wall_caption` |
| `pptx_receipt_lists_fewer` | writes every picture as the right writer does, but each slide's receipt entry leaves out the last item of its last picture | 4 | the item left out (`checker` or `grain_panel`) |
| `pptx_chip_as_shape` | writes each status-bound item as a native shape filled with its status colour, its glyph and word as text | 5 | the chip `gate_chip` |

The issue's proof line names four of these; the fifth is criterion 4's "an export whose receipt lists fewer items".

## Fixtures

All made at test time in `helpers.ts`; nothing but this folder is committed; no personal data; CC0. Every document is
1920 × 1080 u at 30 fps, named by asset to the clean look's copy, shown from the agent's tree. No text shows a digit or
a number word (`number_unsourced`, Honest numbers); the bound value's text is the reading's.

- **The four-stage piece** (criteria 1, 2, 4, 6, 7, 9 and 11): 8 s, stage markers `s1` … `s4` at 0, 2, 4 and 6 s named
  Harbour, Texture, Cliff and Close, each with notes. Native shapes: the ground `back`, a rounded card (`raised`, a 4 px
  `divider` stroke), a circle (`accent`), a line (`ink`, 6 px) and a closed path with a linear gradient (`accent` to
  `ink`). Pictures: the image `checker` (a 360 × 240 checker made here) on every stage, and the noise-filled panel
  `grain_panel` (480 × 320, `accent` to `ink`), its opacity held at 0 until 2 s and 1 from then. Text: the title
  `tide_title` "Stone Tide" (body, 96 u, weight 700, `ink`; box 1100 × 140 at x 120, 200, 280 and 360 at the four
  stages, y 80), the lede "Waves shape the cliff by night" (body, 48 u, weight 400, `ink`; runs: "shape" weight 700,
  "cliff" `accent`, "night" the mono face), and `price` (body, 64 u, weight 700) whose text is the bound value
  `price_now` of the reading (42). Its twin (criterion 7) says "Tide Stone" in the title, the same letters, so no
  embedded face needs a glyph the deck lacks; its device-loss copy (criterion 9) adds `test.device_loss@1 {frame: 120}`
  and requires `test.guards`.
- **The status piece** (criterion 5): one stage; a panel, its label "Release gate", and the chip `gate_chip`, a
  320 × 96 rect at (180, 520) whose fill is bound to the failed verdict: the frame draws it in the fail colour with the
  glyph and word inside (about 100 px of ink) and the legend.
- **The inset piece** (criterion 3): one stage under a perspective camera; a `display@1` with an `inset@1` on its screen
  (an `accent` ground and an `ink` bar), unlit; the caption `wall_caption` "The harbour wall at low tide" (56 u, 700);
  then the group `veil_pass` running the shipped `blur@1` over its child `veil_band`, a 35% `accent` band across the
  display and the caption. The 3D layer draws first, then the caption, then the group.
- **The named-font piece** (criterion 8): one stage; the text "Harbour lights" in the body face and a bar, under the clean
  look's copy whose `fonts.body` (Inter) says `license: LicenseRef-no-embedding, embed: false`.
- **The twenty-stage piece** (criterion 10): 10 s, stages `s1` … `s20` 0.5 s apart, each with notes; the display with
  its inset in view at stages 7 and 14 (the two 3D stages) and 20 m above the camera at the others; a heading and a
  card that moves at each stage.

**At the base** each piece is presented with no issue, `eval` gives its texts (the bound value's as "42"), and its
`still {marker}` exports draw what is described above, except that the noise panel draws flat in its first stop, which
changes nothing a test reads: it is a picture by its kind. The device-loss copy wasn't shown at the base (it needs the
`test-export-guards` build).

## What becomes a picture

From the issue's scope: text items become text boxes; rects, rounded rects, ellipses (a circle), lines and paths with
flat or linear-gradient fills and plain strokes become native shapes; everything else (3D, operators, passes, drawn
looks, insets, images, noise fills) and every status-bound item becomes pictures, each unbroken run in draw order one
picture. So in the four-stage piece `checker` (an image) is a picture on every slide and `grain_panel` (a noise fill)
from slide 2, where it shows; in the status piece the chip (and the legend the frame draws with it); in the inset piece
the 3D layer with its inset, and the group with its pass.

## Readings where the issue and design leave a choice

- **Stage order** is the receipt's `slides` listing `s1` … `s4` in order (marker IDs or numbers), and the slides' own
  content: the title's box differs at each stage, so slide k's title must sit at stage k's evaluated box.
- **"One text box per text item"** is per text item the stage's frame draws (`eval`'s `texts`, which leaves out a text
  at opacity 0); exactly one text box says its string, and no other text box is on the slide.
- **The evaluated box** of a text item is its evaluated `at.pos` and `box {w, h}` (`autosize: none`), read through
  `eval`'s `values`: the base's `deep_query` gives no box for text@1 (`items/<id>/bounds` is `ref_unresolved`). "Within
  0.5 pt" holds on each of the box's four edges.
- **Size** is the run's `sz` against the item's size in u times the slide's points per pixel, within 0.01 pt.
- **Weight**: a run in Office Open XML holds only bold, so weight 600 and over is `b="1"` and below it bold off; the
  fixtures use 400 and 700 only. **Family** is the look's font entry's family for the run's font role (body: Inter,
  mono: JetBrains Mono). **Role colour** is the role's colour in the look's light palette, within one code value.
- **"Naming the item and the slide"** is a failure line `slide n: … \`<id>\` …` from the judge, or an export issue whose
  JSON holds the item's ID and the slide (`slide n`, `"slide": n` or the stage's marker ID).
- **"Outside the text boxes' boxes"** is outside each text box's box grown by 2 px, for anti-aliasing at its edges;
  **the export.fidelity floor** is #157's at the default quality, standard: PSNR-Y ≥ 40 dB or SSIM ≥ 0.98, on BT.709 luma
  of encoded values, SSIM over 8 × 8 windows 4 px apart whose centre counts (the export's own comparison, deep-show's
  `export/lottie.rs` `compare`).
- **"In that order"** (criterion 3): the slide's pictures and text boxes in z-order are exactly a picture, the caption's
  text box and a picture, the last overlapping the caption's box (the pass is over both).
- **"Lists every item that became a picture"** (criterion 4): every item the stage draws that the scope makes a picture
  is in one of its slide's receipt pictures, each picture says why, and the receipt lists one entry per picture the
  slide holds.
- **"Showing its glyph"** (criterion 5): in LibreOffice's render, pixels in the chip's box at least 96 code values of
  luma above the fail colour's (the glyph and word, white on red) number at least half the settled frame's there, and
  their centre lies within 4 px of the frame's. **A status colour** is one of the clean look's nine within two code
  values per channel.
- **The bound value's notes** (criterion 6) hold its source handle and its as-of time, written as the record's number or
  as its date and time (`2026-11-12T09:30` or `2026-11-12 09:30`, any seconds and zone after); the issue gives no format.
  A stage's notes are matched with white space collapsed.
- **"Shows the new string in place"** (criterion 7) is checked against a twin piece exported with that title: inside the
  title's box the edited slide's render matches the twin's within the floor (and differs from the original's in 100 px
  or more), so nothing of the old string shows; "the slide's other pixels unchanged" is every pixel outside the box,
  grown 1 px for the box's rounding to pixels, equal.
- **A font whose licence doesn't allow embedding** (criterion 8): at the base no fixture can carry one. The look check
  (`crates/deep-canvas-marks/src/look.rs`, `fonts`) refuses any font entry without `embed: true`, a license and a
  bundled file (`font_unshippable`), and deep-show then keeps the shipped look; every bundled face is OFL-1.1 with
  embedding bits that allow it, and the shaper reads no other face. The issue's text supports the look's own record:
  look@1's `fonts: {name → {family, file, license, embed: bool}}` is where a face's licence and whether it may be
  embedded are recorded (#417: "every bundled font's licence allows embedding, recorded beside it"), and "the look's
  fonts are embedded only where their license allows embedding". So the fixture's look records Inter with `license:
  LicenseRef-no-embedding, embed: false`, and the export must take that record over the face's own bits; the
  implementer makes the look check accept such a face for a document whose export names it. "Named" is the runs naming
  the family; "never embedded" is no `p:embeddedFont` for it and no font data in the package that another family's entry
  doesn't list.
- **"Stopped part way"** (criterion 9) is #162's: #157's `test.device_loss@1` loses the device as the export draws frame
  120 at the piece's 30 fps (stage 3's settled frame), after stages 1 and 2; the answer is `stopped` with `device_lost`
  at that frame.
- **The budget** (criterion 10) reads the receipt's `timing.wall`, as #162's does.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- `ac2`, `ac5`, `ac7` and `ac11` render slides with LibreOffice: BLOCKED without it.
- An export answering `blocked` (its own fidelity reader missing) fails `BLOCKED:`.
- `ac10`'s timed test: INCONCLUSIVE off a reference Mac (`scripts/benchmark.mjs` `fingerprint`), off mains power, in Low
  Power Mode, not thermally nominal, loaded past the core count, or when `judgeLimit` reads the five runs as neither all
  within nor all over 5 s.
- `ac11-taste.test.ts`: INCONCLUSIVE until the call on its pictures is recorded.

## The taste call

`ac11-taste.test.ts` judges no picture. Its check run exports the four-stage piece and each stage's still, renders each
slide of the exported file with LibreOffice at 1920 × 1080, and writes `docs/evidence/732/slide-1.png` … `slide-4.png`:
LibreOffice's render on the left and the stage's settled frame on the right, on a grey gutter, encoded so the same
pixels give the same bytes; it prints their SHA-256s. The implementer attaches them to the PR and shows them to the owner
in the session; the one call on them is recorded in `tests/acceptance/732/TASTE.json` (this job writes none):

```json
{"issue": 732, "criterion": "#732.1b8af42a", "verdict": "looks_right" | "looks_wrong", "who": "…", "when": "<ISO 8601>",
 "screenshots": {"slide-1.png": "<sha256>", "slide-2.png": "<sha256>", "slide-3.png": "<sha256>", "slide-4.png": "<sha256>"},
 "note": "…"}
```

No call, or a call on other pictures, is `INCONCLUSIVE:`, never PASS; `looks_wrong` fails; `looks_right` on exactly these
pictures passes. No other test reads a picture to judge it: the renders are compared with frames, which is a value.

## Not tested

No criterion asks for these: italic runs (criterion 1 lists string, family, size, weight and colour), `pptx.notes: false`,
`pptx.fonts: name_only`, other slide sizes, a hidden item, what a slide does with an item at opacity 0, native shapes'
geometry and gradient stops beyond the rendered pixels, the receipt's `native` list's contents, macros, embedded objects
and slide animations, and the speaker notes' layout.
