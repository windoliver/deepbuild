# Acceptance test for #1479 criterion 5: the screenshots, the recording and the one taste call

A blind redraft for the criterion the first job left open (`../README.md`, Not tested: "the issue and design name no
surface for the check run's screenshots or recording … and where the record of the call goes"). Written from issue #1479,
the design and base commit `dd83ac2f` by a job that never saw an implementation; none existed. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The
first job's files are unchanged.

Criterion 5, `#1479.67deff55` (scripts/proof-change.mjs's ID, from the live issue body): "Shown to you: screenshots of a
title at 1×, 8× and 16× beside the Vello CPU snapshot, taken by the check run from the canvas at the reference window,
with a recording of the zoom, are attached to the PR and shown to you in the session. Whether they look right is one
taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge
it."

What was read:

- The issue, live (`gh issue view 1479 --repo windoliver/deepbuild`), and `../README.md` and `../helpers.ts`, whose
  surface, title and zoom steps this test reuses.
- `docs/technical-design.md`: Decided, "The reference window" (1512 × 982 points at 2×; "every replica screenshot uses
  it"); Dogfooding.
- At the base: `crates/deep-marks-render/src/lib.rs` (`view` takes `zoom` and `theme` only, zoom refused above 8; "the
  view's zoom is the window's scale factor"), and a probe of `deep-canvas-render render` and `raster` at the base
  (PNG of the document's size × zoom, 8-bit RGBA; 16× answers `bad_input`; GPUI's 8× frame of the title has no ink).
- The merged taste tests and their READMEs: `tests/acceptance/496/` (taste.test.ts, TASTE.json, README "The taste
  call", `docs/evidence/496/shoot.mjs`'s APNG), `tests/acceptance/492/taste.test.ts` and `tests/acceptance/443/taste.test.ts`
  (the check run that writes its own pictures and prints each SHA-256, then reads the call).

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1479 --no-file-parallelism taste
npx tsc -p tests/acceptance/1479/tsconfig.json   # type-check; the parent's tsconfig includes ./**/*.ts, so this folder too
```

`--root` is the parent folder, `tests/acceptance/1479`, and the filter `taste` picks this file alone; drop the filter to
run the whole suite. `cargo` must be on PATH. The file builds `deep-canvas-render` once (`../helpers.ts`'s `useRender`) and
fails when the build fails. A run may leave Vitest's cache in `tests/acceptance/1479/node_modules/.vite`; delete it. At the
base it took about 50 s on a loaded Mac. It runs only on macOS (GPUI's offscreen Metal renderer); elsewhere, and on an
answer of `unsupported_platform`, it fails `INCONCLUSIVE:`, never passing. `scripts/lanes.mjs` already needs
`tests/acceptance/1479/` in `alone` (`../README.md`); this file lives under it.

## The surface

The surface the rest of the suite drives, with nothing added for this criterion:

- **`deep-canvas-render render`**: GPUI's frame, the canvas's live path, at `view.zoom`.
- **`deep-canvas-render raster`**: Vello CPU's snapshot of the same document at the same zoom.
- **`view.zoom` up to 16** on both, which `../README.md` already asks for (the base refuses above 8).

The title is criterion 2's: `HIMN`, 40 u, the `body` face, white ink on a black ground (`../helpers.ts`'s `textDoc` and
`LOOK`). The zoom steps are criterion 2's: frame k of 120 at 16^(k/119), 1× to 16×.

## The check run

`taste.test.ts`, one test:

1. One `raster` line draws the title at its item's origin; the glyph outlines it answers give the title's ink box, used
   only to centre the title (framing, not a judgment).
2. **At the reference window.** The view has no window size or pan, and its zoom is the window's scale factor, so the
   window is the document: at zoom z the document is the reference window's extent in u, 3024/z × 1964/z, with the title
   at its centre, and each frame is the reference window's 3024 × 1964 device px (1512 × 982 points at 2×). Zooming keeps
   the title's centre at the window's centre.
3. `render` draws that window at 1×, 8× and 16× in one process, and `raster` the same three in another. The 120
   recording frames are drawn in order by one more `render` process. Any frame refused fails the test, naming the zoom
   and the answer, before anything is written.
4. It writes `docs/evidence/1479/`:

   | File | What |
   |---|---|
   | `title-1x.png`, `title-8x.png`, `title-16x.png` | GPUI's frame (left) beside Vello CPU's snapshot (right), a 32 px grey strip between: 6080 × 1964 px |
   | `zoom-1x-16x.apng` | GPUI's 120 frames of the zoom, 1× to 16×, 30 a second (4 s), looping: 3024 × 1964 px |

   The pixels are the renderers' own, copied, not altered: each PNG is decoded and re-encoded (8-bit RGBA, deflate
   level 9), and a frame off the window's size by the renderer's rounding (at most 1 px, `../helpers.ts`'s `readFrame`
   check) is padded with its own ground colour or cut to 3024 × 1964.
5. It prints each file's path and SHA-256.
6. It reads the call (below).

Every run rewrites the four files, so the call always meets this run's pictures. On the base build the same document
gave the same bytes on repeated runs, except one early probe whose `render` PNGs differed from every later run's (cause
not found); a renderer that doesn't repeat itself
leaves the call INCONCLUSIVE, never passing.

## The taste call

The owner's one call goes in `tests/acceptance/1479/TASTE.json` (beside the suite, as `496/TASTE.json`; this job doesn't
create it):

```json
{ "issue": 1479, "criterion": "#1479.67deff55", "verdict": "looks_right", "who": "…", "when": "2026-11-08T09:00:00Z",
  "screenshots": {
    "title-1x.png": "<sha256>", "title-8x.png": "<sha256>", "title-16x.png": "<sha256>", "zoom-1x-16x.apng": "<sha256>" },
  "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`; `who` is non-empty; `when` is an ISO 8601 time; `screenshots` names exactly
the four files with the SHA-256 the run printed; `note` is optional.

| State | Result |
|---|---|
| A frame refused, or the build fails | fails, naming it |
| No `TASTE.json` | fails `INCONCLUSIVE:`, listing the four files and their SHA-256 to show the owner |
| `TASTE.json` not JSON, or a field missing or wrong | fails, naming the field |
| A recorded SHA-256 differs from this run's (a call made on other pictures) | fails `INCONCLUSIVE:`, naming each file, recorded and drawn |
| `looks_wrong` on these pictures | fails, quoting who, when and the note |
| `looks_right` on exactly these pictures | passes |

No test judges a picture: this one copies pixels and hashes files; the other criteria's tests measure coverage and never
read these files or the call. Attaching the files to the PR and showing them in the session is the implementer's step,
outside the test.

These branches were exercised once on a scratch copy of this file capped at 8× (writing to a temporary folder, not part of
the suite) at the base: no call → INCONCLUSIVE; a `looks_right` call on the printed hashes → pass on a second run (the
bytes repeated); `looks_wrong` → fail; one hash changed → INCONCLUSIVE. The four files decoded as PNG and as a 120-frame
APNG with valid CRCs and sequence numbers.

## At the base

`BASE-FAILURE.txt`: the test fails on its own assertion, with 32 frames refused (`bad_input`): the 16× screenshot on both
sides and the recording from 8.141× on. Nothing is written. The base's other fault, no glyph past 256 device px (from
6.4× for this title), shows only in the pictures, which this test doesn't judge; criterion 2 measures it.

## Readings where the issue left a choice

- **"At the reference window"** is the design's reference window, 1512 × 982 points at 2×, taken as 3024 × 1964 device px
  with `view.zoom` as device px per u, as the rest of the suite reads "1× to 16×" (`../README.md`: device px = u × zoom).
  The window is made by sizing the document to the window's extent at each zoom, since the base's `view` has no window
  size or pan. A `view` with a window size and a centre would serve as well; then only `windowDoc` changes.
- **"A title"** is criterion 2's 40 u `HIMN`, centred, so the screenshots are the frames criterion 2 measures, at the
  window's size.
- **"Beside the Vello CPU snapshot"** is one PNG per zoom, GPUI's frame left and Vello CPU's right.
- **"A recording of the zoom"** is GPUI's frames only (the canvas's live path), criterion 2's 120 steps at 30 a second,
  as an animated PNG as #496 and #492 record. Not beside Vello CPU, to keep it about 4 MB.
- **"Attached to the PR"** is `docs/evidence/1479/`, as #492 and #496 keep theirs; the run writes them there.
- **"The reference Mac"** (the issue's "Runs on") isn't checked: the test runs on any Mac with Metal, like the rest of the
  suite, and records no machine. Whether the owner's call needs pictures from the reference Mac is the owner's to say.
