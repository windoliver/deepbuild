# Blind redraft of #428's disputed AC9 test

Written by the blind redraft of the acceptance-test job (technical design: Dogfooding, disputes), from issue #428, the
design (`docs/canvas-primitives.md`), the base commit `1d3ae632` and the original suite (`5c8089fc`, `../`). No
implementation was seen. `taste.test.ts` here replaces `../taste.test.ts`; every other file of the original suite
stands, and `../helpers.ts` and `../reference.ts` are imported unchanged. The original file is not edited; whoever
settles the dispute swaps it in. Until then, run one of the two, never both: they write the same files.

## The dispute, checked against the design

The original drew the four Khronos samples in `SHOW_LOOK` (filmic, `exposure` EV100 0) under `sun(30_000, …)` and
`SHOW_SKY` (environment from the sky, intensity 1). **It holds.** Light is lux for the sun and EV100 for exposure
(canvas-primitives.md line 33; Look `look@1`, `exposure: EV100`, line 2430), and EV100 belongs to the lens model
EV100 = log₂(N² ÷ t) − log₂(ISO ÷ 100) (Camera `camera@1`: lens, line 4426), under which the look scales linear light
by 1 ÷ (1.2 × 2^EV100) (the reading #378's suite and `../helpers.ts` `PLAIN_LOOK` already take). At EV100 0 a white
diffuse surface facing a 30,000 lx sun reads about 30,000 ÷ π × 0.83 ≈ 8,000 before the tone map, and an 18% one
about 1,400: 13 stops over middle gray. The ACES fit (clamped to 1) reaches 1 below a linear 9, so every lit surface draws white on any
correct renderer, and the one taste call can't be made on what is shown.

## What changed

Only the sun's illuminance in the four sample screenshots. The look, the sky, the camera, the sun's direction, the
files written to `docs/evidence/428/` and their names, the SHA-256 printing, the `TASTE.json` reading and the verdicts
are the original's, line for line.

The sun is metered for the look's exposure, as the design meters: "exposure fixes come from the light falling on the
subject, as an incident meter reads it" (render.exposure Semantics, line 8282), keying the subject's mean log
luminance to middle gray within ±0.5 EV (`key_ev: [−0.5, 0.5]`, line 8273).

- An 18% Lambertian surface lit by E lux has luminance 0.18 × E ÷ π; after the look's 1 ÷ (1.2 × 2^EV100) it reads
  middle gray 0.18 when E = 1.2π × 2^EV100: **3.77 lx at EV100 0**.
- `SHOW_SKY` lights by its environment at intensity 1 (Sky `sky@1`: environment, line 4261ff.), its radiance lying
  between its `top` and `low` colors, linear BT.709 (line 33) of luminance 0.397 and 0.798, so on any surface it adds
  between π × 0.397 = 1.25 lx and π × 0.798 = 2.51 lx, whatever the gradient's shape.
- The sun takes the rest of the key at the middle of that range: 3.77 − 1.88 = **1.89 lx**, computed in the test from
  `SHOW_LOOK` and `SHOW_SKY`. A surface facing the sun then keys at −0.26 EV to +0.22 EV across the sky's whole range,
  inside ±0.5 EV, so lit surfaces sit near middle gray, white ones well under the filmic shoulder, and the sky still
  fills the shade as the criterion's "daylight sky that lights by its environment and a sun" asks.

The other way out, an exposure suited to 30,000 lx (EV100 log₂(30,000 ÷ 1.2π) ≈ 13), would leave `SHOW_SKY`'s
radiance under 0.0001 after exposure: a black background and no visible environment light. `sky@1`'s own `exposure`
(line 4227, "from the look unless set") is left unset, so the sky draws at the look's EV100 0, where its colors show.

The flake panel and its dolly don't share the defect and are unchanged: `PLAIN_LOOK` (scale 1) under `sun(π, …)` and
`DARK_SKY` puts an 18% surface facing the sun at exactly 0.18, middle gray.

## Run it

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/428 redraft/taste.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/428/tsconfig.json
```

It needs Metal and, once, the network, as the original does (`../README.md`: Run them). Not run here: the job has no
implementation and runs no GPU test; only the typecheck was run.
