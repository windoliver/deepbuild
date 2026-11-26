# #1316 wrong programs

Two twins, laid over the change by the proof lanes' before run.

- `one-sample-geometry-pass` for `#1316.a4e5e495` (AC1): the change's `crates/deep-gpu-layer/src/session3.rs` with
  one change, in `msaa_planted`: `single_sample: true || …`, so every scene3d render draws its geometry pass one sample
  a pixel, as main did before #1173 (7caeca140). That is where the race lives: a first-parent bisect of
  d5f0cd376..1b4929ae7 on Mac18,1 names 7caeca140 as the first commit whose environment-lit SheenChair frames are
  identical across fresh processes. `ac1-identical.test.ts` fails on it at its `expect`, naming the run and pixels.
- `plant-without-race` for `#1316.33db7d22` (AC2): the change's `session3.rs` without `EnvironmentTextureRace` in
  `msaa_planted`, so `--planted environment_texture_race` is accepted but draws the fixed path and does not race.
  `ac2-planted-race.test.ts` fails on it at its first `expect` (no sample's check returns a problem).
