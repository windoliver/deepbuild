# #1938 evidence: each loop fixture drawn and judged

`sheet.png` shows each of the nine fixtures the blind suites judge (`tests/acceptance/1938/helpers.ts`, and the
contrast redraft's board). For each one it holds the planted fault, its clean twin, and the planted document after the
fix its check names is sent back as the working agent's patch. Every picture is deep-show's own render-back snapshot.
Every verdict, printed beside its picture and outside the frame, is deep-show's own `verdict` on the document as the
suite stores it.

`noise.mp4` is the reseeding fill drawn frame by frame at 60 fps, looped five times, in three panels: the planted fill,
whose channel gives its seed a new value each frame; the twin, seeded once; and the planted document after its fix.

| Fixture | Planted | Twin | Fix, sent back as a patch | After |
|---|---|---|---|---|
| a subject cut by the frame | FAIL `loop.framing` | PASS | camera `position` pulled back 2.49 m | PASS, fill 0.33 |
| clipped highlights | FAIL `loop.exposure` (all clipped, key +4.53 EV) | PASS | camera `exposure` EV100 4.26, from the subject's own light | PASS, key 0.00 EV |
| text under 4.5:1 | FAIL `loop.contrast` (3.24:1) | PASS (16.86:1) | caption fill → `ink` | PASS |
| two items passing into each other | FAIL `geometry.overlap` (0.2 m) | PASS | crate-b moved out 0.2 m along x | PASS |
| an item floating 0.2 m above the floor | FAIL `geometry.floating` | PASS | vase lowered 0.2 m | PASS |
| a 20 m door | FAIL `loop.scale` (20 m) | PASS (2.1 m) | height → 2.4 m | PASS |
| a missing texture | FAIL `asset_missing` | PASS | the map slot unset | PASS |
| a fill that reseeds each frame | FAIL `loop.noise` (variance 3.2e-2) | PASS (0) | a still copy in its place, the original hidden | PASS (0) |
| a scene over its class | FAIL `over_budget` (CPU 65 ms, GPU 6.2 ms) | PASS | the 1,503 smallest specks removed | PASS (CPU 3.98 ms, GPU 0.38 ms) |

Some fixtures name no paint and no light, and some audit scenes name a camera they don't hold. For those,
render-back draws a copy with the accent role, a sun at π lx and the suite's camera, so the picture shows something;
the sheet names what each copy adds. Their verdicts are on the documents exactly as the suite stores them.

## What drawing found

- **The missing-texture fix didn't cure.** After the map slot was unset, the document's licence record still named the
  missing hash, so `missing: 0` failed again. The check now counts as missing only what the document draws from: a
  hash an item names, or a record an item or the look names. Every record is still held to `licenses: present`.
- **render-back draws no texture maps (not fixed here).** deep-gpu's view decodes maps through its decode worker;
  deep-show's render-back doesn't, so all three crates draw white, the twin included. The check reads the evidence
  store, not pixels, so its verdicts stand.

## Make it again

- `node render.mjs <deep-show> <out dir>` judges and draws each pair, applies each fix, and writes the PNGs and `verdicts.json`.
- `node sheet.mjs <out dir> <out.png>` lays out the sheet with headless Chrome.
- `node film.mjs <out dir> <out.mp4>` makes the film with ffmpeg.
