# Acceptance tests for #408: film.layout: cut, overlap, crossing and covered text on evaluated data at every cue end

Written first, from issue #408 (its scope, its Film layout fields, its 5 acceptance criteria and its proof line: "The
crossing, overlap, covered and cut fixtures with their codes and times, the test module's label caught, and the
timing run"), its Oracle page's result (no upstream test covers any criterion: film.layout's codes, shares and
cross-machine equality are our own checks on evaluated data, so this suite ports nothing), the design sections it
names and those they lean on, and base commit `d51be2c3` ("Merge pull request #2108 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Lean: one test per criterion, plus the one planted wrong program
criterion 4 names.

**Not run against a binary.** The machine's load was about 80 on 18 cores, so no Rust was built and the suite wasn't
run at the base (`BASE-FAILURE.txt` says why each test fails there). The type-check passes, and the fixtures' own
numbers (the waves inside the frame, the 21 of 49 covered samples, the markers' ends) were checked by a scratch run of
the generators, not kept.

## What was read

- Issue #408 and the Oracle page's result above.
- `docs/technical-design.md`: Document check (1566: "It can never: Pass a claim on its own unless the document is the
  work"); Dogfooding and "Who drafts it" (2147).
- `docs/canvas-primitives.md`: What holds a document to its rules (8292: issues as data `{check, code, severity, ids,
  path, actual, t, what, fix}`, "A `fix` is patch ops only where …"); Check input (8297: film.layout among the core's
  kinds, which read only the core's arrays that canvas modules fill through `contributes_to` and name no module's
  kind); Film layout (8930: every field, the semantics, cost and "It can never"); Array and table (1153:
  `contributes_to`); Text `text@1` (1407) and its halo (1441: `halo: [{width: px = 2, role, …}]`, "on `text@1` and
  `mark.text`"); Rect `rect@1` (1515); Path `path@1` (1551); Paint (1682); Vector and formula `vector@1` (1840: parts,
  their boxes, match_morph pairing by part id); Scale and encode `axis@1` (2228: `{scale, side, grid: bool = false,
  title}`); Look `look@1` (2451: `ground: {kind: paper | …}`); Item and kind (323) and its relations (375: box points,
  the frame's edges, `at.fit`); Document envelope (292: `size`, `safe: f32, u = 24`, `markers`, `transitions`,
  `requires.modules`); Order keys (54); Marker (5303: kinds `cue`, `shot`, `hold`, `moment`; `t` and `span`); Channel
  and key (5342: hold keys, right-continuous jumps); Transition (5855: `match_morph {pairs, unpaired}`, two items in
  one shot); Shot (4540); Cue list `cues@1` (6029); Time and the flick (9).
- At the base: AGENTS.md; `crates/deep-show` (`deep-show run`, its scenario's `claims` with `requirements`, `planted`
  and the `Planted` enum in `src/hub.rs` named in `src/main.rs`, the `verdict` call in `src/verdict.rs`, `src/film.rs`,
  `src/query.rs`'s `items/<id>/bounds`, `src/kit/modules.rs`'s `test.kit.glyphs`, `Cargo.toml`'s `test-*` features);
  `crates/deep-canvas/src/registry` (`CORE_CHECK_KINDS`, `Check`), `src/schedule/core_ops.rs` (`core.glyphs`,
  `core.strokes`, `core.shapes`, `core.timeline`, registered and filled by nothing yet), `src/document/check.rs`
  (`requires.modules`, the envelope's keys); `crates/deep-canvas-test-modules`; `crates/deep-canvas-marks`
  (`data.rs`'s axis, `relations.rs`'s `own_box`); `scripts/{proof-change,benchmark,lanes}.mjs`; the earlier blind
  suites `tests/acceptance/403/` (claims, requirements and verdicts), `398/` and `494/` (vector@1 over the evidence
  store, match_morph), `1637/` (lean form, `INCONCLUSIVE:`, judgeLimit), `411/` and `1162/` (deep_query), `532/` and
  `238/` (Linux x86_64 in Docker). Code was read to learn the surface; every expected value comes from the issue and
  the design.

## Run them

They build `deep-show` with cargo, so they run one file at a time. The implementer adds this to `scripts/lanes.mjs`
(this README is the instruction; this job edits nothing outside the folder):

```js
// #408's files each build deep-show (module-label.test.ts with test-glyph-label); machines.test.ts also builds it in
// release and for Linux x86_64 in Docker, and times film.layout against the lane's rule.
alone.push('tests/acceptance/408/');
timed.push('tests/acceptance/408/machines.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm   # once, for criterion 5's Linux half
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/408 --no-file-parallelism
npx tsc -p tests/acceptance/408/tsconfig.json   # type-check
rm -rf tests/acceptance/408/node_modules/.vite
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full` (or `full,test-
glyph-label`) with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set, copies the binary out of `target/`
(honoring `CARGO_TARGET_DIR`) and fails each test whose build failed. Every test writes into temporary folders and
deletes them. Node built-ins and vitest only. `machines.test.ts` may also build `--release` (only on a machine that can
judge a timing) and, in `docker run --platform linux/amd64 rust:<rust-toolchain.toml's channel>-slim-bookworm` with
the checkout mounted read-only, `full` for Linux x86_64, its caches under `target/acceptance-408-linux/`; nothing is
pulled. A test that can't decide here fails with a message starting `INCONCLUSIVE:`, never passing.

## The surface under test

**No new binary and no new call.** #393's `deep-show run` (one scenario line in, one answer line out) with #403's
scenario `claims` and `requirements` and its `verdict` call, #96's patch through `deep show`, and #411's `deep_query`
with #1162's `items/<id>/bounds`. What the issue names and the base lacks is added as below; every name the issue and
design don't give is this job's choice, and an implementation builds exactly these or disputes them.

### The check, as a claim's requirement

Each film is a scenario document stored on the panel (`docs[<id>].document`, opened as revision 0, its items in one
layer of yours) and is the one deliverable of its own claim of alpha's, whose one requirement holds the check input
`{"kind": "film.layout"}`: every other field at the issue's defaults (`at: cues`, `overlap_min 0.05`, `touch 4`,
`covered_max 0.3`, `fill_opaque 0.5`, `backdrop_opaque 0.9`, `cut_min 2.7`). `{"call": "verdict", "claim"}` judges it.

### The verdict's row

The requirement's row in the verdict (#403's `{id, kind, result, blocked?, issues}`) is decided, never BLOCKED with
`not_run` as at the base: `FAIL` when film.layout raises an error, else `PASS`. Its `issues` hold film.layout's issues
in the design's shape, `{check: "film.layout", code, severity, ids, path, actual, t, ts, what, fix, …}`:

| Code | Its fields | Severity |
|---|---|---|
| `layout.cut` | `item`, `sides: [{edge, by}]` (one entry per frame edge the item's glyph box passes, `by` in u; edge names aren't read) | error |
| `layout.overlap` | `a`, `b`, `share` (of the smaller glyph box, 0..1) | error |
| `layout.crossing` | `text`, `stroke` | error |
| `layout.covered` | `text`, `by` (the covering item), `share` (of the text's 7 × 7 samples, 0..1) | error |
| a notice (`notes`: open paths, out of frame, camera framed; code not read) | the item in `ids` or a field | notice |

- A code's fields sit on the issue itself (as the base flattens `column.out_of_range`'s) or in its `actual` (as #417
  read `text.glyph_missing`'s); the tests read the issue first, then `actual`.
- A field naming an item holds its ID, or a sub-address `<id>#<part>` of it (a formula's part, an axis's line).
- `t`: the first cue end the issue is seen at; `ts`: every cue end it's seen at, ascending. One pair (or item) seen at
  many times is one issue. Times are integer flicks, as deep-show's other issue times, or the time grammar's `"<n>s"`;
  the tests read either.
- The fix: patch ops in `fix_ops` (the base's issue field for a fix that is ops), or in `fix` when it's a list; they
  apply as given as the `ops` of a `deep show` patch.
- Notices are listed in `issues` with `severity: "notice"` and never decide the result.
- `timing: {check_ms}`: film.layout's own wall time on the requirement, from the deliverables' evaluated arrays at its
  times to its issues, in ms (the scheduler's evaluation of the document at those times, which drawing shares, isn't
  in it), as the base's `deep show` reply reports `timing.check_ms`.

### The films (helpers.ts)

1920 × 1080 u `film` documents with `safe: 24`, so 1 u is 1 px at 1080p and the safe width is 1,872 u. Cue ends come
from `markers` of kind `cue` and `hold`, `{kind, name, t, span}`, each ending at `t + span` (Marker; Film layout: "the
end of every cue, hold and shot"). Motion is a `vec3` channel on `items/<id>/at/pos` whose keys hold (`interp: hold`,
right-continuous). `vector@1` items are #494's: `params {src, size, colors: {"#000000": "ink"}, alt}` over an SVG in
the evidence store (`<store>/<sha[0..2]>/<sha[2..]>`) whose one part `<path id>` fills its viewBox, so the part's glyph
box is the item's box exactly; films with one declare `requires.modules.vector`. `match_morph` is #494's transition
`{from, to, kind: "match_morph", at, span, progress: "linear", match_morph: {}}`. A text@1's halo is `params.halo`.
Items draw in their `order`.

### The test canvas module

A Cargo feature **`test-glyph-label`** on `deep-show`, joining the `full` set (never in a shipped build), adds the canvas
module **`test.label`**, which lives in `crates/deep-canvas-test-modules` beside #403's `test.checks`. It registers the
item kind **`test.label@1`**, params `box: [x, y, w, h]` (u, document space) and `text: string`, and one contribution
to the core's glyph-box array `core.glyphs`: each item's glyph box, `params.box`. It contributes no stroke or shape,
draws no fill, and names no check kind or code. A film using it declares `requires.modules: {"test.label": "^1"}`. No
Rust source outside that crate names the kind (criterion 4 reads this). #138's `test.kit.glyphs` isn't reused: it draws
its box as an ink fill, which would be the label's own opaque backdrop.

### The planted program (the scenario's `planted`, reachable only there)

Added to `Planted` in `crates/deep-show/src/hub.rs` and named in `src/main.rs`'s planted match:

| Name | The wrong program | Criterion |
|---|---|---|
| `layout_text_by_kind` | film.layout's text is the items of kind `text@1`, `vector@1`, `mark.text` and `counter`, not what contributes to the core's glyph-box array; everything else as shipped | `#408.022d8403` |

### Linux x86_64 and the timing

Criterion 5's Linux half runs the same scenario through `deep-show` built for linux/amd64 in Docker, its evidence store
mounted at `/evidence`. Its timing half reads `timing.check_ms` from release builds and judges five runs with
`scripts/benchmark.mjs`'s `judgeLimit`.

## Criteria to tests

IDs are `#408.` and the first 8 hex digits of SHA-256 of each criterion's text (`- [ ] ` dropped, trimmed, whitespace
collapsed), as `scripts/proof-change.mjs` computes them. Each test's name starts with its ID; each file's header states
its fixtures, numbers and wrong program in full.

| ID | File (tests) | What it asserts |
|---|---|---|
| `#408.6a23d77a` | `crossing.test.ts` (1) | Cue ends 1, 2, 2.5 (a hold's), 3.5, 4.5 s; the axis@1 `x-axis`, drawn under the text@1 `speed-label`, moves its line through the label's middle from 2.0 s to 3.75 s: FAIL, exactly one `layout.crossing`, an error, text `speed-label`, stroke `x-axis`, t = 2 s, ts = [2, 2.5, 3.5] s. The twin with `halo: [{width: 4, role: ground}]`: PASS. An axis with grid lines under the label, a grid line through its middle: PASS; the same axis drawn over the label: one `layout.crossing` naming both (the grid line reaches the label) |
| `#408.72c2e372` | `overlap-covered.test.ts` (1) | vector@1 formulas 200 × 100 and 300 × 100 u sharing 1,200 u² (6% of the smaller): FAIL, one `layout.overlap` naming both, share 0.06 ± 0.001; sharing 800 u² (4%): PASS. A match_morph's two copies in one place: PASS at cue ends before, inside and after its window; the same two without the morph: one `layout.overlap`, share 1. An opaque ink rect drawn after the text@1 `cap` over 21 of its 49 samples: FAIL, one `layout.covered`, text `cap`, by `veil`, share 0.41 ± 0.02; drawn first: PASS |
| `#408.78b2fa37` | `cut.test.ts` (1) | deep_query reads the title's bounds at 2 s as x −182 to 2102; FAIL, exactly one `layout.cut`, item `title`, two different edges each by 182 ± 0.05 u, t = 2 s, ts = [2, 3] s, a fix as patch ops; those ops apply as your patch, the requirement then PASSes, and the title's evaluated width at 2 s is the safe width, 1,866.6 to 1,872.05 u. A plot leaving the frame: PASS, a notice names it, nothing worse |
| `#408.022d8403` | `module-label.test.ts` (2) | In `full,test-glyph-label`, criterion 1's film with `probe-label` of `test.label@1` in place of the text: FAIL, exactly one `layout.crossing`, text `probe-label`, stroke `x-axis`, t = 2 s; no Rust source outside `crates/deep-canvas-test-modules` names `test.label`. Plant `layout_text_by_kind` fails the same check, naming `probe-label` |
| `#408.5416e245` | `machines.test.ts` (1) | Five films (criterion 1's crossing, criterion 2's 6% and covered, criterion 3's title and a film of 60 cue ends × 40 texts × 200 strokes of 64 segments) judged in one run on this Mac, each decided, and on Linux x86_64 in Docker: each row's result, `blocked` and issues equal. On a machine `judgeLimit` says can judge a timing now: a release build, one warm-up and five fresh processes, each FAILing the big film with all 60 cue ends in its issues' `ts`, their `timing.check_ms` judged against 50 ms. Without Docker or its image, off macOS, or on a machine that can't judge: `INCONCLUSIVE:` |

## Readings where the issue and design leave a choice

- **Cue ends** are the ends (`t + span`) of the film's `cue` and `hold` markers; no film here has shots or a brief's
  moments. Each criterion's times are cue ends: "from 2.0 s to 3.5 s" holds at the cue ends 2, 2.5 and 3.5 s and not
  at 1 or 4.5 s, and criterion 3's "both times" are its only cue ends in [2, 3] s, 2 and 3 s.
- **"Fails once"** is exactly one issue of that code in the row, listing every time in `ts`.
- **The axis is drawn under the label.** The halo twin needs it: a halo is a backdrop, and "lines drawn before that
  fill never cross the text". Only grid lines of axis@1 under a text are let off by the design, so the axis line
  under the label still crosses it, and the same grid line drawn over the label crosses it too, which is the control
  that the grid line reaches the label. A lone `side: bottom` axis's grid lines are read as rising from its line
  across the plot above it; the label sits 15 u above the line on its first tick (value 0, a tick at any step).
- **"A 4 px paper halo"** is `halo: [{width: 4, role: "ground"}]`: the shipped looks draw their paper in the `ground`
  role (Look: `ground: {kind: paper …}`; their palettes name `paper` and no look names a `paper` role).
- **An item's own parts aren't a pair.** An axis's ticks sit about 2 u from its own tick labels; a crossing pairs a
  text with another item's stroke. The axis's ticks and tick labels are placed clear of the label in every film.
- **Overlap's share** is the intersection's area over the smaller glyph box's; each formula is one part filling its
  box, so whether film.layout takes parts or whole formulas, the boxes are the same.
- **A match_morph's two copies** are one formula's two items at one place, the morph's window [2, 3] s and cue ends
  1, 2.5 and 4 s; "never fail" is the row PASSing with nothing raised, and the control without the morph shows they do
  overlap otherwise.
- **Covered's 0.41 ± 0.02.** A blind test can't know a text@1's glyph outlines, so the rect's edge sits 12 u left of
  the centred text's centre and it covers the text's whole height: the left 3 of 7 sample columns, 21 of 49 (0.4286,
  "over 40%" and inside 0.41 ± 0.02) whether samples sit at cell centres or on cell edges and for any glyph box 100 to
  600 u wide. "Opaque" is an ink fill at opacity 1. Drawn first, the rect covers only the text's left corners, so it's
  neither covering nor a backdrop.
- **The title** is a vector@1 whose one part fills its 2284 × 200 u box: the criterion gives no kind, and 182 u past
  each edge needs an exact glyph box, which a text@1's font outlines don't give a blind test. "Past both edges" is past
  the frame's left and right edges ("a title the frame cuts"). It is in the frame only at 2 and 3 s, and wholly above
  it at 1 and 4 s, which the design makes a notice.
- **"Scales it to the safe width"**: once the fix's ops are applied, the title's evaluated width at 2 s, read by
  deep_query's `items/title/bounds`, is the safe width, 1920 − 2 × 24 = 1,872 u, less at most `cut_min` (2.7 u) a side
  for a fix that keeps that margin. The ops are the implementer's (a scale about the centre, a fit, a size change);
  they must work with the title's position channel, which holds its x at −182.
- **"Applying the fix passes"**: the ops, applied as one patch of yours on revision 0 in a fresh run, apply, and the
  requirement then PASSes with nothing raised.
- **"A plot leaving the frame"** is an open path@1 crossing the right edge; "is a notice" is a notice naming it in the
  row and no error or warning naming it; "the check passes" is PASS.
- **"With film.layout unchanged"** is behaviour plus one guard: the label is caught through the array in a build
  that only adds the module, and no Rust source outside the test module's crate names its kind, so film.layout can't
  special-case it.
- **"Equal on macOS and Linux"** is shown by running both, not by a pinned digest or a recorded file: the result's exact
  bytes (its `what` text, field order, float shares) aren't fixed by the design, so no digest can be pinned blind, and a
  result recorded from another machine would be an agent's file, not a run (AGENTS.md: an agent's word is never
  evidence). The Linux half is linux/amd64 in Docker, as #238 and #532 run theirs. The rows must be decided on this Mac
  first, so two BLOCKED rows can't be equal by accident. Issues compare as sorted canonical JSON, whole.
- **"Under 50 ms on the reference Mac"** is judgeLimit's rule over five runs after a warm-up, each a fresh release
  process (so no cache of an earlier verdict counts), reading `timing.check_ms`. Each run must list all 60 cue ends in
  its issues' `ts`, so a check that skips times can't be fast. The big film's group moves every frame, so no two cue
  ends are equal by evaluated data and none is skipped as a repeat.

Not tested, because no criterion asks: `at: moments | [time]`, `backdrops` named in the input, `notes` turned on or
off, `camera_framed`, a 3D item, a brief tightening a threshold or an agent changing one, a cut on one side (the move
fix), the overlap, crossing and covered fixes' content, and `fill_opaque` or `backdrop_opaque` at their edges.
