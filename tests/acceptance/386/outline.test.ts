// #386.c280eed3: At internal scale 0.5 in an ink look, a cube's 1 px outline over 120 frames of a 10°-a-second orbit
// stays 1 device px wide and flickers no more, by the flicker check's measure, than at scale 1; a planted path that
// draws outlines before the upscale draws them 2 px wide and fails, naming the item.
//
// The cube is `cubeDoc` (helpers.ts): a paper cube whose stroke slot draws a 1 px ink outline around it, in the ink
// look `INK_LOOK`, under a camera whose azimuth a channel turns at 10° a second, drawn by #378's `view3d` for frames
// 0 … 119 at 60 fps through this suite's `surface` field, at internal scale 0.5 and at scale 1. The outline's width in
// each frame is its area read from coverage (the inked frame against the same frame drawn without the outline, at the
// same scale) over the cube's silhouette length (the convex hull of its pixels in the object-ID target at scale 1).
// Flicker is the flicker check's measure on the inked frames (helpers.ts, `Flicker`).
// Wrong programs: the base (view3d has no `surface` and draws no stroke on a 3D object); `--planted
// outlines_before_upscale` (issue-named: outlines drawn at internal size before the upscale, so 2 px wide), which must
// fail naming the item, `cube`.
import { describe, expect, it } from 'vitest';
import {
  CUBE_VIEW, Flicker, INK, INK_LOOK, ORBIT, answered, cubeDoc, frameAt, framesOf, hullPerimeter, inkArea, luminance, lumaOf, median, readIds, readPng, requireMetal, run,
  surfaceOf, surfaceProblems, useBuilds, useOut, view3dCall, writeJson,
  type Image, type JsonObject, type Planted, type SurfaceSpec, type ViewFrame,
} from './helpers.ts';

const ID = '#386.c280eed3';
const HALF: SurfaceSpec = { internal_scale: 0.5, upscale: 'edge_adaptive', sharpen: 0.2 };
const FULL: SurfaceSpec = { internal_scale: 1 };
const INK_Y = luminance(INK);
/** "Stays 1 device px wide": within [0.6, 1.5] px by coverage on every frame (a 1 px line drawn without antialiasing reads 0.71 on a diagonal), and within 0.8 to 1.25 times its width at scale 1. */
const WIDTH = { min: 0.6, max: 1.5, ratioMin: 0.8, ratioMax: 1.25 };
/** "No more flicker": in every one-second window, the share of the view that flashes at most 5% (plus one part in 10,000 of the view) above scale 1's. */
const FLICKER_SLACK = { relative: 1.05, absolute: 1e-4 };

const builds = useBuilds(['default']);
const out = useOut();

