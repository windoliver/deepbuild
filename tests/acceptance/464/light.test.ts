// #464.1f75f469: "With `light` on, a spark whose glow adds (200, 120, 40) to a target pixel resolved to (100, 40, 20)
// shows (255, 160, 60) over that pixel's whole 4 × 4 block at scale 4; a protected role's pixels gain no light; with
// `light: none` every pixel of the frame is a palette color; and a planted light added after the upscale gives two
// values inside one block and fails, naming the pixel"
//
// In target pixels: a rect `base` (role `base`, #642814 = 100, 40, 20) fills (40, 40)–(120, 100); a protected `guard`
// rect (#5f7f3b) sits at (90, 50)–(110, 70). Two sparks, role `spark` (#c87828 = 200, 120, 40) with `blend: add`, are
// circles of radius 0.5 target px centred on target pixels (60, 60) and (100, 60), so each covers exactly that pixel's
// center on the index target, while at full resolution its disc leaves its block's corners out: drawn after the
// upscale it can't fill the block. With `light: {max: 255}` the block of (60, 60), final pixels (240–243, 240–243), is
// (255, 160, 60) in every pixel, its neighbours stay the base color, and the guard's blocks stay #5f7f3b exactly. With
// `light: none` every final pixel is one of the palette's colors. Planted: `light_after_upscale`.
import { describe, expect, it } from 'vitest';
import {
  AC, type JsonObject, type JsonValue, type Planted, circle, doc2d, failsNaming, film2d, frameAt, FRAME_SIZE, fromHex, hex, indexedLook, none, pixel, readFinal, rect, requireGpu,
  runGpu, tbox, useBins, useOut,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const out = useOut();
const COLORS = { base: '#642814', spark: '#c87828', guard: '#5f7f3b' };
const DOC = doc2d('spark-464', FRAME_SIZE, [
  rect('base', 'a0', tbox(40, 40, 80, 60), 'base'),
  rect('guard', 'a1', tbox(90, 50, 20, 20), 'guard'),
  circle('spark', 'a2', [60.5 * 4, 60.5 * 4], 2, 'spark', { blend: 'add' }),
  circle('spark-on-guard', 'a3', [100.5 * 4, 60.5 * 4], 2, 'spark', { blend: 'add' }),
]);
const look = (light: JsonValue): JsonObject => indexedLook('spark-464', COLORS, ['base', 'spark', 'guard'], { protected: ['guard'], light });

function lit(planted?: Planted): string[] {
  requireGpu();
  const [r] = runGpu(bins.bin('deep-gpu'), out(), [film2d(DOC, look({ max: 255 }), { frames: 1, capture: [0] })], planted);
  const img = readFinal(out(), frameAt(r!, 0, 'the lit frame'), 'the lit frame');
  const problems: string[] = [];
  const block = (tx: number, ty: number, want: [number, number, number], what: string): void => {
    for (let y = ty * 4; y < ty * 4 + 4; y++) for (let x = tx * 4; x < tx * 4 + 4; x++) {
      const p = pixel(img, x, y);
      if (p.some((v, c) => v !== want[c])) { problems.push(`pixel (${x}, ${y}) in the block of target pixel (${tx}, ${ty}) is ${hex(p)}, not ${what} ${hex(want)}`); return; }
    }
  };
  block(60, 60, [255, 160, 60], 'the base (100, 40, 20) plus the glow (200, 120, 40), saturated:');
  for (const [tx, ty] of [[59, 60], [61, 60], [60, 59], [60, 61]] as const) block(tx, ty, fromHex(COLORS.base), 'the base color');
  for (let ty = 50; ty < 70; ty++) for (let tx = 90; tx < 110; tx++) block(tx, ty, fromHex(COLORS.guard), 'the protected guard\'s exact color');
  return problems;
}

describe(`${AC[8]} the light target: added after the palette resolve, before the nearest upscale, never onto a protected index`, () => {
  it(`${AC[8]} a spark adding (200, 120, 40) to (100, 40, 20) shows (255, 160, 60) over its pixel's whole 4 × 4 block, and the protected role gains no light`, () => {
    none(lit(), `${AC[8]} the light`);
  });
  it(`${AC[8]} with light: none every pixel of the frame is a palette color`, () => {
    requireGpu();
    const [r] = runGpu(bins.bin('deep-gpu'), out(), [film2d(DOC, look('none'), { frames: 1, capture: [0] })]);
    const img = readFinal(out(), frameAt(r!, 0, 'the unlit frame'), 'the unlit frame');
    const palette = new Set(['#ffffff', ...Object.values(COLORS)]);
    let off = 0; let first = '';
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const c = hex(pixel(img, x, y));
      if (!palette.has(c)) { off++; if (!first) first = `pixel (${x}, ${y}) is ${c}`; }
    }
    expect(off, `every pixel is one of ${[...palette].join(', ')}; ${off} aren't, first ${first}`).toBe(0);
  });
  it(`${AC[8]} a planted light added after the upscale gives two values inside one block and fails, naming the pixel`, () => {
    failsNaming(lit('light_after_upscale'), [/pixel \(\d+, \d+\) in the block of target pixel \(60, 60\)/], `${AC[8]} the planted light_after_upscale`);
  });
});
