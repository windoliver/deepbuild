# Acceptance tests for #1969: typed text, write mode per grapheme, the #head cursor and the type cue

Written first, blind, from issue #1969 (its Scope, its Fields, its 3 acceptance criteria and its Proof line: "A
code-change film as a document: a function typed on behind a cursor"), its Oracle page, the design sections it links and
those they lean on, and base commit `338e5e36` (main `c56fe540` with #222's cue lists merged), by a job that never saw an
implementation; none existed, and no other worktree, branch, PR, stash or session was read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean:
one test per criterion, plus the planted wrong program the issue names (criterion 3's planted `type`).

## What was read

- Issue #1969, live, no comments; its Oracle page (`doneright/oracles/issues/1969.md`, branch `doneright` of the
  Oracle repository): an upstream formula source for criterion 2, none for criteria 1 and 3.
- `docs/canvas-primitives.md`: Text `text@1` (`reveal: {mode, order, progress, emits}`, units, write mode, `lag =
  min(4 ÷ n, 0.2)`, "the progress runs linear unless keyed otherwise", the anchor `<item>#head`, baseline rounding);
  Text `text@1`: code (the mono role); Item and kind (`at.anchor: ID#anchor`: "with an anchor, pos offsets from that
  point"); ID and sub-address; Cue list `cues@1` (the cue signature, `type {cursor: ID}`, markers `cues.<id>`, the cue
  kit and its planted entries); Registry and seal: registries; Registries and closed lists (the Cue verbs row);
  Recipe; Time and the flick.
- `docs/technical-design.md`: Films and figures on the canvas (the cue list paragraph, formulas and text); 2D marks and
  paint; Dogfooding.
- At the base, for call shapes only: `crates/deep-show` (`deep-show run`, `deep show` and its `expansions`, `eval`
  with `paths`, `film` (#493's `film.glyphs`) and `pixels`, `registries`, the evidence store's layout),
  `crates/deep-canvas-motion/src/cues.rs` and `cues/kit.rs` (the expander, the kit's document, its five rules, its
  planted entries), `packs/verbs-1.0.0/` (its `pack.json`, the `write` and `by_letter` recipes and fixtures, which key
  `params/reveal/progress`), `crates/deep-canvas-marks/src/animator.rs` (the fade reveal of #407 and #1646; write mode
  and `emits` answer `unsupported`), `crates/deep-marks-render` (`raster`'s `texts`, #496's glyph fields);
  the merged suites `222/`, `398/` (the formula write, `write.test.ts`), `496/`, `1646/`; `scripts/proof-change.mjs`
  (criterion IDs) and `scripts/lanes.mjs`. Code was read to learn the surface; every expected value comes from the
  issue and the design.

## Run them

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1969 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1969/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/1969/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll`, with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set,
honoring `CARGO_TARGET_DIR`, and copies the binary out: `head.test.ts` and `write.test.ts` build `cargo build --locked
--bin deep-canvas-render`; `type.test.ts` builds `cargo build --locked --bin deep-show --no-default-features --features
full`. When `cargo` isn't on PATH the helpers add rustup's (`~/.cargo/bin`, `/opt/homebrew/opt/rustup/bin`). A test whose
build failed fails with cargo's error. The files build cargo binaries, so they run one at a time: the implementer adds
to `scripts/lanes.mjs` (this job writes only this folder):

```js
alone.push('tests/acceptance/1969/');
```

Every `it` passes a 60-minute timeout. Temporary folders are deleted. Node built-ins and vitest only. Nothing is timed.
A test that can't decide here fails with a message starting `INCONCLUSIVE:`, never passing.

## The surface under test

Two binaries the base already has, each with its JSON-lines protocol unchanged; no binary, call or reply field is
added. **Every name below that neither the issue nor the design gives is this job's choice, marked *(chosen)***; the
implementer builds exactly these, or a dispute goes to a blind redraft.

### `deep-canvas-render raster` (criteria 1 and 2)

`raster {out, doc, look: "clean", t}` as #381, #496 and #1646 left it: the PNG of the document at t (flicks) in `out`,
and `texts.<item>.glyphs[]` with `grapheme`, `advance`, `outline` and `transform` (#496's fields; a glyph's pen is the
transform's translation). Documents are #496's film envelope (`{format: 1, id, profile: "film", size: [640, 360],
layers, transport: {span, frame_rate: "60/1"}, items, channels}`), one writer layer `main`.

- **The reveal** is the design's `reveal: {mode: "fade" | "write", order: "reading", progress}` on a text@1 item, its
  `progress` keyed by an f32 channel with linear keys on `items/<id>/params/reveal/progress` (as #1646 keys it).
  `mode: "write"` is new: each grapheme draws its outline along its path (in its fill's paint, the texts having no
  stroke), then its fill.
- **The anchor** is the design's `at.anchor: "<item>#head"` on another item, with `at.pos: [0, 0, 0]`: the item's own
  point (for a text, its run's origin, where `raster` draws it from) sits on the head. A text item's glyph pen is that
  point plus the run's own pen offset; the tests measure the offset on an unanchored copy at a known `pos` *(chosen
  reading: a text item's anchor point is its run's origin)*.

### `deep-show run` (criterion 3)

As #222's suite drives it: one scenario line in (your shell's process tree, alpha's session, one panel, `packs: [{id:
"deepbuild/verbs", dir: <checkout>/packs/verbs-1.0.0}]`), one answer line out. Calls: `deep show` from your shell with
`include: ["issues"]`, its reply's `expansions` (#222's chosen form: per cue list, `channels` named `<list>.<cue>[.<k>]`
with their keys' `t`, and `markers` `cues.<id>: {t, span}`); `eval {doc, t, paths?, film?, pixels?}` (#1918's `values`,
#493's `film.glyphs.<item>[k] = {x, y}`, a glyph's pen in document units, and `snapshots[0].sha256`, the frame's PNG in
the scenario's evidence store at `<evidence>/<sha[0..2]>/<sha[2..]>`); `registries` (#200, #222: the `cue.kind@1` row's
`entries`, each `{name, origin, kit: {verdict, rules: [{rule, verdict, message}]}}`, and `planted`, each `{name,
result}`). Films are sent as your shell sends them (`profile: "film"`, 640 × 360 u, no `id`, no `layers`).

- **The verb** `type`, an entry of the first-party pack's `cue.kind@1` (name and `cursor` param from the design), played
  by a cue `{id, kind: "type", targets: [<text>], when: {at: time}, span, params: {cursor: <item ID>}}` (#222's forms).
  It **types by keying its target's `params/reveal/progress`**, as the pack's `write` and `by_letter` do, so its
  channel on `items/<text>/params/reveal/progress` is named for its cue *(chosen)*; how it moves the cursor is the
  implementer's, so long as every key it writes lies inside the cue's span.
- **The cue kit's rules** keep #222's IDs: `same_bytes`, `targets_only`, `inside_span`, `end_state`, `back_to_base`.
- **The planted entry** `type` *(name from the issue)*: the kit's planted `type` that keys the cursor one flick past
  the span, listed in the row's `planted` beside #222's, failing `inside_span`, whose `message` names `type`.

## Fixtures

None stored: each test writes its documents (in its file and `helpers.ts`).

| Test | Document |
|---|---|
| AC1 | "Will it ship?" (13 graphemes) in the body role at 40 u, at (40, 30) with a fade reveal (`fading`), at (40, 130) with a write reveal (`writing`), at (40, 230) with none (`still`); both reveals' progress linear from 0 at 0.5 s to 1 at 2.5 s in a 3 s film. Carets `caret_f` and `caret_w`, the text "\|" anchored to `fading#head` and `writing#head`; `twin`, the same caret at (560, 290) |
| AC2 | "ILT" in the body role at 240 u, ink fill, at (40, 20): with `reveal: {mode: write}`, its progress linear from 0 at 0 s to 1 at 1.2 s, and the same text with no reveal |
| AC3 | "return(a+b);" (12 characters) in the mono role at 32 u at (40, 140), `reveal: {mode: fade, order: reading, progress: 1}`; `caret`, "\|" in the mono role at the origin; `twin`, the same at (560, 300); the cue list `list` holding `{id: "typing", kind: "type", targets: ["code"], when: {at: "0.5s"}, span: "2.4s", params: {cursor: "caret"}}`, in a 4 s film naming `deepbuild/verbs@1.0.0`; and the plain film, the text alone with no reveal |

## Criteria to tests

IDs are `#1969.` and the first 8 hex digits of SHA-256 of each criterion's text (`scripts/proof-change.mjs`). Each
test's name starts with `AC<n> <ID>`; each file's header states its documents, numbers and wrong programs in full.

| Criterion | File (tests) | What it asserts |
|---|---|---|
| AC1 `#1969.880c329e` | `head.test.ts` (1) | At 100 times (the middle of each of the 14 counts 0 … 13 the reveal holds, and 86 seeded times, none within 2 ms of a unit passing 0.5), played in one process with the times rising and seeked in a fresh process in a seeded order, each caret's anchor point sits after the k-th grapheme (the still line's pen of grapheme k − 1 plus its advance; grapheme 0's pen for k = 0) and on its line's baseline, within 0.5 px, k being the units whose reveal has passed 0.5 by the design's schedule, for the fade reveal and the write reveal |
| AC2 `#1969.0cd379f8` | `write.test.ts` (1) | At 0.15 s grapheme 1's outline is 0.35 drawn within 0.01, one run from its path's first point, its inside the ground (no fill), graphemes 2 and 3 nothing; grapheme 1 nothing at 0 s and drawing at 0.03 s, grapheme 2 nothing at 0.15 and 0.165 s and drawing at 0.19 s (start 6/35 s), grapheme 3 nothing at 0.3 and 0.34 s and drawing at 0.36 s (start 12/35 s); drawn shares 0.7 and 0.3 at 0.3 s, 0.98, 0.58 and 0.18 at 0.42 s, within 0.01 |
| AC3 `#1969.3ef80026` | `type.test.ts` (2) | `type` listed with origin `first_party`, its kit PASS on all five rules; the cue's marker is exactly [0.5 s, 2.9 s] and every key it writes lies inside it; at the keys it writes on the text's progress, the graphemes that show read 1, 2, … 12 (after at most one key at the cue's start showing none), holding between keys; at 2.9 s and 3.4 s all 12 show, the text's line equals the plain text's pixels (none off by more than 32 code values, 99.9% within 2) and the cursor's anchor point is after the 12th glyph within 0.5 px, on the code's line. Planted: the `cue.kind@1` row's planted `type` is FAIL, its `inside_span` rule FAIL with a message naming `type` |

## Readings where the issue leaves a choice

1. **"While k graphemes show"** is k = the units whose own reveal has passed 0.5, the design's definition of `#head`
   ("the caret position after the last unit whose reveal passed 0.5"), computed from the keyed progress by the design's
   schedule (lag = min(4 ÷ n, 0.2), each unit over 1 ÷ (1 + (n − 1) × lag) of the progress). Sample times keep 2 ms clear
   of each unit's half, so no k is decided by a rounding. With no unit past half, **k = 0 and the caret sits at the
   line's start**, grapheme 0's pen.
2. **"After the k-th grapheme"** is the caret position after it: its glyph's pen plus its advance, as shaped, in the
   still copy of the same line (a reveal moves no glyph). **"On that line's baseline"** is the glyph pens' y. "Within
   0.5 px" holds both coordinates; 1 u is 1 px in these frames. Positions are read as `raster` reports them (layout),
   so the design's paint-only baseline rounding doesn't enter.
3. **"Seeked or played"**: played is one `raster` process fed the times in rising order; seeked is a fresh process fed
   the same times in a seeded order, each line a jump (#496's and #1646's reading).
4. **AC1 covers both modes**: `#head` is published by "a reveal", so a fade and a write reveal are each held to it.
5. **"0.35 drawn"** is the share of the outline's arc length drawn from its path's first point along its direction, as
   #398's suite reads its terms. The graphemes are I, L and T, each one contour of straight edges in the bundled body
   face (read from #496's `outline`; a face that drew more than one contour would make the test INCONCLUSIVE, since
   "along its path" then isn't one path). A share by count of curves differs from a share by length on these edges and
   fails.
6. **Reading the frame**: a sample on the outline is drawn when its pixel is at least 40% of the way from the ground to
   the ink, read every 0.5 u; nothing may be drawn past the run (4 u of slack at each end). "No fill" is every pixel
   inside the glyph and 6 u clear of its outline within one code value of the ground, so the outline's width while it
   draws (not pinned by the design) is free up to 12 u; it must be at least 1 u to be read. "Draws nothing" is the
   glyph's box and 4 u around it within two code values of the ground; "draws" is at least 10 ink pixels there.
7. **"Start at 0, 6/35 and 12/35 s"** is held by frames on each side of each start; the shares at 0.3 s and 0.42 s pin
   each grapheme's own span of 6/7 s, as #398 pins its terms'.
8. **"Writes one key a character, in order"** is read at the keys the cue writes on the text's progress: evaluated at
   each key time (keys are right-continuous), the graphemes that show rise by exactly one a key from 1 to 12, after at
   most one key at the cue's start that shows none (the from-value), and between two keys the count holds, so each
   character appears at its own key, never between keys and never two at once. Reading order follows from `order:
   reading`.
9. **"Inside the cue's span"** is every key time and pulse end of every channel the cue writes, on the text and on the
   cursor, in [start, start + span] of its marker, #222's `inside_span` read on the expansion; with one target the span
   is the cue's own 2.4 s.
10. **"Ends with every glyph drawn"** is the text's line, up to 2 u short of the caret, drawn as the same text with no
    reveal draws it, at the cue's end (2.9 s) and 0.5 s after. **"The cursor after the last"** is the cursor's anchor
    point within 0.5 px of the 12th glyph's pen plus the mono pitch (checked even), and between the code's top and its
    baseline: how the verb places its cursor vertically is its own.
11. **"The verb passes the cue kit"** is read from the kit's own result per rule in deep://registries, as #222's suite
    reads its 29 verbs. **"Refused by the kit, naming the verb"** is the planted entry's result FAIL with `inside_span`
    FAIL and a message holding the word `type`; it's the only rule a key one flick past the span breaks.

## Upstream tests (the Oracle lane)

The Oracle page pins an upstream engine's creation module and its graphical test for criterion 2, and nothing for
criteria 1 and 3. **No `1969-oracle/` folder is written**: criterion 2's test here already is that formula run on our
output. `write.test.ts` computes every expected number from the formula source the page names (the lag of min(4 ÷ n,
0.2) for n parts, the lagged sub-alpha over a run of 1 + (n − 1) × lag, the outline drawn over the first half of each
part's own progress and the fill after), with the design's linear progress, and holds our frames to it. The upstream
graphical test's stored frames are not run, for #398's reason: they are that engine's camera, antialiasing, outline
width and non-linear timing, which our write (linear by design) doesn't reproduce, so our output would fail them for
reasons outside the criterion; and the page itself says the upstream write has no test of its own.

## Not tested here

- **The Proof line** ("a code-change film as a document: a function typed on behind a cursor"): it is the
  implementer's film; criterion 3's film is a small one of the same kind.
- **Scope with no criterion**: `order: seeded`, `emits` and the occurrence list `<item>.reveal`, a reveal over several
  lines and right-to-left text, a text with a stroke in write mode (the outline in its stroke paint, then its own
  stroke), the fill's own curve after the half, `#head` read by anything but `at.anchor`, `type`'s fixture and twin in
  the pack, and "It can never". They are the implementer's own tests.

## At the base

Not run: at `338e5e36` none of the surfaces exist. The text module's reveal refuses `mode: "write"` (`unsupported`, so
`raster` refuses both AC1's and AC2's write documents), a text@1 item publishes no `#head`, `cue.kind@1` lists no `type`
and the kit plants no `type`. So every test fails on an assertion. The type-check exits 0.
