# Acceptance tests for #496: text animators: selectors, ranges and properties per glyph

Written first, from issue #496 (its Scope, its Fields, its six acceptance criteria and its Proof line: "Range shapes against
their CPU reference, a seeked noise selector, and the refused glyph shift on a counter"), the design sections it names and
those they lean on, and base commit `b52f7357` ("Merge pull request #1641 …", origin/main), by a job that never saw an
implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

**Disclosure.** While this suite was being written, another job began editing the same worktree (uncommitted changes to
`crates/deep-text/src/{fonts,outlines,shape}.rs`, `crates/deep-canvas-marks/src/lib.rs`, a new `animator.rs` and
`fonts/InterVariable.ttf`). One grep of `fonts.rs` showed a few lines of it: a face entry for a family "Inter Variable", file
`InterVariable.ttf`, with a comment naming #496. Nothing else of it was read; every base file after that was read with
`git show b52f7357:<path>`. The tests name no font file or family: MOTION is set in the default `body` role, the issue's
static weights (400, 500, 600) are the base's, and what is drawn is compared with what the same build draws for a still item.

## What was read

- The issue, live (`gh issue view 496 --repo windoliver/deepbuild`). Six criteria; the sixth is the taste call.
- There is no oracle page (`doneright/oracles/issues/496.md` doesn't exist on branch `doneright` of `DeepBuildAI/deepbuild`).
  AC2's formulas come from lottie-web instead (below).
- `docs/canvas-primitives.md` at the base: Text animator and counter; Text animator and counter: selectors and properties;
  Text `text@1`; Path `path@1`; Path and handle; Channel and key, and its quantize jump; Bound value (`format`); Look (role
  map); Time and the flick. `docs/technical-design.md`: Dogfooding; Tests written first.
- At the base: AGENTS.md; `crates/deep-canvas-marks/src/modules.rs` (the text module, `animate`: y and opacity only) and
  `scene.rs` (`text_spec`, counters, `Format`, `bound_text`); `crates/deep-text` (`shape.rs`'s `Glyph`, `outlines.rs`,
  `fonts.rs`: static Inter 400, 500, 600 and JetBrains Mono); `crates/deep-canvas-motion/src/doc.rs` (channel targets,
  `data/<name>`, drivers and their `time` var, interps); `crates/deep-marks-render` (`lib.rs`'s `raster` and `check`,
  `raster.rs`'s `texts` and `glyph_row`); `crates/deep-motion/src/main.rs`, `crates/deep-text/src/main.rs`,
  `crates/deep-text-render`, `crates/deep-show/src/frames.rs` (to choose the surface); the merged suites `tests/acceptance/492/`,
  `381/`, `167/` and `387/`, whose layout and conventions this one follows; `scripts/proof-change.mjs` (criterion IDs).
- lottie-web `bede03d25d232826e0c9dca1733d542d8a7754fb` (MIT): `player/js/utils/text/TextSelectorProperty.js` (last changed in
  `05a36e3738`) and `player/js/3rd_party/BezierEaser.js`, fetched with `gh api`.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/496 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/496/tsconfig.json   # type-check (exits 0)
node tests/acceptance/496/lottie-reference.mjs --check                       # the sidecar still matches the formulas
```

`cargo` must be on PATH. `--root` keeps the repo's `vitest.config.ts` out; it leaves Vitest's cache in
`tests/acceptance/496/node_modules/.vite`, which is not part of the suite. Each file builds `deep-canvas-render` once in
`beforeAll` (`cargo build --locked --bin deep-canvas-render`, honoring `CARGO_TARGET_DIR`) and copies it out; every test of a
file fails when its build fails. The files build a cargo binary, so they run one at a time: `scripts/lanes.mjs` needs
`'tests/acceptance/496/'` added to its `alone` list (this job writes only this folder; the implementer makes that edit). Every
`it` passes `TIMEOUT` (30 min). Nothing is timed. Node built-ins and vitest only.

## The surface under test

The issue names fields but no code API. These tests extend `deep-canvas-render raster` (crate `crates/deep-marks-render`,
#391's JSON-lines convention: one object in per stdin line, one out per line, in order, exit 0), which already evaluates a
document's motion at `t`, draws it with Vello CPU to a PNG and answers each text@1 item's glyphs (#381). No binary or command
is added. **Every name below that the issue or design doesn't give is this job's choice** (each is listed again under Choices);
the implementer builds exactly these, or a dispute goes to a blind redraft.

### `raster {out, doc, look, t, planted?}`

As at the base: `look` is `"clean"` (the shipped look by ID), `t` in flicks, a refusal is `{ok: false, code, issues}` whose
whole JSON the tests search for the IDs it must name. New:

- `texts.<item>.glyphs[]` gains, beside the base's `id`, `x`, `y`, `grapheme`, `font`, `size`:
  - `advance`: the glyph's advance in u, as shaped (a variable font's at the weight it is drawn at).
  - `outline`: the glyph's outline in u in the glyph's own frame (pen origin on the baseline, x along the advance, y down),
    a list of `["M", x, y]`, `["L", x, y]`, `["Q", x1, y1, x, y]`, `["C", x1, y1, x2, y2, x, y]`, `["Z"]`; `[]` for a glyph
    with no outline.
  - `transform`: `[a, b, c, d, e, f]`, the glyph's own frame to the document, (x, y) ↦ (a·x + c·y + e, b·x + d·y + f): after
    the item's place, its animators, a curve and a roll. For an upright unanimated glyph it is `[1, 0, 0, 1, X + x, Y + y]`,
    X and Y the run's origin.
  - `clip`: `[x, y, w, h]` in document u, the rect the glyph is clipped to (a rolling counter's cell), or `null`.
  - A rolling grapheme draws two glyphs, the old and the new, each with that grapheme's index.
- `texts.<item>.coverage`: one array per animator, in order, of each unit's selection amount (f64), after all of the
  animator's selectors and its strength, before its props.
- `shaped`: how many glyph runs this line shaped (cache misses of the shaped-run cache), its check included.
- `planted`: the names under Planted programs; any other value stays `bad_input`.

### Documents

The film envelope as #492's (`{format: 1, id, profile: "film", title, description, size, layers, transport: {span, frame_rate:
"60/1"}, items, …}`), with:

| Field | As the tests write it |
|---|---|
| Animator | the base's `{units, range: {from, to, offset}, shape, mode, props}` in `params.animators` |
| The range's new fields | `range.basis: "fraction"`; `shape` and `ease: {high, low}` on the animator, beside the base's `shape` |
| Glyph shift | `props.glyph_shift: {set: "upper", by}`; `by` keyed by an f32 channel with hold keys on `items/<id>/params/animators/0/props/glyph_shift/by` |
| Noise selector | `selectors: [{noise: {min, max, frequency, seed}, mode}]` after the animator's own range |
| Weight driven | a driver `{target: "items/motion/params/weight", expr, vars: {t: "time"}}`, the issue's formula as `round(100 + 800 * (0.5 - 0.5 * cos(2 * pi * 2 * t / 4.7)))` |
| The circle | a `path@1` item `ring`, `params.d` eight cubics of radius 100 about the origin from (100, 0), angle increasing |
| On a curve | `params.on_curve: {path: "ring", offset, repeat}`; the offset keyed on `items/arc/params/on_curve/offset` with `extrapolate: {before: "hold", after: "cycle"}` |
| Counter source | `text: {counter: {source: "data/left", …}}`, the data value `left` that a channel keys (`channels.left.target: "data/left"`, hold keys) |
| Counter format | `format: {notation: "clock"}`: hours, minutes and seconds, each at least two digits, colon-separated (8104 s → `02:15:04`) |
| Roll | `roll: {span: "0.32s", interp: {ease: {name: "in_out_cubic"}}}` on the counter, `dir` left at `up` |

### Planted programs

Each is a `raster` `planted` name, and each goes through the same check the real program passes.

| Name | Criterion | The wrong program |
|---|---|---|
| `triangle_peaks_at_start` | 2 | the triangle shape peaks at the range's start instead of its middle |
| `weight_snaps_to_static` | 3 | a driven weight draws the nearest bundled static face of its role (600 for 900) |
| `on_curve_left_edge` | 4 | each grapheme's left edge, not its advance midpoint, sits on its arc-length point and turns to the tangent there |
| `roll_moves_every_grapheme` | 5 | on a change of the counter's string every grapheme rolls, the unchanged ones included |

## Criteria to tests

Each test's name starts with the criterion's ID (`AC<n> #496.<sha8>`, as `scripts/proof-change.mjs` computes it).

| Criterion | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#496.c9814144` | `glyph-shift.test.ts` (2) | SCRAMBLE with a swept glyph shift: at all 121 frames of 2 s at 60 fps each glyph's pen and transform equal the unanimated title's bit for bit, while some glyph is swapped (fails a shift that moves glyphs or reshapes, and one that does nothing); a glyph shift on a counter and on a bound value is refused naming `count` and `reading`, while the same animator lifting by y draws (fails a shift allowed on numbers, and a refusal of any animator) |
| AC2 `#496.7f7f12df` | `range-shapes.test.ts` (3) | 6 shapes × 4 eases × 10 units against the Lottie sidecar within 1e-6; the planted triangle fails that comparison; a 2 Hz noise selector's amounts at 121 frames played equal the same frames seeked in a seeded order in a fresh process, bit for bit, and move (fails state carried between frames, and a constant) |
| AC3 `#496.0e4aa65f` | `variable-weight.test.ts` (3) | at 1.175 s and 0 s each glyph's id, advance and outline within 0.01 u of a still MOTION at 900 and at 100, with guards that 900 ≠ 600 and 100 ≠ 400; the 283 frames of the play: the first line shapes, no later line shapes anything, and the weight moves; the planted snap draws advances nearer 600's than 900's and the check fails naming `motion` |
| AC4 `#496.2552ca08` | `on-curve.test.ts` (3) | grapheme 2's advance midpoint within 0.1 u of (100·cos 1, 100·sin 1) and its turn within 0.1° of 1 rad + 90°, after checking the run advances 20 u a grapheme; repeated and keyed with cycle, every glyph at 4.7 s matches one at 0 s (same glyph, 0.1 u, 0.1°), and the frame at 2.35 s doesn't (fails an offset that never moves); the planted layout centres grapheme 2 at arc length 110 u and fails naming `grapheme 2` |
| AC5 `#496.16281962` | `counter-roll.test.ts` (3) | at 4.56 s graphemes 4, 6 and 7 each draw the old glyph at rest − half the clip's height and the new at rest + half of it, within 0.01 u, both in one clip that holds the rest, and graphemes 0, 1 and 3 equal 4.3 s's bit for bit; the counter at 4.56 s seeked equals the same frame after playing every frame to it; the planted roll fails naming `grapheme 0` |
| AC6 `#496.dc1c7447` | `taste.test.ts` (1) | reads the record only; no pictures or no call is INCONCLUSIVE, never PASS (The taste call) |

## Choices where the issue is open

1. **Surface.** `deep-canvas-render raster`, because it alone at the base both evaluates a document's motion at t and answers
   each glyph of a text item; the new fields sit beside the glyph fields #381 added. A play is one process fed frame by frame,
   a seek a fresh process.
2. **Glyph frame and `transform`.** Positions are read through `transform`; "a glyph's position" (AC1) is its pen `x`, `y`
   and `transform`. A grapheme's centre (AC4) is its advance midpoint on its baseline, `transform · (advance ÷ 2, 0)`, as the
   Scope places it; its turn is the transform's x axis.
3. **Outlines** are compared command by command in the glyph's own frame, so a still item and a driven one can sit anywhere.
4. **Coverage** is the amount the animator applies per unit. AC2 reads the animator's own range as its only selector, so the
   amount is Lottie's `getMult` with amount 100 % and smoothness 100 % (strength 1, no falloff, no offset).
5. **AC2's formulas.** With no oracle page, the source is lottie-web's TextSelectorProperty.js at `bede03d25d`, the file the
   brief named: sh 1..6 = square, ramp, ramp down, triangle, round, smooth; ease high = xe ÷ 100, ease low = ne ÷ 100. Smooth
   is Lottie's cosine, not the base's smoothstep. `lottie-reference.mjs` ports the formulas, keeps lottie-web's MIT notice,
   solves the ease exactly and checks bezier-easing's own solution agrees within 1e-9.
6. **The four eases** per shape are (high, low) = (0, 0), (0.6, 0.3), (−0.4, −0.7) and (0.5, −0.5), each of Lottie's sign
   branches.
7. **Where `ease` sits.** On the animator beside `shape`, as the base writes `shape` there.
8. **The noise selector** multiplies the animator's own full square range, with `min: 0, max: 1`, so its amounts stay in
   [0, 1] whatever the clamp; only played against seeked is judged.
9. **"Shapes nothing after check"** is read as: the play's first line, whose check shapes every weight the driver takes,
   shapes something, and no later line shapes any run. `shaped` counts the check's shaping too, so a check that shapes per
   line can't hide a per-frame shape.
10. **The variable font's role.** MOTION uses the default `body` role; the issue's "nearest bundled static weight" is body's
    600. A still item at a weight is the reference, drawn by the same build.
11. **The monospaced run** is ABCDE in the `mono` role at 100/3 u (JetBrains Mono advances 600/1000 em, 20 u here; the test
    reads it first).
12. **Path space.** Neither the path nor the text has an `at`, so the path's space is the document's.
13. **Repeat** is judged by matching glyphs between frames, not by grapheme index, since copies may number their graphemes
    either way; the run's advance keyed is 100 u (5 × 20).
14. **The counter.** The design has no notation that writes `02:15:04`, so `format.notation: "clock"`; the source is the data
    value a hold-keyed channel writes, `data/left`. The countdown's first step is at 0.4 s, which is what makes 4.4 s change
    three graphemes (02:15:00 → 02:14:59).
15. **A cell** is the glyph's `clip`; half a cell is half its height; up is −y. Rest is the glyph's place when nothing rolls:
    4.3 s for the old glyph, 5.0 s for the new. "The other three" are the hours' digits and the minutes' tens digit; the colons
    aren't judged.
16. **Refusals** name the item's ID somewhere in the refusal's JSON; no code is pinned.
17. **The taste pictures** are `motion-weight.png`, `text-on-circle.png`, `rolling-counter.png` and one recording of the three,
    `text-animators.apng`.

## Criteria out of reach

- **AC6's "taken by the check run from the canvas's own frames" and "attached to the PR and shown to you".** `taste.test.ts`
  reads what is recorded and can't see how a picture was made or where it was shown; it holds INCONCLUSIVE until the record
  exists.

## The taste call

The check run writes `docs/evidence/496/`: `motion-weight.png`, `text-on-circle.png`, `rolling-counter.png` (screenshots) and
`text-animators.apng` (one recording of the three), from the canvas's own frames (`raster` writes a PNG per frame). The
owner's one call goes in `tests/acceptance/496/TASTE.json`, as in #492:

```json
{ "issue": 496, "criterion": "#496.dc1c7447", "verdict": "looks_right", "who": "…", "when": "2026-11-07T09:00:00Z",
  "screenshots": { "motion-weight.png": "<sha256>", "…": "…" }, "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`; `screenshots` names all four files with their SHA-256. No test judges a picture.

## Scope not under a criterion

The issue's Scope and Fields also name: pivot, shear and its axis, blur, stroke, hue, saturation and brightness, line height,
tracking anchor, 3D rotate and z; `basis: index`, `grapheme_no_space`, strength from −1 to 1; field selectors, more than one
range selector and the ≤ 4 cap; noise's correlation, phase, spatial phase and lock; the animator's `axis` prop; `orient: none`;
`roll.dir: down`; a roll over a control or a logic array, and a roll refused on another source. No criterion states an
observation for them, so these tests don't check them; they are follow-ups for the implementer's own tests.

## At the base

`raster` reports no glyph `advance`, `outline`, `transform` or `clip`, no `coverage` and no `shaped`, knows none of the planted
names, refuses `notation: "clock"`, and draws a glyph shift on a counter. All 15 tests fail at the base on their own assertions
(`BASE-FAILURE.txt`), run on a clean export of `b52f7357`.
