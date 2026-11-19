# Acceptance tests for #1484: text at the size it's set, optical size and exact weights from a variable font

Written first, blind, from issue #1484 (its scope, seven acceptance criteria, proof line and "Not in scope"), the issues
it cites read only for the words it cites them for (#390 for "#390's bar", #496, #1479, #385, #241), the design sections
it links and those they lean on, and base commit `81c6b9c34` ("Merge pull request #2849 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Text `text@1` (Semantics: the shaped run is the only source for layout, hit tests, fit
  checks and drawing; where GPUI draws a 2D writer layer the run's glyphs come from the core's atlas, rasterized by
  Vello CPU from their outlines; the shape key and the layout key; "A variable font's axis values join the shape key and
  the atlas key and reach the rasterizer: optical size follows the size in u, and a weight draws exactly as asked"; a
  glyph past the atlas limit draws as a path from its outline; Cost; "It can never: … be measured by one engine and
  drawn by another") and Look `look@1` (`fonts`, `roles`, `themes`).
- `docs/technical-design.md`: How we know version 0 works (Wrong programs; the canvas line; the parity suite, its
  perceptual oracle and when a CPU reference counts as an oracle; Dogfooding; Tests written first); Every task carries its own budgets
  (five runs after warm-up, the margin, a loaded run counting neither way); Speed claims name their baseline (the merge
  base by default); The canvas core.
- At the base: `crates/deep-text` (`fonts.rs`: `FACES`, `Role`, #496's `family_at` and `static_of`; `shape.rs`:
  `Glyph.coords`; `cache.rs`: `Key`; `atlas.rs`: its `Key` and `rasterize`; `outlines.rs`: `outline_of`; `main.rs`:
  `fit`, `shape`, `--planted`), `crates/deep-text-gpui` (`place`, `OUTLINE_ABOVE`, `rasterized`),
  `crates/deep-marks-render` (`lib.rs`: `render` and `raster` requests, `view.zoom`, the planted names; `raster.rs`: the
  glyph rows and `fill_run` with the glyphs' coordinates; `macos.rs`: `render`'s answer; `status.rs`: `label_of`),
  `crates/deep-canvas-marks` (`scene.rs`'s text specs, `looks/clean.json`), and `crates/deep-text/fonts/InterVariable.ttf`'s
  own tables: `fvar` (`opsz` 14 to 32, default 14; `wght` 100 to 900, default 400; nine named instances, all at opsz
  14), `avar` (on `wght`), `gvar`, and `MVAR` (strikeout, underline and x-height only: no ascent or descent varies).
- The suites `tests/acceptance/1479/` (the closest model for AC3 and AC7, and its `taste/`), `496/` (`raster`'s glyph
  rows and outlines), `856/` (warm shaping timed from outside), `390/`, `1461/` (a `TASTE.json` with no call), `1636/`
  (the merge base as `git merge-base HEAD origin/main`); `scripts/benchmark.mjs` (`judgeLimit`'s rule),
  `scripts/proof-change.mjs` (criterion IDs) and `scripts/lanes.mjs`.

What the base already does, and these tests don't credit: #496 sets a weight no static face has (450, 700) on Inter
Variable at `wght`, and Vello CPU's snapshot fills those runs at their coordinates; the static faces (400, 500, 600)
draw the text cut at every size. What it lacks: nothing sets `opsz`; the atlas keys and rasterizes a glyph without its
coordinates, so the window draws a 450 or 700 run at Inter Variable's default instance; `deep-text fit` sets 450 and 700
on the nearest static face.

## Run them

```sh
npm ci --ignore-scripts      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1484 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1484/tsconfig.json   # type-check: the root's strict options
```

`cargo` must be on PATH (`rust-toolchain.toml`'s 1.99.1). Each file builds what it drives with `cargo build --locked
[--release] --bin <name>` in the checkout (honoring `CARGO_TARGET_DIR`; after a run's first file cargo finds it built),
copies the binary out under its own name into a temporary folder, and fails each of its tests when the build fails.
`warm.test.ts` also builds the merge base's `deep-text` for release, in a temporary folder. The pictures of AC6 go to
`docs/evidence/1484/`; every other file a test writes goes to a temporary folder it deletes. A run with `--root` may
leave Vitest's cache in `tests/acceptance/1484/node_modules/.vite`; delete it. Node built-ins and vitest only.
`BASE-FAILURE.txt` is the run at the base (At the base, below).

**Where each test can run.** AC1 and AC4 on any machine: `raster` and `deep-text` answer on every platform. AC2, AC3,
AC6 and AC7 draw with GPUI's offscreen Metal renderer, headless, on any Mac with no display, person or permission; off
macOS, or on an answer of `unsupported_platform`, they fail `INCONCLUSIVE:`, never passing. AC5 runs on any machine and
reads INCONCLUSIVE under load. `scripts/lanes.mjs` puts this folder in `alone` (its files build cargo binaries and draw
with GPUI, as #1479's do) and `warm.test.ts` in `timed` (it reads the machine's load and judges time); this job made that
edit in the same commit, as earlier suites did.

## Surface choices

The issue names outlines, instances, stems, atlas entries, a fit check, drawing, warm shaping, screenshots, a text
fixture document and a planted shaper, but no binary, call or field. Everything these tests drive exists at the base
except one planted program: no new binary, command or field.

| Surface | Built by | What the tests send, and read | Criteria |
|---|---|---|---|
| `deep-canvas-render raster` (crate `crates/deep-marks-render`; Vello CPU, as snapshots draw) | `cargo build --locked --bin deep-canvas-render` | a line `{out, doc, look: "clean", view: {zoom, theme}, planted?}`; reads `ok`, the PNG at `out`, and `texts.<item>.glyphs[]`: `font` (the face file's repo path), `size`, `id`, `grapheme`, `x`, `advance`, `outline` (`["M", x, y]`, `["L", x, y]`, `["Q", x1, y1, x, y]`, `["C", …]`, `["Z"]`: the glyph's own frame, in u, y down, at the coordinates it was shaped at) and `transform` (`[1, 0, 0, 1, X, Y]`: its pen position in the document) | AC1, AC2 (places), AC3, AC4, AC6, AC7 |
| `deep-canvas-render render` (GPUI's frame path, the live window's, headless; `view.zoom` is the window's scale factor) | the same binary | the same line; reads `ok`, the PNG, `texts.<item>.glyphs[].id`, and the frame report's `rasterized` (#1479: the glyphs the atlas rasterized for that line; the atlas carries from line to line in one process, as a window's does across frames) | AC2, AC3, AC6, AC7 |
| `deep-text fit` (#390's fit check) | `cargo build --locked --bin deep-text` | `{text, font: "body", size, weight}`; reads `ok`, `width` (the widest line's advance, px) | AC4 |
| `deep-text shape` (#856's) | `cargo build --locked --release --bin deep-text` here, and the same in a `git archive` of the merge base's `Cargo.toml`, `Cargo.lock`, `.cargo`, `rust-toolchain.toml`, `crates`, `vendor` and `packages/contracts` | `{text, font: "body", size, weight}` lines; reads `ok`, `glyphs`, `shaped`; `--planted no_cache` (#856's) | AC5 |

**Added by this issue (name chosen here):** `raster`'s `planted: "shaper_ignores_opsz"`, AC1's wrong program, set by the
line's own `planted` field, never by an environment variable. Any other unknown `planted` stays `bad_input`.

**The documents** are built in `helpers.ts` (`textDoc`): a figure with one layer, each text@1 item `font: "body"`,
`paint.fill.role: "ink"`, at a given `size` and `weight`, in the shipped look `clean` by ID, the look the app draws in, so
the body role resolves through the look's `fonts` as the app's does. Pixels are read in its dark theme (`snow` ink on
the `night` ground): a pixel's coverage is its red channel's distance from the ground's toward the ink's (2D writer layers
composite in sRGB-encoded space), the two colors read from `crates/deep-canvas-marks/looks/clean.json`. AC1 and AC4 read
no pixels and draw in the light theme, as do AC6's pictures. The text is `Hamburgefonts`: each letter a simple glyph in
Inter (`i` and `j` are composites, which the oracle doesn't read), one glyph a letter, none substituted (at the base the
program's glyph IDs equal `cmap`'s).

**The text fixture document** (AC6) is `fixtures/text.json`, written by this job: a 64 u title and a 14 u label in the
body role at 400, 450 and 500, one 140 u row a weight. Its texts hold no digit, which the honest-numbers check would
refuse unsourced.

### Planted programs

| Name | Where | The wrong program | Where its run must fail, and what the message names |
|---|---|---|---|
| `shaper_ignores_opsz` | `deep-canvas-render raster`'s `planted` | the shaper sets `wght` from the weight and leaves `opsz` at the axis default (14) at every size, as the merge base does; everything else as without it | `outlines.test.ts`'s second test: the 64 u title's outlines are the axis minimum instance's, 37 to 149 font units from the maximum's; the failure names `run title ("Hamburgefonts", 64 u, weight 400)` and each glyph with its distance |
| `no_cache` (#856's, exists) | `deep-text shape --planted no_cache`, on the change's side | a shaper with no shaped-run cache: every line shapes again | `warm.test.ts`'s second test: the judge must read FAIL on the five ratios it prints |

The merge base is the wrong program for AC2, AC3, AC4 and AC7: the issue calls its behavior the fault, and each fails
there (`BASE-FAILURE.txt`).

## Criteria to tests

Each test's name starts with its criterion's ID (`AC<n> #1484.<h8>`, as `scripts/proof-change.mjs` computes it from the
live issue).

| Criterion | File | What it asserts, and the wrong program it fails on |
|---|---|---|
| AC1 `#1484.57659fda` | `outlines.test.ts` (2) | One `raster` line of the title (64 u, 400) and the label (14 u, 400): every glyph's outline equals, within one font unit, the instance of the face its row names at `opsz` = that face's axis maximum (title) or minimum (label) and `wght` = 400, computed by `instance.ts` from the face file; a glyph set in a face with no `opsz` axis fails, naming its face. A guard asks that each letter's two instances lie more than ten font units apart, so the comparison tells the ends apart. The planted shaper fails it, naming `run title`. Base: both runs are set in the static `Inter-Regular.ttf`; the plant is `bad_input` |
| AC2 `#1484.2a04de3f` | `stems.test.ts` (1) | GPUI's frame (the window) at zoom 2 of `Il` at 24 u at 400, 450 and 500: each bar's stem at 450 exceeds 400's and falls short of 500's, each by more than 0.02 device px. Base: 450 reads exactly 400's stems |
| AC3 `#1484.1be2fec6` | `atlas.test.ts` (1) | One `render` process: `Hamburgefonts` at 16 u at zoom 2, then at 32 u at zoom 1 (both 32 device px a em, the second placed at twice the first's u, so its first glyph lands on the same device pixel and phase): the second line's `rasterized` counts every one of its distinct glyphs (none came from the first size's entries), and the window's second text holds #385's first criterion against Vello CPU's snapshot of it. Base: the second line rasterizes 0 |
| AC4 `#1484.f9223910` | `fit.test.ts` (1) | `deep-text fit`'s `width` against the drawn run's width (the largest `x + advance` of `raster`'s rows, zoom 1, so px = u) within 0.1 px, for `Hamburgefonts` at 64 u/400, 14 u/400, 20 u/450 and 13 u/700. Base: 20 u/450 and 13 u/700 disagree |
| AC5 `#1484.6f97433d` | `warm.test.ts` (2) | Release `deep-text shape`, the change against the merge base, warm µs a glyph of a 300-glyph label at 20 u and 450 (a process of 1 + 100,000 lines less one of 1 line, every warm line `shaped: []`), one warm-up round and five, the order swapped each round; the five ratios against 1.05 by the design's rule; a loaded round makes it INCONCLUSIVE. The `no_cache` twin must read FAIL. Base: the change is the merge base |
| AC6 `#1484.c44e2788` | `taste.test.ts` (1) | The check run writes `docs/evidence/1484/weight-400.png`, `weight-450.png` and `weight-500.png` and prints their SHA-256, then reads `TASTE.json` (The taste call). Base: the pictures are taken; no call is recorded, so INCONCLUSIVE |
| AC7 `#1484.2d4b65dd` | `window.test.ts` (1) | GPUI's frame against Vello CPU's snapshot at zoom 2 of `Hamburgefonts` at 13 u, 700, `font: body`: the run's summed coverage within 2%, its centroid within 0.1 device px; a failure names `run label ("Hamburgefonts", 13 u, weight 700)`. Base: the window's run holds about a third less coverage, and this fails, naming the run |

Proof line ("the outline comparison, the stem readings and the shaping reading"): `outlines.test.ts` prints nothing on a
pass and each glyph's distance on a failure; `stems.test.ts` prints the six stems; `warm.test.ts` prints the five
readings a side and their ratios.

## The oracle: `instance.ts`

AC1 compares a run's outlines with an instance computed by test code from the font file alone, written from the OpenType
specification: `fvar`'s axes, default normalization to F2Dot14, `avar`'s piecewise map, every `gvar` tuple whose region
holds the location scaled by its scalar (intermediate regions included), the deltas of untouched points inferred per
tuple and contour, fractional deltas kept; `glyf`'s simple glyphs (a composite is refused by name); `cmap` formats 4 and
12. It shares nothing with the program's shaper or outline reader. Before it was trusted, this job checked it at the base
with scratch probes (not part of the suite):

- Where the base is right (a weight on Inter Variable at `opsz` 14, which #496 already draws), it reproduces `raster`'s
  outlines of 27 letters at weights 150, 450 and 700 within 0.71 font units. With two conventions of the program's
  reader (the `wght` coordinate one F2Dot14 step higher at 450 and 700, as normalizing in 16.16 before `avar` gives, and
  deltas rounded to whole font units) it reproduces them exactly, point for point. The tolerance, one font unit at the
  run's size (0.031 u at 64 u, 0.0068 u at 14 u), holds those conventions and no more.
- Between the axis ends the instances lie far apart, in font units: H 42, a 144, m 76, b 78, u 86, r 125, g 106, e 102,
  f 145, o 84, n 93, t 63, s 149.
- The static faces are not instances of the variable face: `Inter-Regular.ttf`, `-Medium` and `-SemiBold` drop the
  variable face's overlapping contours (point sets up to 258 font units apart at their own weights), so a run set in a
  static face can't be read as at an axis instance, and the test says so by naming the face.

## The taste call

The call goes in `tests/acceptance/1484/TASTE.json`, which this job commits with no call recorded:

```json
{ "issue": 1484, "criterion": "#1484.c44e2788", "verdict": null, "who": null, "when": null, "screenshots": {}, "note": "…" }
```

A person fills it in once: `verdict` `looks_right` or `looks_wrong`, `who` (non-empty), `when` (ISO 8601), and
`screenshots` naming exactly `weight-400.png`, `weight-450.png` and `weight-500.png` with the SHA-256 the run printed.

| State | Result |
|---|---|
| A render or snapshot refused, or the build fails | fails, naming it |
| `verdict` null | fails `INCONCLUSIVE:`, listing the three files and their SHA-256 to show |
| `TASTE.json` not JSON, or a field missing or wrong | fails, naming the field |
| A recorded SHA-256 differs from this run's (a call on other pictures) | fails `INCONCLUSIVE:`, naming each file, recorded and drawn |
| `looks_wrong` on these pictures | fails, quoting who, when and the note |
| `looks_right` on exactly these pictures | passes |

Every run rewrites the three files, so a call always meets this run's pictures. Attaching them to the PR and showing them
in the session is the implementer's step, outside the test. No other test reads a picture to judge it.

## Readings where the issue leaves a choice

1. **"The axis maximum instance" and "the minimum"** are the instances at the `opsz` axis's maximum (32) and minimum (14)
   with `wght` at the run's own weight (400), in the face the run is set in, not `wght` at its own maximum. "Bundle the
   variable font. Set `opsz` from the size in u … and `wght` from `weight`" reads as every body run being set on the
   variable face; a run in a static face, as both are at the base, fails, naming its face.
2. **"Outlines equal"** is read as point sets: each glyph's on-curve points (with the midpoints a quadratic contour
   implies) and its control points, every point of each within one font unit of the other's nearest, both ways. The
   order of contours and the point a contour starts at don't count; their geometry does.
3. **Where a run's outlines are read**: `raster`'s glyph rows, the shaped run's outlines at the coordinates it was
   shaped at. The window draws the same run (`render`'s rows carry no outline); what the window draws is AC2's, AC3's
   and AC7's.
4. **"A planted shaper that ignores the axis"** ignores `opsz`, the axis the criterion's two sizes span; it keeps `wght`,
   which #496 already sets.
5. **Stems** are read where the issue's fault is, the window: GPUI's frame of `I` and `l` (plain bars in Inter) at 24 u,
   zoom 2 (48 device px, under the 64 px threshold, so from the atlas); a stem is a row's coverage summed across the
   glyph's band, averaged over the rows from 0.1 to 0.6 em above the baseline. "Strictly between" is read at the
   reading's resolution: more than 0.02 device px from each neighbour. The expected gaps are about 0.48 device px each
   (the instances' bars at opsz 24: 184, 205 and 225 font units); at the base 450 reads exactly 400's.
6. **"Share an atlas entry"** is observed from outside the atlas: through the frame report's `rasterized` across two
   lines of one `render` process, and through what the window then draws. Two sizes at different coordinates share an
   entry only where everything else in the atlas's key agrees, so the two lines put the same device size, face, glyph,
   slant and (for the first glyph) pen phase on screen, and only `opsz` (16 and 32 by the issue's rule) tells them apart.
7. **"Drawing" in AC4** is the canvas's drawn run, read from `raster`'s rows: the run's width is the largest `x +
   advance`. The window draws the same shaped run. "0.1 px" is at zoom 1, where px = u. The four texts are the title
   and the label of AC1, a size between the ends at a weight with no static face, and AC7's label.
8. **"Warm shaping"** is #856's: a label already shaped once, shaped again through the shaped-run cache, timed from
   outside as µs a glyph, on a release build. **"Within 5% of the merge base"** is the change's reading at most 1.05
   times the merge base's, paired round by round, judged by the design's rule (five rounds after a warm-up; PASS all
   within, FAIL all over by more than the margin, else INCONCLUSIVE), with a round whose one-minute load average at its
   start or end is above the core count counting neither way. The merge base is `git merge-base HEAD origin/main`. The
   criterion names no reference Mac, so the machine isn't gated. The per-line cost of reading and writing JSON is in both
   sides alike.
9. **"The text fixture document"** is `fixtures/text.json`; **"screenshots of a title and a label at 400, 450 and
   500"** are one PNG a weight, that weight's row from the window beside the same row from Vello CPU's snapshot, at zoom
   2 (the reference window's scale); **"attached to the PR"** is `docs/evidence/1484/`, where #1479 and #496 keep theirs.
10. **"#390's bar"**: #390's own criteria give no coverage bar for the window against a snapshot (one compares the window
    with itself under two font-smoothing settings). #390 is where the window's glyphs became Vello CPU's raster in the
    canvas's atlas, and the repo holds GPUI's glyph runs to Vello CPU's at #385's first criterion (#1479's suite, #140's
    oracle): the run's summed coverage within 2% and its coverage centroid within 0.1 device px. That is the bar here.
11. **"In the live window"** is GPUI's frame path headless (`render`), as #1479's suite reads the live view, at zoom 2,
    the reference window's scale. **"In the body role"** is text@1's `font: body`, in the shipped clean look.
12. **The shipped look in every canvas line.** `clean.json`'s `fonts` names the body role's face; a change that moved the
    body role to the variable face in `deep-text` but left the look naming a static face would still draw the app's
    titles in the text cut, so every `render` and `raster` line draws in that look. `deep-text` takes no look: its `fit`
    and `shape` read the body role as `deep-text` resolves it, which AC4 holds to what the canvas draws.

## Not tested

- **"Bundle the variable font"** as a file or a `FACES` entry: the tests read whichever face each run names.
- **"The normalized coordinates join the shape key"**: no criterion states a reading of the key itself; AC5 times the
  warm path the key serves, and AC3 the atlas key's effect.
- **Glyphs past the atlas limit**: #1479's path already draws them from outlines at their coordinates.
- **3D labels and status marks**, which also draw from an atlas (`deep-canvas-scene3d`, `deep-gpu-layer`): no criterion
  names them.
- **Other fonts' axes and OpenType feature controls**: out of scope.

## At the base

`BASE-FAILURE.txt` is the run at `81c6b9c34` (after two corrections, the two files they touched ran again; it says
which). All nine tests fail there, none passes:

| Test | Where it fails at the base, and why |
|---|---|
| AC1 the outlines | its problems list: both runs are set in `crates/deep-text/fonts/Inter-Regular.ttf`, a face with no `opsz` axis, so neither can be at an axis instance (nothing sets `opsz`, and the body role's 400 is a static face) |
| AC1 the planted shaper | `raster` answers `bad_input` to `planted: "shaper_ignores_opsz"`: the surface is missing |
| AC2 the stems | its problems list: in the window 450's stems read exactly 400's (`I` 4.454, `l` 4.218 device px; 500: 5.345, 5.155): the atlas draws 450 at Inter Variable's default instance, while Vello CPU's snapshot of the same figure draws them between (4.903, 4.689 in a probe) |
| AC3 the atlas | the second line's `rasterized`: the 32 u text rasterizes 0 of its 13 glyphs, all taken from the 16 u text's entries |
| AC4 the fit | its problems list: at 20 u and 450 the fit check measures 148.467 px and drawing 147.393; at 13 u and 700, 97.862 and 99.252 (the fit check sets them on static faces); the title and label agree |
| AC5 warm shaping | INCONCLUSIVE: the machine was loaded (load average 52 to 92 on 18 cores). At the base the change is the merge base, so this criterion can read only PASS or INCONCLUSIVE there; its readings, the base against itself, were 0.87 to 1.18 under that load. The `no_cache` twin read 22 to 29 times the merge base, which on an unloaded machine is FAIL, but loaded it is INCONCLUSIVE too |
| AC6 the taste call | INCONCLUSIVE: the three pictures were taken (and deleted after; none is committed) and `TASTE.json` holds no call |
| AC7 the window | its problems list, naming `run label ("Hamburgefonts", 13 u, weight 700)`: the window's summed coverage is 33.6% under Vello CPU's, its centroid 0.527 device px off: the window draws the default weight |
