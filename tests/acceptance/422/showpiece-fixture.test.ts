// AC4 #422.05bcdd2b: The prefiltered environment, height fog and cascaded sun shadows render the fixture within the
// showpiece budget, and seeking equals playing.
//
// The fixture: a showpiece-class scene of a floor, sixteen blocks and a metal ball (roughness 0.35, so it reflects a
// prefiltered mip), under a `sky@1` whose environment is prefiltered from the sky itself, with height fog, and a key
// sun casting four cascades; the camera orbits at 20° a second. It is first shown to draw each of the three: every
// frame reports four cascades (five split distances), and frame 0 differs, on at least 0.5% of pixels by more than 2
// codes, from the same frame without the environment and without the height fog. The budget: full screen on this
// reference Mac's display at the showpiece's render scale while moving (internal scale 0.5), 300 frames at 30 fps with
// `timings`, each run's worst frame against 10 ms by the five-run rule, and every frame within 256 MB of GPU memory.
// Seeking equals playing: at 640 × 400, frames 20 and 60 of a run played from frame 0 equal, byte for byte in the final
// and linear targets, each frame drawn by a fresh process that opens at it. `--planted prefilter_over_frames` (the
// environment prefiltered one roughness mip per frame from the frame a session opens) fails, naming frame 20.
// Wrong programs: the base (no environment, height fog or cascades); a prefilter spread over frames; fog, cascade
// splits or texel snapping carried between frames; a fixture over the showpiece's 10 ms or 256 MB.
import { describe, expect, it } from 'vitest';
import {
  AC, BLOOM_LOOK, GPU_BYTES, PLAIN_LOOK, RUNS, SHOWPIECE_GPU_MS, ball, box, changedShare, failsNaming, frameAt, framesOf, judge, material, none,
  orbiting, readPng, requireMetal, requireReferenceMac, runGpu, sessionDoc, sun, useDir, useGpu, view3dCall, writeJson,
  type GpuPlanted, type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const FRAMES = 300;
const SEEK_SIZE: [number, number] = [640, 400];

type Variant = 'all' | 'no_environment' | 'no_height_fog';
function fixture(variant: Variant, size: [number, number]): JsonObject {
  const { cam, channels } = orbiting([0, 1, 0], 14, 18, 20, 20);
  const items: Record<string, JsonObject> = {
    cam,
    sky: {
      kind: 'sky@1', params: {
        top: [0.3, 0.5, 0.9, 1], low: [0.9, 0.85, 0.75, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0],
        ...(variant === 'no_environment' ? {} : { environment: { from: 'sky', intensity: 1, size: 256 } }),
        fog_height: { top: 1, density: variant === 'no_height_fog' ? 0 : 0.3 }, fog_curve: 'exp2',
      },
    },
    stone: material({ base_color: [0.6, 0.58, 0.55, 1], roughness: 0.6 }),
    chrome: material({ base_color: [0.95, 0.93, 0.88, 1], metallic: 1, roughness: 0.35 }),
    floor: box([120, 0.1, 120], { pos: [0, -0.05, 0] }, { material: 'stone' }),
    orb: ball(1.5, [0, 1.5, 0], 'chrome'),
    sun: sun(30000, [-40, 30, 0], { shadow: true, cascades: 4, split: 0.6 }),
  };
  for (let i = 0; i < 16; i++) {
    const x = ((i % 4) - 1.5) * 8; const z = (Math.floor(i / 4) - 1.5) * 8;
    if (Math.abs(x) < 3 && Math.abs(z) < 3) continue;
    items[`block${i}`] = box([2, 1 + (i % 5), 2], { pos: [x, 0.5 + (i % 5) / 2, z] }, { material: 'stone' });
  }
  return sessionDoc(`showpiece-${variant}`, size, items, { channels, budget: { class: 'showpiece' } });
}

/** Frames 20 and 60 played from 0 against each drawn by a fresh process that seeks to it; failures name the frame. */
function seekProblems(planted?: GpuPlanted): string[] {
  const out = dir();
  const doc = writeJson(out, 'showpiece-seek', fixture('all', SEEK_SIZE));
  const call = (from: number, frames: number, capture: number[]): JsonObject =>
    view3dCall({ doc, look: BLOOM_LOOK, size: SEEK_SIZE, from, frames, capture, targets: ['final', 'linear'] });
  const [played] = runGpu(bin(), out, [call(0, 61, [20, 60])], planted);
  const play = framesOf(played!, 'played from frame 0');
  const problems: string[] = [];
  for (const n of [20, 60]) {
    const [sought] = runGpu(bin(), out, [call(n, 1, [n])], planted);
    const seek = frameAt(framesOf(sought!, `sought to frame ${n}`), n, `sought to frame ${n}`);
    const p = frameAt(play, n, 'played from frame 0');
    if (seek.final !== p.final) problems.push(`frame ${n}: seeking draws final ${seek.final}, playing ${p.final}`);
    if (seek.linear !== p.linear) problems.push(`frame ${n}: seeking draws linear ${seek.linear}, playing ${p.linear}`);
  }
  return problems;
}

describe(`${AC[4]} the prefiltered environment, height fog and cascaded sun shadows`, () => {
  it(`${AC[4]} the fixture draws its environment, height fog and four cascades, full screen at internal scale 0.5 within the showpiece's ${SHOWPIECE_GPU_MS} ms in its worst frame of ${FRAMES}, in five runs, and within 256 MB`, () => {
    const display = requireReferenceMac();
    const out = dir();
    const variants: Variant[] = ['all', 'no_environment', 'no_height_fog'];
    const replies = runGpu(bin(), out, variants.map((v) => view3dCall({ doc: writeJson(out, v, fixture(v, SEEK_SIZE)), look: PLAIN_LOOK, size: SEEK_SIZE, frames: 3, capture: [0], targets: ['final'], cascades: true })));
    const frames = replies.map((r, i) => framesOf(r, variants[i]!));
    for (const f of frames[0]!) expect(f.splits?.length, `frame ${f.frame} reports four cascades: five split distances`).toBe(5);
    const shot = frames.map((fs, i) => readPng(out, frameAt(fs, 0, variants[i]!).final, `${variants[i]!}: final`));
    for (const [i, what] of [[1, 'the environment'], [2, 'the height fog']] as const) {
      const share = changedShare(shot[0]!, shot[i]!);
      console.log(`${AC[4]}: without ${what}, ${(share * 100).toFixed(2)}% of pixels change`);
      expect(share, `the fixture draws ${what}: without it, at least 0.5% of pixels change by more than 2 codes`).toBeGreaterThanOrEqual(0.005);
    }

    const doc = writeJson(out, 'showpiece', fixture('all', display));
    const timed = (): number => {
      const o = dir();
      const [reply] = runGpu(bin(), o, [view3dCall({ doc, look: BLOOM_LOOK, size: display, frames: FRAMES, fps: 30, timings: true, surface: { internal_scale: 0.5 } })]);
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
    judge(`${AC[4]}: the fixture's worst GPU frame time at ${display.join(' × ')}, internal scale 0.5 (ms)`, Array.from({ length: RUNS }, timed), SHOWPIECE_GPU_MS);
  }, 3_600_000);

  it(`${AC[4]} seeking equals playing: frames 20 and 60 equal, byte for byte, the same frames drawn by seeking to them; the planted prefilter_over_frames fails, naming frame 20`, () => {
    requireMetal();
    none(seekProblems(), 'seeking against playing');
    failsNaming(seekProblems('prefilter_over_frames'), ['frame 20'], 'the planted prefilter_over_frames');
  }, 1_800_000);
});
