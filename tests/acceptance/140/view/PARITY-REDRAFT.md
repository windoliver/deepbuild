# C6 blind redraft: the planted one-code shift in one GPU-layer pixel

Test: `parity-planted-redraft.test.ts`, one `describe` with one `it`, the first draft's planted test under its ID
(`#140.e2e712fe`), both names ending "(redraft)". The criterion (6): "…a planted one-code shift in one GPU-layer pixel
fails (parity/gpu/live-headless.scene)". README: the C6 row ("`--planted shifts_gpu_pixel`: the same comparison fails
with exactly one GPU-layer pixel named, one channel one code apart") and Readings ("The planted one-code shift").

Written from the issue's criterion 6, this folder's `README.md`, `helpers.ts` and `parity.test.ts` at 987b1ecb, and
base f41a5b3e. I never read an implementation.

## What was disputed

`parity.test.ts:166`:

```ts
const m = /is \[(\d+),(\d+),(\d+),(\d+)\] live and \[(\d+),(\d+),(\d+),(\d+)\] headless/.exec(pixel[0]!.replace(/ /g, ''));
```

The failure is stripped of every space, then matched against a pattern with literal spaces (`is `, ` live and `,
` headless`). The match is `null` for every input, so the test fails on every program, the planted one included. The
implementer reports the failure the comparison wrote for the planted program:
`scene3d-glow-shadows: GPU layer pixel (240, 180) is [98,93,85,255] live and [97,93,85,255] headless`.

## What changed

Only that line. The redraft matches the failure as written, with spaces allowed inside the two bracketed values (what
the space-stripping was presumably for; `JSON.stringify` writes none). The pattern now also captures the pixel's
coordinates, so a match requires the pixel named with its coordinates and both values; the channel indices move from
1–4/5–8 to 3–6/7–10 accordingly.

Unchanged: the reference-Mac gate (INCONCLUSIVE elsewhere), the planted run (`--planted shifts_gpu_pixel` on the case
with a GPU layer, then the headless snapshot), exactly one GPU-layer pixel failure among the comparison's problems,
and the summed per-channel difference of exactly 1 (one channel, one code). The cases, `liveFrame`, `snapshot` and
`parityProblems` are `parity.test.ts` lines 15–136 copied byte for byte (checked with `cmp`): the file exports nothing,
and importing it would run its tests in this file.

## Wrong programs it still fails

- A clean twin whose GPU-layer pixels agree: no GPU-layer pixel failure (count 0, not 1).
- A shift of two codes, or of one code in two channels: summed difference 2.
- A GPU layer of the wrong size: `firstDifference` gives `(-1, -1)`, which isn't counted as a named pixel.
- The base: no `deep-gpu` binary (fails at "the binary builds"). Not run: building at the base was out of scope.

## Checks

`npx tsc -p tests/acceptance/140/view/tsconfig.json`: exit 0, no output.

The surface doesn't exist at the base, so the logic was checked in isolation: a node script read `PIXEL` from this
file, built failures as `parityProblems` writes them, and applied the test's filter and assertions ("PASS" = the
planted test passes):

```
planted, as reported: PASS: (240, 180), diffs [1,0,0,0]
clean twin (GPU layers agree): FAIL: 0 pixels named
clean twin with unrelated 2D problems: FAIL: 0 pixels named
size mismatch only: FAIL: 0 pixels named
two codes off in one channel: FAIL: diffs [2,0,0,0]
one code off in two channels: FAIL: diffs [1,1,0,0]
spaces inside the brackets: PASS: (240, 180), diffs [1,0,0,0]
first draft's match on the reported failure: null
```

## At merge

`parity.test.ts` stays as written. The owner's call at merge: its planted test (`the planted one-code shift in one
GPU-layer pixel (--planted shifts_gpu_pixel) fails, naming the pixel`) is swapped for this redraft; its three case
tests and its settling test stand unchanged.
