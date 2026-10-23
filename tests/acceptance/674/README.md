# Acceptance tests for #674: image sampling

Written first, from issue #674 ("Image sampling: nearest and cubic drawn as written on GPUI, Vello CPU and
render-back, so scaled pixel art stays hard-edged": its scope, its Fields, its five acceptance criteria and its
proof line) and the design it names: `docs/canvas-primitives.md` (Image `image@1`, whose Fields hold
`sampling: linear | nearest | cubic = linear` and whose Cost holds "at most 64 MB decoded per document"; Conventions
every primitive uses; Item and kind; Render-back) and `docs/technical-design.md` (the canvas core, 2D marks, GPUI).
Base commit `a5aa0a3`. The job never saw an implementation of #674 and wrote nothing outside this folder; the base
binaries these tests were first run on were built from `git archive` of that commit, not from the working tree (see
"Base"). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job.

Run them (they build two cargo binaries, so they run with `--no-file-parallelism`, as #373's do):

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/674 --no-file-parallelism
```

Every file first runs `cargo build --locked --bin deep-canvas-render` (and `--bin deep-show` for the files that draw
render-back), cached after the first file, and fails each of its tests when a build fails. Tests write PNGs under the
OS temp folder and delete them, use only node built-ins, vitest and `packages/evidence`'s public entry (as #393's do),
and type-check under the root `tsconfig.json`'s strict options (`npx tsc -p tests/acceptance/674/tsconfig.json` exits
0). A run with `--root tests/acceptance/674` leaves Vitest's cache in `tests/acceptance/674/node_modules/.vite`;
delete it, it is not part of the suite. `BASE-FAILURE.txt` is the run at the base.

The GPUI tests draw with GPUI's offscreen Metal renderer: off macOS, and whenever `deep-canvas-render` answers
`unsupported_platform`, they fail with a message that starts `INCONCLUSIVE:`; they never pass there. The Vello CPU,
render-back and check tests run on every platform.

## The surface under test

Everything is a surface #373, #391, #392 and #393 already built; two spellings are new (below).

- `deep-canvas-render raster`: Vello CPU's 2D raster, `{out, doc, look, view?: {zoom}, store}`, one PNG of the
  document's size times `zoom`; `check` with a look; `render`: GPUI's offscreen Metal renderer, the same request, one
  PNG read back from the window at scale `zoom`; `session`: GPUI over steps of whole revisions. `store` is a folder
  whose files are named by their sha256, the images' source (a document never names a path).
- `deep-show run`, #393's: a `deep_show` call with `include: ["pixels"]` and a `size` is render-back, and its
  snapshot, a PNG in the evidence store, is read back by its hash. The image's asset is put into that store first.

Documents are built in code (`scene.ts`), not in fixture files, because every value a test reads sits next to the
geometry that makes it. The asset is a 4 × 4 PNG written by the test: texel (column i, row j) is pure white when
i + j is even, pure black otherwise. In the document, a 24 × 24 u figure, the image is an `image@1` with `fit: fill`
into the box `[4, 4, 16, 16]`, so a texel is 4 u (4 device px at zoom 1, 8 at zoom 2) and every texel and the
box's own edges fall on whole device pixels at both zooms. The ground is the blue (60, 120, 200), a color no texel and
no grey can be mistaken for, so a pixel outside the box that isn't exactly the ground is named just as one inside it.

### Field spellings the tests assume (the issue and the design give the names, not the surfaces)

| Field | Where the tests put it | Source |
|---|---|---|
| `sampling` | `items/<id>/params/sampling`, a string: `"linear"`, `"nearest"` or `"cubic"`, or absent | Image `image@1`: Fields |
| the refusal's name | a `check` issue whose `path` is `items/<id>/params/sampling` (any code), and, from `raster` and `render`, an answer `{"ok": false, …}` whose JSON text holds that path | the issue's "naming `items/<id>/params/sampling`"; `check` issues carry `path` (#373's tests), `bad_doc` with the field's path is how a bad `fit` is refused today |
| the new content key | `session` step `caches.images`: a list of `{item, key, len, sha256}`, one entry for each image item the step's last frame drew, with `key` that image's content key as 32 lower-case hex digits (as `caches.text`'s and `caches.layers`' entries read), whichever sampler it has | the issue: "puts the sampling in the image's content key"; #391's `session` `caches` (Entry) |
| the resample count | `session` step `resamples`: a non-negative integer, the number of resampled copies the step's frames built on the CPU (a copy served from the cache is not counted) | the issue's Proof: "the session's resample count" |
| the cap's refusal | an answer from `render` `{"ok": false, …}` whose JSON text holds the image's asset hash (64 hex digits) | the issue: "refused, naming its asset"; `asset_missing` and `asset_mismatch` already put the hash in their `path` |

Nothing else is assumed: no error code is asserted (the codes of #674's refusals are the implementer's), no field of
the answer other than those above is read, and no new binary or subcommand is needed.

## Criteria to tests

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A 4 × 4 checker of single black and white texels, drawn with `sampling: nearest` and fit fill into a 16 × 16 box, reads exactly 0 or 255 at every device pixel, the color of the texel it falls in, through GPUI at zoom 1 and zoom 2, through Vello CPU raster and through render-back; a renderer that ignores the field draws grey at texel borders and fails, naming the first pixel | `nearest.test.ts`: every device pixel of the PNG, read back, equals the texel its center falls in (the box) or the ground (outside it), exactly, through GPUI at zoom 1 and 2, Vello CPU at zoom 1 and 2 (the criterion names Vello without a zoom), and render-back's snapshot at 1:1. The failure message names the first pixel in row-major order with its reading and the texel's color. A renderer that ignores the field reads grey at the first texel border: GPUI's linear sprite at (4, 4), Vello CPU's at (6, 4) |
| AC2 | The same checker with `sampling: cubic` drawn through GPUI and through Vello CPU raster agrees within 2 levels per channel at every pixel | `cubic.test.ts`: the two draws differ by at most 2 levels in R, G and B at every pixel, the first beyond it named; and each path's cubic draw is not its own linear draw (more than 8 levels apart somewhere: Vello CPU's bicubic draw of this checker is 15 levels from its bilinear one at the largest), because two paths that both ignore the field would agree. A GPUI path that ignores the field, or one that resamples with another kernel than Vello's, fails one of the two |
| AC3 | An image without `sampling` draws byte for byte as it does on the base commit, on every path | `default.test.ts`: two documents with no `sampling` field (the checker, and a 5 × 3 sprite with an alpha column, `crop`, `opacity` 0.6, `fit: contain` and a box at fractions of a unit, so a program that placed every image on whole device pixels fails) on GPUI and Vello CPU at zoom 1 and 2 and on render-back, each equal to the PNG the unmodified base commit drew (`fixtures/base/*.png`, made by `fixtures/make-base.ts`), the first differing pixel named. A second test writes the default out, `sampling: linear`, and expects the same bytes (a `linear` mapped to another sampler fails) |
| AC4 | A `sampling` value other than the three is refused, naming `items/<id>/params/sampling` | `document.test.ts`: `check` refuses `"bilinear"`, `"bicubic"` (Vello's names for its samplers), `"Nearest"`, `"lanczos"`, `""`, `3` and `["nearest"]` with an error whose path is `items/checker/params/sampling`, and passes the three values and no field with no error (a check that refuses every `sampling`, or none, fails); `raster` and `render` refuse each of them naming the field |
| AC4 | a document whose only change is its sampling gets a new content key for that image | `document.test.ts`: one GPUI session of five revisions, no field, `nearest`, `cubic`, `linear`, `nearest`, differing in nothing else: `caches.images` holds the image's key each time; nearest and cubic each differ from no field and from each other; `linear` equals no field (the default); the second `nearest` equals the first (a key that leaves out the sampling, or one that is never the same twice, fails) |
| AC5 | A nearest image moved by whole device pixels over 10 frames on the GPUI path resamples once | `session.test.ts`: ten steps of one frame each, the image moved 1 device px further each frame (at zoom 1 and at zoom 2), reports `resamples` `[1, 0, 0, 0, 0, 0, 0, 0, 0, 0]` (a copy cached by the image's position, or never cached, reports 10) |
| AC5 (scope) | the resampled copy is cached by asset, crop, opacity and drawn size, so moving the image reuses it | `session.test.ts`: moving the image reuses its copy; a new opacity and a new drawn size each build another (`[1, 0, 1, 0, 1, 0, 0]`), and a `linear` image or one with no field builds none at any size (a cache that ignores opacity or size, or a program that resamples every image, fails) |
| AC5 | one whose resampled copy would pass the 64 MB cap is refused, naming its asset | `session.test.ts`: a nearest image drawn 5000 × 4000 device px (80 MB resampled) is refused by `render`, the answer naming the asset's hash; 3000 × 3000 px (36 MB) is drawn; 2600 × 2600 u at zoom 2 (5200 × 5200 px, 108 MB) is refused (a cap that counts the source's 4 × 4 px, or u instead of device pixels, or that never refuses, fails) |
| scope | on the GPUI path a nearest or cubic image is "placed on whole device pixels" and drawn 1:1 | `nearest.test.ts`: the checker offset by 0.2 u (0.2 device px at zoom 1, 0.4 at zoom 2 on top of 4 u: 4.2 and 8.4 device px, which round and floor to the same whole pixel) reads exactly what the checker at 4 u reads, every pixel, at both zooms: no blended edge pixel |

## Readings where the issue and design leave a choice

- **Which texel a pixel reads.** A device pixel's center is the sample point; nearest takes the texel containing it,
  and no pixel center sits on a texel border at either zoom, so the expected color is unambiguous.
- **Zoom for Vello and for render-back.** The criterion names zoom 1 and 2 for GPUI only. Vello CPU is also read at
  zoom 2 (its `view.zoom` is a pixel scale) and render-back at 1:1, since a snapshot's `size` isn't a zoom.
- **The 2-level cubic comparison is at zoom 1,** the one zoom the criterion names. The cubic kernel is not fixed by the
  issue (Vello's bicubic); GPUI's CPU resample must agree with it, which is the criterion.
- **The cap.** "64 MB" is read as between 64,000,000 and 67,108,864 bytes (a megabyte, or a mebibyte, of decoded
  RGBA), so the tests use sizes clear of both: 36 MB drawn, 80 MB and 108 MB refused. A drawn size is in device
  pixels (the scope's "drawn size in device pixels"), 4 bytes a pixel. Whether the sum over a whole document is what
  the cap counts (the design's "per document, resampled copies included") is not tested beyond one image.
- **Where the cap's refusal comes from.** The criterion is on the GPUI path. The tests ask `render` and read only
  that the answer is a refusal naming the asset; they don't ask Vello CPU or `check`, which draw no copy.
- **`caches.images` and the content key.** The issue puts the sampling "in the image's content key" and the proof
  names no surface that shows a key; the session's cache listing is the only place #391 shows content keys, so the
  list gains one entry per image. A key's value is never compared with a number, only with other keys.
- **Equal bytes at the base.** Goldens are the base commit's output on this Mac's Metal GPU; GPUI's linear sprite is
  not guaranteed byte-equal across GPUs, so on another machine regenerate `fixtures/base` from a base checkout
  with `fixtures/make-base.ts` (its header gives the command) before reading AC3 there. That is not an edit to a
  test: the goldens are data made from the base commit, never from the change.

Not tested, because no criterion asks: `fit` and `crop` combined with nearest or cubic, a resample's pixels for a
nearest image drawn smaller than its source, `sampling` on video frames or atlas cells, the per-document sum of the
cap, and a `cubic` copy's cache and cap (the cap's tests use nearest, as the criterion does).

## Base

`BASE-FAILURE.txt` is the suite at the base commit. It was run in a copy of the tree made with `git archive a5aa0a3`
(plus these files), because another session was editing the shared working tree while the suite was written; the
binaries were built there, so the base never held a line of #674's change.

At the base 16 of 23 tests fail, each at a named assertion for the criterion's own reason (the first wrong device
pixel: GPUI (4, 4) and (8, 8) at zoom 1 and 2, Vello CPU (6, 4) and (12, 8), render-back (6, 4); Vello's cubic draw
equal to its linear one; `bilinear` not refused by `check` or `raster`; `steps[0].caches.images` and
`steps[0].resamples` missing; the 80 MB and 108 MB images drawn, not refused). The 7 that pass are the ones that
promise no change: the six of `default.test.ts` (AC3) and the 36 MB control of the cap.
