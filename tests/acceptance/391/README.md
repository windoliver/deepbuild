# Acceptance tests for #391: the line's motion and 2D marks

Written first, from issue #391 (its scope, the Channel and key fields, its six acceptance criteria and its
proof line), its Oracle page (`doneright/oracles/issues/391.md` in `DeepBuildAI/deepbuild`, branch
`doneright`, and the upstream tests it copies under `doneright/oracles/vendor/`), the design sections it
names (`docs/technical-design.md`: The canvas core, line 1041, with the module table's text, marks2d, data
and motion rows, lines 1053–1059; the Conventions paragraph on the GPUI patch's exact gradient mode, line
1080; 2D marks and paint, 1104; Mark set, scale and encode, 1112; Channel and key, 1158; Clip, placement and
marker, 1182; Shot and transition, 1195; Matte, text animator and counter, 1203; Transport, 1219; Patch,
1467; Dirty classes and content key, 1483; Dogfooding, 2508; Tests written first, 2539;
`docs/canvas-primitives.md`: Conventions every primitive uses, line 7, with Honest numbers, 76, and the cost
model's "Every class draws nothing while still", 99; Frame clock and scheduler, 711; Invalidation and damage,
727; Carried state: the cache manifest, 1171; Marks, data and diagrams, 1361, with Text 1367, Rect 1474,
Circle 1492, Path 1510, Paint 1640, Image 1760, Mark set 2039, Scale and encode 2182; Dirty classes, 5026;
Content key, 5042; The order of one evaluation, 5064; Transport, 5076; Clip, 5108; Placement, 5126; Marker,
5207; Channel and key, 5246; Follow, 5316; Text animator and counter, 5832) and base commit `4f6dec5`
("Merge pull request #647 … feat/390-canvas-text"), by a job that never saw an implementation; none existed.
The conventions follow #389's and #390's suites (`tests/acceptance/389/`, `tests/acceptance/390/`). The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them (a root with no config of its own uses Vitest's defaults; the repo's `vitest.config.ts` also takes
`tests/**/*.test.ts` from `scripts/lanes.mjs`, so they join the unit lane; like #389's and #390's they build
cargo binaries, so they run with `--no-file-parallelism`, and `scripts/lanes.mjs` needs its exclude
(`--exclude tests/acceptance/390/**`) and its one-at-a-time line (`… 'tests/acceptance/389/',
'tests/acceptance/390/'`) widened to this folder too):

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/391 --no-file-parallelism
```

`bezier`, `loops`, `subdivision` and `clock` first run `cargo build --locked --bin deep-motion`; `still`,
`rebuild` and `gradient` run `cargo build --locked --bin deep-canvas-render`, in the checkout (cached after
the first file); each fails every test of its file when its build fails. The gradient test writes PNGs under
the OS temp folder and deletes them. The tests use only node built-ins and vitest (the PNG reader is in
`helpers.ts`, as #390's is), and type-check under the root `tsconfig.json`'s strict options with
`allowImportingTsExtensions` and `noEmit` (checked with a copy of the options outside the repo whose
`include` is this folder). A run with `--root tests/acceptance/391` leaves Vitest's cache in
`tests/acceptance/391/node_modules/.vite`; delete it, it is not part of the suite. `BASE-FAILURE.txt` is the
run at the base: every test fails there because neither binary exists.

The GPU tests (`still`, `rebuild`, `gradient`: AC1, AC2, AC6) need macOS: GPUI's offscreen Metal renderer
draws the view, as `deep-text-render` does at the base. Off macOS, and whenever `deep-canvas-render` answers
`unsupported_platform`, they fail with a message that starts `INCONCLUSIVE:`; they never pass there.

## The surface under test

The issue names motion, marks, caches and a frame clock, but no code API, so these tests define the smallest
surface they need: two binaries found under `target/debug/`, in whichever workspace crates the implementer
puts them (the design's modules are text, marks2d, data and motion; the core never imports a module):

- `deep-motion` (`target/debug/deep-motion`): `eval`, `insert` and `run`. CPU only; it needn't reach GPUI.
- `deep-canvas-render` (`target/debug/deep-canvas-render`): `frames`, `session` and `render`, drawing the 2D
  view with GPUI's offscreen Metal renderer through the GPUI patch. Since it draws canvas text, its crate
  belongs in `scripts/text-lint.mjs`'s scope (#390: named `deep-text…` or `[package.metadata.deep]
  canvas_text = true`); a crate named `deep-canvas…` is also in `scripts/canvas-lint.mjs`'s scope (#389).

Nothing else is read.

### The JSON-lines convention

`<binary> <subcommand>` reads one JSON object per stdin line and writes exactly one JSON object per input
line to stdout, in order, then exits 0. A line it can't read as JSON, or that lacks a required field, or
names an unknown `planted` value, is still answered with one line, `{"ok": false, "code": "bad_input"}`,
never a panic; a line is read before anything platform-specific, so `bad_input` comes before
`unsupported_platform`. A run that writes fewer lines than it read, or exits non-zero, fails every test that
drove it. Every refusal is `{"ok": false, "code": string}` (a document the check refuses answers with the
check's own code, from the design's closed list); every acceptance has `"ok": true`. Times are flicks
(1/705,600,000 s) as JSON integers; every time the tests use is below 2^53. Numbers are read exactly (the
shortest decimal text that reads back to the f64, as JS and Rust print it), and f64 results are written so
they read back to the same f64.

### Documents

The documents are the design's envelope (`format`, `id`, `profile`, `title`, `description`, `size`,
`transport`, `layers`, `items`, `channels`, `clips`, `placements`, `bound_values`; canvas primitives, Document
and Item and kind), with items `{id, kind, layer, name, order, params, at?, visible?, adjust?}` and these
kinds and params (2D marks, in logical pixels, y down; a paint names look roles, never a color):

| Kind | Params the tests use |
|---|---|
| `rect@1` | `box: [x, y, w, h]`, `radius`, `paint` |
| `circle@1` | `center: [x, y]`, `r`, `inner_r`, `paint` |
| `text@1` | `text`, `font` (a look role, `body`), `size`, `numerals`, `widest`, `box: {w, h}` |
| `path@1` | `d` (the design's SVG path string form, converted at check), `paint` |

A paint is `{fill?: {role} | {gradient: {kind: "linear", stops: [{at, role}, {at, role}]}}, stroke?: {role,
width}}`; a two-stop linear gradient runs from the box's west edge to its east edge (`from: w, to: e`, the
default). `at.pos`, `at.rot` and `at.scale` are three numbers each (an item draws at its params offset by
`at.pos`); `adjust.tint` is a color.

Time fields are the time grammar's text (`"3s"`, `"0.001s"`). A channel is `{target: path, type: "f32" |
"color", space?: "oklab", keys: {ID → key}}`; a key is `{t, value, interp}`, and `interp` is `"linear"`,
`"hold"`, `{"bezier": {x1, y1, x2, y2}}` (x in [0, 1], y free, normalized over the segment: x over its span,
y over its value change) or `{"spring": {freq_hz, damping_ratio}}`. The left key owns its segment and the
last key holds after it, as does the first before it (`extrapolate` hold, the default). A color channel with
`space: "oklab"` holds and mixes `[L, a, b]` values. A spring segment runs from its key's value toward the
next key's, solved in closed form from rest at the segment's start, and the next key's value shows from its
time on; that is when the spring settles.

A clip is `{slots: {name → {type: kind, required}}, span: "auto", channels: {ID → channel}}`, its channels
targeting `slot:<name>/<path>` (`slot:target/at/pos/0`), and `span: auto` its last key's time. A placement is
`{clip, slots: {slot → item ID}, start, repeat?: {count, mode: "wrap"}, extend?: {before?, after?: "hold" |
"none"}}`: active on [start, start + count × span), local time `t − start` within each pass, 0 at each wrap
(right-continuous, like keys); after the final pass, with `extend.after: hold`, it holds the end pose (local
time = span); before its start, with `extend.before: hold`, the start pose. `transport: {span, loop: "none" |
"wrap"}` loops the timeline over [0, span). A bound value `{target: "items/<id>/params/text", source:
"reading:<ULID>"}` shows the reading the run supplies for its handle.

### `deep-motion eval`

Input `{"doc": Document, "times": [flick]}`, the times in the order of the frames. Output `{"ok": true,
"frames": [Frame]}`, one per time, in order:

```json
{"t": flick, "doc_t": flick, "pass": n, "passes": n,
 "items": {ID: {"at": {"pos": [x, y, z], "rot": [x, y, z], "scale": [x, y, z]}, "params": {…}, …}},
 "channels": {ID: {"value": number | [number], "iterations": n}},
 "placements": {ID: {"iteration": n | null, "local": flick | null, "passes": n}}}
