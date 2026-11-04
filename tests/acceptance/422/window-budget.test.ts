// AC2 #422.7daccf6e: A window-sized frame with sky, fog, clouds and bloom stays within the GPU budget.
//
// The reading (README: Readings): "window-sized" is 1936 × 1584 at internal scale 1 (the figure class's render scale
// while moving); "the GPU budget" is the figure class's (canvas primitives: The cost model; technical design: a
// window-sized figure under 2 ms of GPU, under 256 MB of GPU memory per window); "stays within" is every frame: each
// run's worst `gpu_ms` over 300 frames at 60 fps of an orbiting camera, judged by the five-run rule (`judge`: five
// runs after a warm-up, PASS when all five are within 2 ms, FAIL when all five are over it by more than the margin,
// else INCONCLUSIVE), and every frame's `gpu_bytes` within 256 MB. Off a reference Mac the budget is INCONCLUSIVE.
//
// The fixture, `budget.class: "figure"`: a 600 m ground plate (base color 0.4, roughness 0.9), one emissive lamp (a
// ball of radius 0.5 m at the orbit's target), 32 `puff@1` clouds (radius 5 m, density 1) in a ring of 40 m around
// the target at heights 8, 9.5 and 11 m, a key sun, and a `sky@1` with a blue gradient, a gray ambient gradient,
// distance fog and height fog. The camera orbits [0, 2, 0] at 18 m and 5° of elevation (so 3.57 m up), fov 45° across
// the width, at 20°/s. Before the budget counts, the first test shows that each of the four features draws: frame 0
// changes, on at least 0.5% of its pixels by more than 2 codes, when that feature alone is taken away (the sky: its
// gradient and its ambient black, fog kept; the fog: both densities 0; the clouds: no puffs; the bloom: the same look
// with `bloom: none`), and the frame is exposed: under 5% of its pixels black and under 5% white.
//
// Light and exposure (Units and axes: the sun in lux, exposure in EV100; Look `look@1`: tone mapping and bloom). The
// sun's illuminance is π lx at 45° of elevation, so a white Lambertian surface square to it has linear radiance
// E ÷ π = 1, and the ground (0.4) reads 0.4 × π × cos 45° ÷ π + 0.4 × ambient_top 0.2 ≈ 0.36. The look's exposure is
// EV100 = −log2(1.2), the scale 1 ÷ (1.2 × 2^EV100) = 1, so the exposed value is the radiance itself, and the tone map
// is the base's filmic (ACES fit) before the sRGB encode. Through it: the ground ≈ 189 codes; the sky's top
// [0.15, 0.3, 0.75] reads [128, 177, 223], its low [0.45, 0.6, 0.85] [201, 214, 227]; the fog 0.55 gray 210. Nothing
// but the lamp nears black or white. The lamp's emission is [1, 0.8, 0.55] × 40, radiance up to 40, 40 times the
// white Lambertian's 1 and far above where the filmic curve saturates (about 10), so it alone is bright enough to
// bloom: the shipped glow conserves energy with no threshold, so only light above the frame's exposure visibly spreads.
//
// Why each feature changes at least 0.5% of the frame (computed from these numbers by the design's own formulas):
// - The sky: above the horizon (about 4.3° above the view's centre, the plate's edge 300 m out) the background is
//   about 39% of the frame; black there instead of 128 to 227 codes. Its ambient also lights the ground by 0.08 of
//   0.36, which alone moves about 57% of the frame by more than 2 codes through the fog.
// - The fog: the distance fog alone, `fog_density` 0.012/m with `fog_curve: exp2`, T = exp(−(0.012 d)²), mixes the
//   ground toward 0.55 by (1 − T) × 0.19; with the camera's rays, the ground beyond about 12 m (about 18% of the frame)
//   moves by more than 2 codes. The height fog (top 1.5 m, density 0.04/m) is added to it in the same color, which
//   can only move a pixel further toward the fog.
// - The clouds: the sun is white and the puffs' ambient (the sky's `ambient_top` and `ambient_low`) is gray, and fog
//   is gray, so a puff's light is gray; the sky behind is blue, its blue channel at least 0.4 above its red. A gray
//   puff at opacity 0.5 then moves some channel by at least 6 codes over any part of that gradient (0.25: 3 codes).
//   The design names no puff's opacity profile; this test takes a puff of density 1 to be at least half opaque within
//   a quarter of its radius. Those cores, all above the horizon, cover at least 1.31% of the frame at every azimuth
//   of the orbit (the 32 puffs projected through the pinhole).
// - The bloom: the shipped glow (look@1: bloom; the base's glow.rs and shipped.rs) at 1936 × 1584 keeps six levels
//   (radius 0.85 of six, rounded up) and mixes scene × (1 − 0.3) + (the chain's sum ÷ 6) × 0.3. Run on the CPU with
//   the 13-tap downsample (the first a Karis average) and the 3 × 3 tent, the lamp (65 px in radius at 18 m) on a
//   uniform 0.36 or 0.55 changes 4.9% or 4.0% of the frame by more than 2 codes, out to about 220 px from its centre;
//   at half the lamp's strength still 3.1%, so fog over the lamp (T ≈ 0.95 at 18 m) leaves the margin.
//
// Wrong programs it catches: the base (no fog, no puffs, no sky gradient); a feature that draws nothing or draws too
// little to see; a frame over 2 ms of GPU or over 256 MB of GPU memory.
import { describe, expect, it } from 'vitest';
import {
  AC, GPU_BYTES, RUNS, WINDOW_GPU_MS, ball, box, changedShare, frameAt, framesOf, judge, look, material, orbiting, readPng,
  requireMetal, requireReferenceMac, runGpu, sessionDoc, sun, useDir, useGpu, view3dCall, writeJson,
  type Image, type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const WINDOW: [number, number] = [1936, 1584];
const FRAMES = 300;
const FPS = 60;
/** The exposure whose scale 1 ÷ (1.2 × 2^EV100) is 1: exposed values are the radiances themselves. */
const EV100 = -Math.log2(1.2);
const WITH_BLOOM = look({ tone_map: 'filmic', exposure: EV100, bloom: { intensity: 0.3, radius: 0.85 } });
const WITHOUT_BLOOM = look({ tone_map: 'filmic', exposure: EV100 });
const PUFFS = 32;

type Taken = 'none' | 'sky' | 'fog' | 'clouds';
function fixture(taken: Taken): JsonObject {
  const { cam, channels } = orbiting([0, 2, 0], 18, 5, 20, 10);
  const items: Record<string, JsonObject> = {
    cam,
    sky: {
      kind: 'sky@1', params: {
        top: taken === 'sky' ? [0, 0, 0, 1] : [0.15, 0.3, 0.75, 1],
        low: taken === 'sky' ? [0, 0, 0, 1] : [0.45, 0.6, 0.85, 1],
        ambient_top: taken === 'sky' ? [0, 0, 0] : [0.2, 0.2, 0.2],
        ambient_low: taken === 'sky' ? [0, 0, 0] : [0.08, 0.08, 0.08],
        fog: [0.55, 0.55, 0.55, 1], fog_density: taken === 'fog' ? 0 : 0.012, fog_curve: 'exp2',
        fog_height: { top: 1.5, density: taken === 'fog' ? 0 : 0.04 },
      },
    },
    ground_mat: material({ base_color: [0.4, 0.4, 0.4, 1], roughness: 0.9 }),
    lamp_mat: material({ base_color: [0, 0, 0, 1], emission: [1, 0.8, 0.55, 1], emission_strength: 40 }),
    ground: box([600, 1, 600], { pos: [0, -0.5, 0] }, { material: 'ground_mat' }),
    lamp: ball(0.5, [0, 2, 0], 'lamp_mat'),
    sun: sun(Math.PI, [-45, 0, 0]),
  };
  if (taken !== 'clouds') {
    for (let i = 0; i < PUFFS; i++) {
      const a = (i * 2 * Math.PI) / PUFFS;
      items[`puff${i}`] = { kind: 'puff@1', at: { pos: [40 * Math.sin(a), [8, 9.5, 11][i % 3]!, 40 * Math.cos(a)] }, params: { radius: 5, aspect: 1.6, density: 1, bright: 1, seed: i } };
    }
  }
  return sessionDoc(`window-${taken}`, WINDOW, items, { channels, budget: { class: 'figure' } });
}

/** The share of pixels whose every channel is at most `hi` and at least `lo`. */
function shareWithin(image: Image, lo: number, hi: number): number {
  let n = 0;
  for (let i = 0; i < image.rgba.length; i += 4) {
    if ([0, 1, 2].every((c) => image.rgba[i + c]! >= lo && image.rgba[i + c]! <= hi)) n++;
  }
  return n / (image.width * image.height);
}

describe(`${AC[2]} a window-sized frame with sky, fog, clouds and bloom`, () => {
  it(`${AC[2]} the window-sized fixture is exposed and draws each of its sky, fog, clouds and bloom: without any one, frame 0 changes on at least 0.5% of pixels`, () => {
    requireMetal();
    const out = dir();
    const runs: [string, Taken, JsonObject][] = [
      ['all four', 'none', WITH_BLOOM], ['without the sky', 'sky', WITH_BLOOM], ['without the fog', 'fog', WITH_BLOOM],
      ['without the clouds', 'clouds', WITH_BLOOM], ['without the bloom', 'none', WITHOUT_BLOOM],
    ];
    const replies = runGpu(bin(), out, runs.map(([name, taken, lk]) =>
      view3dCall({ doc: writeJson(out, name.replace(/ /g, '-'), fixture(taken)), look: lk, size: WINDOW, frames: 1, capture: [0], targets: ['final'], surface: { internal_scale: 1 } })));
    const shots = replies.map((r, i) => readPng(out, frameAt(framesOf(r, runs[i]![0]), 0, runs[i]![0]).final, `${runs[i]![0]}: final`));
    for (const [i, shot] of shots.entries()) expect([shot.width, shot.height], `${runs[i]![0]}: the final target is window-sized`).toEqual(WINDOW);
    const black = shareWithin(shots[0]!, 0, 2); const white = shareWithin(shots[0]!, 253, 255);
    console.log(`${AC[2]}: frame 0 is ${(black * 100).toFixed(2)}% black, ${(white * 100).toFixed(2)}% white`);
    expect(black, 'the fixture is exposed: under 5% of its pixels black (every channel at most 2)').toBeLessThan(0.05);
    expect(white, 'the fixture is exposed: under 5% of its pixels white (every channel at least 253)').toBeLessThan(0.05);
    for (let i = 1; i < runs.length; i++) {
      const share = changedShare(shots[0]!, shots[i]!);
      console.log(`${AC[2]}: ${runs[i]![0]}, ${(share * 100).toFixed(2)}% of pixels change`);
      expect(share, `the fixture draws what it's ${runs[i]![0]}: at least 0.5% of pixels change by more than 2 codes`).toBeGreaterThanOrEqual(0.005);
    }
  }, 1_800_000);

  it(`${AC[2]} the window-sized fixture orbiting at ${FPS} fps stays within the figure's ${WINDOW_GPU_MS} ms of GPU in its worst frame of ${FRAMES}, in five runs, and within 256 MB`, () => {
    requireReferenceMac();
    const doc = writeJson(dir(), 'window', fixture('none'));
    const timed = (): number => {
      const o = dir();
      const [reply] = runGpu(bin(), o, [view3dCall({ doc, look: WITH_BLOOM, size: WINDOW, frames: FRAMES, fps: FPS, timings: true, surface: { internal_scale: 1 } })]);
      const fs = framesOf(reply!, 'the timed fixture');
      expect(fs.length, `the timed fixture draws ${FRAMES} frames`).toBe(FRAMES);
      for (const f of fs) {
        expect(f.gpu_ms, `frame ${f.frame} carries its GPU time`).not.toBeNull();
        expect(f.gpu_bytes, `frame ${f.frame} carries the GPU memory the device holds`).not.toBeNull();
        expect(f.gpu_bytes!, `frame ${f.frame}: GPU memory within 256 MB`).toBeLessThanOrEqual(GPU_BYTES);
      }
      return Math.max(...fs.map((f) => f.gpu_ms!));
    };
    timed(); // the warm-up run, discarded
    judge(`${AC[2]}: the window-sized fixture's worst GPU frame time at ${WINDOW.join(' × ')}, internal scale 1 (ms)`, Array.from({ length: RUNS }, timed), WINDOW_GPU_MS);
  }, 3_600_000);
});