export interface Measured { problems: string[]; ratio: number }
/** The four runs (inked and bare, at 0.5 and at 1), measured frame by frame: failures as sentences naming the item. */
function measure(bin: string, planted?: Planted): Measured {
  const inked = writeJson(out(), 'cube-inked', cubeDoc(true));
  const bare = writeJson(out(), 'cube-bare', cubeDoc(false));
  const call = (doc: string, surface: SurfaceSpec, ids: boolean): JsonObject =>
    view3dCall({ doc, look: INK_LOOK, size: CUBE_VIEW, from: 0, frames: ORBIT.frames, fps: ORBIT.fps, capture: 'every', targets: ids ? ['final', 'ids'] : ['final'], surface });
  const replies = run(bin, out(), [call(inked, HALF, false), call(bare, HALF, false), call(inked, FULL, false), call(bare, FULL, true)], planted ? { planted } : {});
  const names = ['inked at 0.5', 'bare at 0.5', 'inked at 1', 'bare at 1'] as const;
  const surfaces = [HALF, HALF, FULL, FULL];
  const frames: ViewFrame[][] = replies.map((r, i) => {
    answered(r, names[i]!);
    expect(surfaceProblems(surfaceOf(r, names[i]!), surfaces[i]!, CUBE_VIEW, names[i]!), `${names[i]} drew through the surface it was given`).toEqual([]);
    const f = framesOf(r, names[i]!);
    expect(f.map((x) => x.frame), `${names[i]}: frames 0 … 119`).toEqual(Array.from({ length: ORBIT.frames }, (_, k) => k));
    return f;
  });
  const [inked05, bare05, inked1, bare1] = frames as [ViewFrame[], ViewFrame[], ViewFrame[], ViewFrame[]];
  expect(inked1[0]!.pixel_hash, 'the orbit moves the view between frame 0 and frame 119').not.toBe(inked1[ORBIT.frames - 1]!.pixel_hash);
  const flicker05 = new Flicker(CUBE_VIEW[0], CUBE_VIEW[1], ORBIT.fps);
  const flicker1 = new Flicker(CUBE_VIEW[0], CUBE_VIEW[1], ORBIT.fps);
  const problems: string[] = [];
  const ratios: number[] = [];
  const read = (f: ViewFrame, what: string): Image => readPng(out(), f.final, what);
  for (let n = 0; n < ORBIT.frames; n++) {
    const ids = readIds(out(), frameAt(bare1, n, 'bare at 1'), `frame ${n}: the object-ID target at scale 1`);
    const perimeter = hullPerimeter(ids.width, ids.height, (x, y) => ids.at(x, y) === 'cube');
    expect(perimeter, `frame ${n}: the cube is on screen`).toBeGreaterThan(200);
    const i05 = read(inked05[n]!, `frame ${n} inked at 0.5`);
    const i1 = read(inked1[n]!, `frame ${n} inked at 1`);
    const w05 = inkArea(read(bare05[n]!, `frame ${n} bare at 0.5`), i05, INK_Y) / perimeter;
    const w1 = inkArea(read(bare1[n]!, `frame ${n} bare at 1`), i1, INK_Y) / perimeter;
    flicker05.push(lumaOf(i05));
    flicker1.push(lumaOf(i1));
    ratios.push(w05 / w1);
    if (w1 < WIDTH.min || w1 > WIDTH.max) problems.push(`cube: frame ${n}: outline ${w1.toFixed(2)} device px wide at scale 1, not 1`);
    if (w05 < WIDTH.min || w05 > WIDTH.max || w05 / w1 < WIDTH.ratioMin || w05 / w1 > WIDTH.ratioMax) problems.push(`cube: frame ${n}: outline ${w05.toFixed(2)} device px wide at internal scale 0.5, against ${w1.toFixed(2)} at scale 1`);
  }
  const w05 = flicker05.windows();
  const w1 = flicker1.windows();
  for (let k = 0; k < w05.length; k++) {
    const a = w05[k]!; const b = w1[k]!;
    if (a.share > b.share * FLICKER_SLACK.relative + FLICKER_SLACK.absolute) problems.push(`cube: flicker: in the second from frame ${a.from}, ${(a.share * 100).toFixed(3)}% of the view flashes at internal scale 0.5, against ${(b.share * 100).toFixed(3)}% at scale 1`);
    if (a.most > Math.max(3, b.most)) problems.push(`cube: flicker: in the second from frame ${a.from}, a pixel flashes ${a.most} times at internal scale 0.5, against at most ${b.most} at scale 1`);
  }
  const ratio = median(ratios);
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: outline width at 0.5 over scale 1, median ${ratio.toFixed(3)}; flicker share at 0.5 peaks ${(Math.max(...w05.map((x) => x.share)) * 100).toFixed(3)}%, at 1 ${(Math.max(...w1.map((x) => x.share)) * 100).toFixed(3)}%; ${problems.length} problems`);
  return { problems, ratio };
}

describe(`${ID} the measures`, () => {
  it(`${ID} the flicker measure counts a pixel that toggles every frame and nothing on a still view; the width measure reads 1 and 2 px lines as 1 and 2 (holds at the base)`, () => {
    const toggling = new Flicker(4, 1, 60);
    const still = new Flicker(4, 1, 60);
    for (let k = 0; k < 120; k++) {
      toggling.push(Float32Array.from([k % 2 === 0 ? 0.02 : 0.6, 0.5, 0.5, 0.5]));
      still.push(Float32Array.from([0.3, 0.5, 0.5, 0.5]));
    }
    const t = toggling.windows();
    expect(t.length, 'one window per start frame from 1 to 60').toBe(60);
    expect(t.every((w) => w.share === 0.25), 'one pixel of four flashes in every second').toBe(true);
    expect(t.every((w) => w.most >= 29), 'about 30 flashes a second, a pair of opposing changes each').toBe(true);
    expect(still.windows().every((w) => w.share === 0 && w.most === 0), 'a still view never flashes').toBe(true);
    // A change of 0.1 or less, or one whose darker frame is at 0.80 or above, never counts.
    const faint = new Flicker(2, 1, 60);
    for (let k = 0; k < 120; k++) faint.push(Float32Array.from([k % 2 === 0 ? 0.4 : 0.5, k % 2 === 0 ? 0.8 : 1.0]));
    expect(faint.windows().every((w) => w.share === 0), 'changes of 0.1, or above 0.80, never flash').toBe(true);

    const w = 100; const h = 60;
    const paper = (): Image => ({ width: w, height: h, rgba: new Uint8Array(w * h * 4).fill(240) });
    const line = (rows: number[]): Image => { const im = paper(); for (const y of rows) for (let x = 0; x < w; x++) im.rgba.set([INK[0], INK[1], INK[2], 255], (y * w + x) * 4); return im; };
    expect(inkArea(paper(), line([30]), INK_Y) / w, 'a 1 px line across reads 1 px wide').toBeCloseTo(1, 6);
    expect(inkArea(paper(), line([30, 31]), INK_Y) / w, 'a 2 px line reads 2 px wide').toBeCloseTo(2, 6);
    expect(hullPerimeter(w, h, (x, y) => x >= 10 && x < 60 && y >= 5 && y < 55), 'a 50 px square\'s hull is 200 px around').toBeCloseTo(200, 6);
  });

  it(`${ID} the fixture tries: the cube fills thousands of pixels and the orbit turns it between frames 0 and 119 (holds at the base)`, () => {
    requireMetal();
    const doc = writeJson(out(), 'cube-bare', cubeDoc(false));
    const call = (from: number): JsonObject => view3dCall({ doc, look: INK_LOOK, size: CUBE_VIEW, from, frames: 1, fps: ORBIT.fps, capture: [from], targets: ['final', 'ids'] });
    const [a, b] = run(builds.bin(), out(), [call(0), call(ORBIT.frames - 1)]);
    const f0 = frameAt(framesOf(answered(a!, 'frame 0'), 'frame 0'), 0, 'frame 0');
    const f119 = frameAt(framesOf(answered(b!, 'frame 119'), 'frame 119'), ORBIT.frames - 1, 'frame 119');
    const ids = readIds(out(), f0, 'frame 0\'s object-ID target');
    expect(ids.count.get('cube') ?? 0, 'the cube is on screen').toBeGreaterThan(10_000);
    expect(f0.pixel_hash, 'the orbit turns the view').not.toBe(f119.pixel_hash);
  }, 1_800_000);
});

describe(`${ID} at internal scale 0.5 in an ink look, a cube's 1 px outline stays 1 device px wide and flickers no more than at scale 1`, () => {
  it(`${ID} over 120 frames of a 10°-a-second orbit, the outline at internal scale 0.5 is 1 device px wide on every frame and flickers no more than at scale 1`, () => {
    requireMetal();
    const { problems } = measure(builds.bin());
    expect(problems.slice(0, 20), 'the outline stays 1 device px wide and flickers no more').toEqual([]);
  }, 3_600_000);

  it(`${ID} a planted path that draws outlines before the upscale draws them 2 px wide and fails, naming the item`, () => {
    requireMetal();
    const { problems, ratio } = measure(builds.bin(), 'outlines_before_upscale');
    expect(problems.length, '--planted outlines_before_upscale fails the check').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming the item').toMatch(/^cube: frame \d+: outline [\d.]+ device px wide at internal scale 0\.5/m);
    expect(ratio, 'the planted outlines are about 2 px wide: twice scale 1\'s').toBeGreaterThanOrEqual(1.6);
  }, 3_600_000);
});