```

- `doc_t` is the timeline's position: with `transport.loop: "wrap"`, `(t − start) mod span` (Euclidean),
  so exactly 0 at each wrap; otherwise `t`. `pass` is the loop's pass, ⌊t ÷ span⌋ under wrap, else 0.
- `passes`: the wraps in (the previous frame's `t`, this frame's `t`], so a frame that spans three loops
  counts 3; 0 for the first frame. A placement's `passes` counts its own wraps the same way; the end of its
  final pass is not a wrap.
- `items`: every item as evaluated at `t` (channels and placements applied), `at.pos`, `at.rot` and
  `at.scale` always written as three numbers; the rest in any form that is the same at every evaluation.
- `channels`: every document channel's value at `doc_t` in f64, before it is stored in its target's field
  (an f32 channel's number; a color channel's `[L, a, b]` in its space). `iterations` is the number of steps
  the Bézier timing solver ran for this sample (Newton or bisection steps together), 0 when the sample is not
  on a Bézier segment. The design's solver runs a fixed count with no early exit (Channel and key).
- `placements`: the 0-based pass the time falls in and the local time within it (`null` both where the
  placement writes nothing), as Placement and the WPT cases define them.

### `deep-motion insert`

Input `{"doc": Document, "channel": ID, "t": flick}`; `t` lies strictly inside a segment. Output `{"ok":
true, "doc": Document, "key": ID}`: the document with one key added to that channel at `t`, at the curve's
own value there (the value `eval` gives at `t`), with the split segment's interpolation; `key` is its new
ID. Splitting a Bézier segment splits its handles (de Casteljau at the solved parameter, renormalized to each
part, the left key's handles rewritten, as Blender's `BKE_fcurve_bezt_subdivide_handles` does), so the curve
keeps its shape. Nothing else in the document changes.

### `deep-motion run`

Input `{"doc": Document, "to": flick, "mode": "armed" | "every_vsync", "refresh_hz"?: 60, "planted"?:
"valid_until_ignores_placements"}`. A virtual display clock at `refresh_hz` (its frame a whole number of
flicks: 11,760,000 at 60 Hz) ticks vsyncs at k × Δ for every k × Δ ≤ `to`, with no commit, reading or input
in the run. `armed` evaluates and presents a frame only when the frame clock arms one: at vsync 0 (the
session's first frame) and at the first vsync at or after the presented frame's `valid_until` (the earliest
time anything visible changes next; The order of one evaluation, step 7). `every_vsync` evaluates and
presents at every vsync. Output `{"ok": true, "vsyncs": [{"t", "presented": bool, "valid_until": flick |
null, "items": {…}}]}`, one per vsync: `items` (as in `eval`) and `valid_until` (null: never) are those of
the frame on screen at that vsync, the last presented one.

`planted: "valid_until_ignores_placements"` is the criterion's planted twin, reachable only through this
field and only for this proof: `valid_until` computed with placements left out. Nothing else reads it.

### `deep-canvas-render frames`

Input `{"doc", "look", "view"?: {"zoom": 1, "theme": "light"}, "readings"?: {handle → number}, "refresh_hz"?:
60, "vsyncs": n}`. Opens the document's view in a headless window at scale 1 and runs its frame clock on a
virtual display for `n` vsyncs from t = 0, drawing with GPUI's offscreen Metal renderer only when the clock
arms a frame. Output `{"ok": true, "vsyncs": [{"t", "presented": bool, "command_buffers": n, "gpu_ns":
number}]}`: per vsync, whether a frame was presented, how many Metal command buffers were committed for it,
and the GPU time they took (their GPU start to end times), 0 and 0 when nothing was drawn. Window setup
before vsync 0 is not counted.

`look` is the look the render resolves roles through: `{"light": {role → [r, g, b]}, "dark"?: {role → [r, g,
b]}}`, sRGB-encoded 0–255, standing in for a look asset; the frame is cleared to the theme's `ground`. A
handle in `readings` that no bound value names is ignored.

### `deep-canvas-render session`

Input `{"look", "steps": [{"doc"?, "t", "view"?, "readings"?, "frames"?: 5}]}`. One document session:
the first step must carry `doc` (`bad_input` otherwise); each later step's `doc` is a whole new revision
(R1: whole revisions through `deep_show`) and any field a step leaves out carries over. Each step presents
`frames` frames at `t`, `t + Δ`, … at 60 Hz (the board's live layer moves, so the clock arms each). Output
`{"ok": true, "steps": [{"caches": {"tessellation": [Entry], "text": [Entry], "layers": [Entry]}}]}`, one
per step, each listing the cache entries the step's last frame drew from:

- `tessellation`: `{"item", "bucket": integer, "key", "len", "sha256"}`, a path's tessellation by (content
  key, zoom bucket);
- `text`: `{"item", "key", "len", "sha256"}`, a text item's shaped run;
- `layers`: `{"layer", "key", "len", "sha256"}`, a writer layer composited from its cache (made after 3
  stable frames; Invalidation and damage).

`key` is the entry's 128-bit content key in lower-case hex (32 digits), `len` the byte length of the cached
output (vertices and indices, the shaped run, the layer's pixels: the bytes the cache serves), `sha256` its
lower-case hex SHA-256. A clean rebuild is the same call with one step holding the whole state, run in its
own process so no cache from another session exists.

### `deep-canvas-render render`

Input `{"out": path, "doc", "look", "view"?, "t"?: 0, "planted"?: "gpui_oklab_gradient"}`. Draws the view at
`t` with GPUI's offscreen Metal renderer at scale 1, two-stop gradients through the GPUI patch's exact
gradient mode (no dither, the sRGB curve, premultiplied stops), and writes it to `out` as an 8-bit RGB or
RGBA PNG, no interlace, exactly the document's `size`. Output `{"ok": true, "width", "height"}`.

`planted: "gpui_oklab_gradient"` is the criterion's wrong build, reachable only through this field and only
for this proof: two-stop gradients drawn through GPUI's own OKLab option (its 2.2 power curve and dither).

Off macOS every `deep-canvas-render` line that parses answers `{"ok": false, "code":
"unsupported_platform"}` (exit 0), which the tests report as INCONCLUSIVE.

## Fixtures

All written by this job before any implementation ran, as JSON documents in the format above.

- `fixtures/parity/2d/patch-equals-rebuild.board`: a 480 × 270 board in two writer layers. `board` holds a
  card with a two-stop gradient, a badge, three texts (a title, a count bound to
  `reading:01JB0000000000000000000000`, a note), a ring and two paths; `live` holds a dot whose channel moves
  it over [0, 10 s), so frames keep coming and the board layer is cached while it stays still.
- `fixtures/parity/animation/subdivision-stable.film`: a 4 s film with four channels, each with a linear
  segment a key is inserted on: `lin` (one linear segment, insert at 1 s), `held` (a hold segment, then a
  linear one, insert at 3 s), `curve` (a Bézier segment, then a linear one, insert at 3 s) and `tint` (an
  OKLab color, insert at 1 s). Key values are chosen so the curve's own value at each inserted time is exact
  in f64 and not in f32 (such as 1 + 2⁻⁴⁰ → 5 + 2⁻⁴⁰, a quarter of the way at 2 + 2⁻⁴⁰), no segment crosses
  zero, and the inserted key sits on the same curve: a plain f64 evaluator (left key owns the segment, `a +
  (b − a) × u`) stays within 1 ulp at all 403 sample times (this job checked with a scratch script), while a
  key stored through f32 moves the curve by millions of ulps.
- `fixtures/still-figure.json`: a figure where nothing changes until a placement starts at 3 s; its clip
  springs the dot's x from 20 to 100 (`spring {freq_hz: 2, damping_ratio: 1}`) and settles at the clip's
  last key, 1.2 s later, at 4.2 s; `extend.after: hold` keeps it there.

## Criteria to tests

Each test's name starts with its ID. Where a criterion names a wrong program, a comment at the assertion that
catches it says so, and the assertion's message names what the criterion asks for.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A still view uses no GPU time | `still.test.ts`: the board with its channel, bound value and count removed, 120 vsyncs at 60 Hz: vsync 0 presents with at least one command buffer and GPU time above 0; every later vsync presents nothing, commits nothing and reports 0 ns (a canvas that redraws or encodes every vsync fails). The board as it is, its dot moving all 120 vsyncs: every vsync presents with a command buffer and GPU time above 0 (a reporter that always says 0 fails). Its dot's last key moved to 2 s: vsyncs 0–119 draw, vsyncs 121–179 draw nothing |
| AC2 | parity/2d/patch-equals-rebuild.board covers every cache this task ships (tessellation, shaped text, writer-layer caches): after each kind of change, the cached output equals a clean rebuild byte for byte | `rebuild.test.ts`: one session through 13 states, 0.1 s apart (the opening state, then t alone, a transform, a geometry change, a shading change, a text change, a text size change, a reading change, a hidden item, a created path, a deleted text, zoom 1 → 2.5 across a bucket, the dark theme); after each, every entry of the three caches (item or layer, bucket, key, length, SHA-256) equals a clean rebuild of that state in a fresh process, and each dump holds the route's tessellation, the title's shaped run and the board layer's cache. The second test proves the comparison can fail without reading internals: in clean rebuilds, each change alters the entry it touches (the board layer for transform, shading and theme; the route's tessellation for geometry and zoom; the title's run for text and size; the count's run for the reading; the arrow's tessellation gone when hidden, the pin's there when created, the note's run gone when deleted), so a cache that kept serving the old entry would differ from the rebuild; and the title's key is the same in the five states before its text changes |
| AC3 | At an exact wrap time a loop shows its start pose, right-continuous like keys, and frames spanning 0, 1 and 3 loops count every pass; Bézier timing with handles at x = 0 and x = 1, a linear pair and near-vertical handles stays finite and monotonic in x with a fixed iteration count in f64 | `loops.test.ts`: WPT's iteration cases ported to a placement of three 100 ms passes starting at 1 ms with extend hold both ways (before → pass 0, local 0, pose 20; at the start → 0, 0; one flick before the first wrap → pass 0, near 80; at each wrap → the next pass, local 0, pose 20; at and after the end → pass 2, local = span, pose 80); a placement of eight 1 s passes, frames at 0.25, 0.5, 1.5, 4.5, 5, 5.5 s counting 0, 0, 1, 3, 1, 0 passes (a program counting "wrapped or not" says 1 for the third), the exact wrap at 5 s at local 0 and pose 0; the transport's 2 s wrap loop, frames counting 0, 0, 1, 3, 0, 1, 0, `doc_t` exactly 0 and the channel exactly 0 at the wrap, just under 100 one flick before. `bezier.test.ts`: six handle sets on 0 → 100 over 1 s and Blender's on 0 → 1 over 9 s, at 1,001 times plus Blender's frames: all finite and ending on their keys; WPT's three cubic-bezier cases and the others within WPT's 0.02 of testcommon.js's bisection reference at WPT's sample times; Blender's ten stored values within 2e-7 and increasing; never falling in x for the sets whose y(s) never falls; one positive iteration count at every interior sample of every set (a solver that exits early fails), 0 off a Bézier segment |
| AC4 | A key inserted at the curve's own value on a linear segment changes nothing within 1 ulp in f64, for linear, hold, Bézier and OKLab channels (parity/animation/subdivision-stable.film) | `subdivision.test.ts`: for each of the fixture's four channels, `insert` on its linear segment adds one key whose value is bit for bit the curve's own and whose interpolation is linear, leaves every other key and channel as it was, and every channel's value at 403 times from −0.5 s to 4.5 s stays within 1 ulp of the original, per component for the color (an insert that stores its value through f32, takes the wrong interpolation, or disturbs the neighbouring hold or Bézier segment fails). Blender's subdivision case: the split handles and the new key's value, within EXPECT_FLOAT_EQ, and the curve's shape kept within EXPECT_FLOAT_EQ at 141 times |
| AC5 | A still figure whose placement starts at 3 s and whose spring settles at 4.2 s presents frames at both times by the frame clock alone, and the every-vsync run's evaluated data equals the armed run's at each vsync; a planted `valid_until` that ignores placements stops at 0 s and fails, naming the item | `clock.test.ts`: the armed run over 10 s at 60 Hz presents at 0 s, nothing before 3 s, at 3 s, at every vsync while the spring moves, at 4.2 s and nothing after, with `valid_until` 3 s on the first frame and null on the settled one; the armed run's presented data equals an every-vsync run's at all 601 vsyncs, item by item, and the dot really goes 0 → 20 (at 3 s) → between → 100 (at 4.2 s). The planted twin presents only at 0 s, and the same comparison fails on it with a message naming `item dot` (and not the still card or label) at the vsync of 3 s |
| AC6 | A two-stop OKLab gradient from black to a grey of sRGB 0.2 (code 51), drawn by GPUI through the patch's exact gradient mode, reads 13 at its midpoint, and every row of a horizontal gradient is identical; a build that draws it through GPUI's own OKLab option reads about 20 there, with rows that differ by its dither, and fails this test, naming the pixel | `gradient.test.ts`: a 255 × 32 rect whose gradient runs from role `grad.from` [0, 0, 0] to `grad.to` [51, 51, 51]: pixel (127, 16), whose center is exactly halfway, reads [13, 13, 13]; every row equals row 0; pixel 0 reads black and pixel 254 reads 51, and the ramp never falls (so a solid fill of 13 fails). The planted build fails the same check with failures that start `pixel (x, y) reads`, reads 17–23 at the midpoint, and its rows differ |

The bad_input convention is checked once per binary (`loops.test.ts`, `rebuild.test.ts`).

## Readings where the issue and design leave a choice

- **Two binaries.** Motion evaluation, key insertion and the frame clock run without a GPU, so they live in
  `deep-motion`; GPU time, the caches (a writer layer's cache is GPU work) and the gradient's pixels need
  GPUI's renderer, so they live in `deep-canvas-render`, as #390's render lives in `deep-text-render`.
- **"A still view uses no GPU time"** is read through the frame clock's own counters: presented frames,
  committed command buffers and their GPU time per vsync, the first frame excepted (the view has to appear).
  The moving board keeps the counters honest.
- **"Each kind of change"** is the 2D dirty classes (transform, geometry, shading, presence as hide, create
  and delete, text, reading, time) plus the two view inputs the 2D caches are keyed by, the zoom bucket of a
  tessellation and the theme (Path; Paint: "the theme is part of every cache key"). Whole revisions, not
  patches: R1 lands whole revisions through `deep_show` and patches in R2.
- **A cache entry "the last frame drew from"**, rather than everything a cache still holds, so the comparison
  doesn't depend on when an unread entry is released.
- **The loop.** The transport's `loop: wrap` lands in R1 and is tested for the wrap and the pass count;
  WPT's iteration cases need a finite count and an end, so they run on a placement's `repeat` with
  `extend`, the Placement fields the design gives (its semantics state the wrap rule word for word). `in`,
  `rate` and fractional counts are not used.
- **"Monotonic in x"** is checked on the value for handle sets whose y(s) never decreases, where a value that
  falls means the time solve ran backwards; the other sets are held to WPT's reference. **The fixed
  iteration count** is the solver's own report, checked at interior samples only (a sample on a key shows the
  key's value).
- **Tolerances.** WPT's 0.02 on a 0–100 animation is the WPT test's own epsilon. Blender's stored values are
  f32 results; 2e-7 is f32's resolution near 1 with room for its rounding (cubic-bezier(1, 0, 0, 1), which
  Blender's clamped extreme handles reduce to, reproduces them within 1.1e-7 in this job's f64 computation).
  Blender's subdivision values use its own EXPECT_FLOAT_EQ (4 ulps of f32). The 1 ulp in f64, the midpoint's
  13 and the planted build's "about 20" are the issue's; "about 20" is read as 17–23, from GPUI's shader at
  gpui-pre-apple 0.3.9 (`srgb_to_linear` is `pow(c, 2.2)`, giving 19.8, and the dither adds up to ±2 codes).
- **"On a linear segment … for linear, hold, Bézier and OKLab channels"** is read as: each kind of channel
  takes the new key on a linear segment, beside a hold or a Bézier segment that must not move; the Oracle page
  puts Bézier subdivision itself under Blender's test, which is held to its own tolerance.
- **The spring** is a key's `interp: spring {freq_hz, damping_ratio}` owning its segment to the next key, one
  of the issue's Key fields; "settles at 4.2 s" is that segment's end, so the settle time is set by the
  document, not by a threshold the design doesn't give.
- **The figure's span.** The run covers the figure's 5 s span plus 5 s, as the scheduler's kit case does
  (Frame clock and scheduler).
- **Kinds** are written as the design names them (`rect@1`, `circle@1`, `text@1`, `path@1`; Item and kind:
  "such as `slab@1`"), and paths take the design's SVG string form `d`.
- **Planted twins** are fields of the subcommands that the criteria name (`valid_until_ignores_placements`,
  `gpui_oklab_gradient`), documented above as reachable only for this proof.

Not tested, because no criterion asks: mark sets, axes and the time scale; counters' formatting; stagger and
series; images; child-of parenting and markers; cuts. The scope lists them; these criteria don't reach them.

## Upstream tests (the Oracle lane)

The Oracle page lists upstream tests for criteria 3, 4 and 6; each is run here against our output:

| Criterion | Upstream test (pinned) | How it runs here |
|---|---|---|
| 3 | wpt `2f57f45d21` css/css-easing/cubic-bezier-timing-functions-output.html and testcommon.js | ported: testcommon.js's `cubicBezier` reference is copied into `helpers.ts` with WPT's 3-Clause BSD notice; its three cubic-bezier functions and sample times run against our channels, at its epsilon |
| 3 | wpt web-animations/…/simple-iteration-progress.html, current-iteration.html | ported: the `{iterations: 3, iterationStart: 0, duration: 100, delay: 1, fill: 'both'}` case's before, active-boundary and after expectations, on a placement |
| 3 | blender `0a18557098` tests/python/bl_animation_fcurves.py, test_fcurve_extreme_handles | ported as data: the ten stored values (GPL: no code copied) |
| 4 | blender blenkernel/intern/fcurve_test.cc, BKE_fcurve_bezt_subdivide_handles | ported as data: the keys, handles and split handles (GPL: no code copied) |
| 6 | wpt css-images/gradient/oklab-gradient.html, css-color/parsing/color-computed-color-mix-function.html | the OKLab midpoint rule they check gives this criterion's code 13; their red-to-green reftest is not run (it needs a browser), so the midpoint is checked on our pixels instead |
| 6 | palette `71011dee47` palette/src/oklab.rs | formula: Ottosson's matrices, which this job used to compute 13, 0 and 51 |

Criteria 1, 2 and 5 have no upstream test (the page says so); these tests are their local proof.
