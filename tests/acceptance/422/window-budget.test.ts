// AC2 #422.7daccf6e: A window-sized frame with sky, fog, clouds and bloom stays within the GPU budget.
//
// The fixture: a scene of the figure class at 1936 × 1584 (the reference window #380's suite reads "window-sized" as)
// with a `sky@1` (a gradient, ambient light, distance fog and height fog), 32 `puff@1` clouds, an emissive lamp and a
// filmic look with bloom, the camera orbiting at 30° a second so no frame repeats. First the fixture is shown to draw
// each of the four: its frame 0 differs, on at least 0.5% of pixels by more than 2 codes, from the same frame without
// the sky, without the fog, without the clouds, and with the look's bloom off. Then the budget (canvas primitives: The
// cost model; technical design: "a core view or a window-sized figure under 2 ms of GPU"): 300 frames at 60 fps with
// `timings`, each run's worst frame's `gpu_ms` against 2 ms by the five-run rule, and every frame's `gpu_bytes` within
// 256 MB. Off a reference Mac the budget is INCONCLUSIVE.
// Wrong programs: the base (fog fields and `puff@1` unknown, so the fixture draws no fog and no clouds); a sky, fog,
// cloud or bloom that draws nothing; a frame over 2 ms or a view over 256 MB.
import { describe, expect, it } from 'vitest';
import {
  AC, BLOOM_LOOK, GPU_BYTES, NO_BLOOM_LOOK, RUNS, WINDOW_GPU_MS, box, changedShare, frameAt, framesOf, judge, material, orbiting, readPng,
  requireMetal, requireReferenceMac, runGpu, sessionDoc, sun, useDir, useGpu, view3dCall, writeJson,
  type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [1936, 1584];
const FRAMES = 300;

type Variant = 'all' | 'no_sky' | 'no_fog' | 'no_clouds';
function fogScene(variant: Variant): JsonObject {
  const { cam, channels } = orbiting([0, 1, 0], 24, 14, 30, 10);
  const fog = variant === 'no_fog' ? { fog_density: 0, fog_height: { top: 1.5, density: 0 } } : { fog_density: 0.03, fog_height: { top: 1.5, density: 0.4 } };
  const items: Record<string, JsonObject> = {
    cam,
    ...(variant === 'no_sky' ? {} : {
      sky: { kind: 'sky@1', params: { top: [0.25, 0.45, 0.85, 1], low: [0.85, 0.8, 0.7, 1], ambient_top: [0.3, 0.35, 0.45], ambient_low: [0.15, 0.13, 0.1], fog: [0.8, 0.82, 0.85, 1], ...fog } },
    }),
    stone: material({ base_color: [0.55, 0.52, 0.48, 1], roughness: 0.7 }),
    glow: material({ base_color: [1, 0.8, 0.5, 1], emission: [1, 0.8, 0.5, 1], emission_strength: 40 }),
    floor: box([80, 0.1, 80], { pos: [0, -0.05, 0] }, { material: 'stone' }),
    lamp: box([0.6, 0.6, 0.6], { pos: [0, 2, 0] }, { material: 'glow' }),
    sun: sun(20000, [-40, 30, 0], { shadow: true }),
  };
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 2 * Math.PI; const r = 6 + (i % 4) * 7;
    items[`block${i}`] = box([2, 1 + (i % 3), 2], { pos: [r * Math.cos(a), 0.5 + (i % 3) / 2, r * Math.sin(a)] }, { material: 'stone' });
  }
  if (variant !== 'no_clouds') {
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * 2 * Math.PI; const r = 10 + (i % 5) * 4;
      items[`puff${i}`] = { kind: 'puff@1', params: { radius: 2.5 + (i % 3) * 0.5, density: 0.8, seed: i }, at: { pos: [r * Math.cos(a), 4 + (i % 4), r * Math.sin(a)] } };
    }
  }
  return sessionDoc(`window-${variant}`, SIZE, items, { channels, budget: { class: 'figure' } });
}

describe(`${AC[2]} a window-sized frame with sky, fog, clouds and bloom`, () => {
  it(`${AC[2]} the fixture draws its sky, its fog, its clouds and its bloom: frame 0 changes without each`, () => {
    requireMetal();
    const out = dir();
    const cases: [string, JsonObject, JsonObject][] = [
      ['all', fogScene('all'), BLOOM_LOOK], ['the sky', fogScene('no_sky'), BLOOM_LOOK], ['the fog', fogScene('no_fog'), BLOOM_LOOK],
      ['the clouds', fogScene('no_clouds'), BLOOM_LOOK], ['the bloom', fogScene('all'), NO_BLOOM_LOOK],
    ];
    const replies = runGpu(bin(), out, cases.map(([name, doc, look]) => view3dCall({ doc: writeJson(out, name.replace(/\W+/g, '-'), doc), look, size: SIZE, frames: 1, capture: [0], targets: ['final'] })));
    const frames = replies.map((r, i) => readPng(out, frameAt(framesOf(r, cases[i]![0]), 0, cases[i]![0]).final, `${cases[i]![0]}: final`));
    for (let i = 1; i < cases.length; i++) {
      const share = changedShare(frames[0]!, frames[i]!);
      console.log(`${AC[2]}: without ${cases[i]![0]}, ${(share * 100).toFixed(2)}% of pixels change`);
      expect(share, `the frame draws ${cases[i]![0]}: without it, at least 0.5% of pixels change by more than 2 codes`).toBeGreaterThanOrEqual(0.005);
    }
  }, 1_800_000);

  it(`${AC[2]} at 1936 × 1584 the frame stays within ${WINDOW_GPU_MS} ms of GPU time in its worst frame of ${FRAMES}, in five runs, and within 256 MB of GPU memory`, () => {
    requireReferenceMac();
    const doc = writeJson(dir(), 'window', fogScene('all'));
    const timed = (): number => {
      const out = dir();
      const [reply] = runGpu(bin(), out, [view3dCall({ doc, look: BLOOM_LOOK, size: SIZE, frames: FRAMES, fps: 60, timings: true })]);
      const frames = framesOf(reply!, 'the timed window');
      expect(frames.length, `the timed window draws ${FRAMES} frames`).toBe(FRAMES);
      for (const f of frames) {
        expect(f.gpu_ms, `frame ${f.frame} carries its GPU time`).not.toBeNull();
        expect(f.gpu_bytes, `frame ${f.frame} carries the GPU memory the device holds`).not.toBeNull();
        expect(f.gpu_bytes!, `frame ${f.frame}: GPU memory within 256 MB`).toBeLessThanOrEqual(GPU_BYTES);
      }
      return Math.max(...frames.map((f) => f.gpu_ms!));
    };
    timed(); // the warm-up run, discarded
    judge(`${AC[2]}: the window's worst GPU frame time (ms)`, Array.from({ length: RUNS }, timed), WINDOW_GPU_MS);
  }, 3_600_000);
});
