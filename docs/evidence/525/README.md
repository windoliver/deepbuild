# #525 evidence: the drop lab as a film with its sound

`drop-lab.mov` is the product's own export (`deep-show run`'s `export`, H.264 with float PCM, 640 × 360, 60 fps, 3 s) of
the blind suite's drop lab (`tests/acceptance/525/helpers.ts`: The lab) made into a film: a camera, a floor and a ball
item that the world `lab` moves through its output to `items/ball/at`, the bed on the left and a clack on each hit on
the right. `export.mjs` builds the document and runs the export (`node export.mjs <deep-show> <out dir>`); made on
Nov 13, 2026 on a Mac17,10 with a build of this branch from before its press support (8c10132cb), whose
export and mix paths that commit leaves as they were.

`first-hit.png` shows the first hit: the export's own lossless PNG frames 26 to 29 (a `png_seq` export of the same
document, cropped and zoomed 2×) above the right channel of the file, on one time axis.

## Readings

| Reading | Value |
|---|---|
| The file's sound against `media_mix` of the same document | bit-equal, 144,000 stereo float samples |
| Clack onsets in the file (right channel, first sample above −120 dBFS) | samples 22,000, 44,000 and 54,800: steps 55, 110 and 137, each × 400 |
| The ball's lowest frame in the picture (its pixels, frame by frame) | hit 1: frame 27, 2 px above rest, rising by 28 (clack at 27.5); hit 2: frame 55 at rest height (clack at 55.0); hit 3: frames 68 and 69, both 2 px up (clack at 68.5) |
| Export receipt | 180 frames; A/V offset 0 samples; fidelity PSNR-Y 55.7 dB (floor 40), SSIM 0.9997; `runtime_digest` b0d9637f… |
| The same document's sound played live on this Mac's speakers (`soak`, 4 s) | equal to `media_mix` over every sample rendered; no block rendered before its world stepped one block past it |

Faint light columns beside the moving ball in the H.264 file (at worst 241 of 255 beside a white background, and none
once the ball rests) are the encoder's: the lossless PNG frames have none.

Under heavy load (load 215–230, 57 GB of swap, thermal state fair), two of three 4 s live plays of this film each counted
one underrun (19 and 29 ms) and five 1 s plays counted none; the device test (`tests/acceptance/525-device/`) counts only on a
fit reference Mac, where its 10-minute run counted none.
