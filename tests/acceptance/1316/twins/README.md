# #1316 wrong programs

Two twins, each kept as its wrong lines in its `lines.json` (#1832's line form), laid over the change by the proof
lanes' before run.

- `one-sample-geometry-pass` for `#1316.a4e5e495` (AC1): in `crates/deep-gpu-layer/src/session3.rs` `msaa_planted`,
  `single_sample: true || …`, so every scene3d render draws its geometry pass one sample a pixel. On main that pass
  still draws environment-lit SheenChair and DispersionTest differently in fresh processes (IDs identical, shading
  differs); a first-parent bisect of d5f0cd376..1b4929ae7 on Mac18,1 names 7caeca140 (#1173, the 4x MSAA geometry
  pass) as the first commit whose frames are identical. `ac1-identical.test.ts` fails on it at its `expect`.
- `plant-without-race` for `#1316.33db7d22` (AC2): `EnvironmentTextureRace` left out of `msaa_planted`, so
  `--planted environment_texture_race` is accepted but draws the 4x pass and does not race. `ac2-planted-race.test.ts`
  fails on it at its first `expect` (no sample's check returns a problem). The merge base already fails AC2 (the name
  is refused), so the before lane may not need this twin; it is the one wrong program that proves a plant which
  doesn't race fails AC2.
