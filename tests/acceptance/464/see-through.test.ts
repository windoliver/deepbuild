// #464.0f0a7807: "A puff at opacity 0.5 over a filled rect covers exactly 8 pixels of each 4 × 4 block of target
// pixels it fully covers, those whose matrix entry is below 8, the same pixels at every t while it stays still and on
// two GPUs; with `see_through: blend` each covered pixel is ⌊(a × src + (255 − a) × dst + 127) ÷ 255⌋ per channel of the
// two resolved colors; a protected role under the puff keeps its exact color under both; and a planted look that draws
// the puff at full opacity covers all 16 pixels of a block and fails, naming the item"
//
// In target pixels (README: Readings): the wall, role `wall`, fills (40, 40)–(140, 120); the puff, role `smoke`, item
// `puff` with `adjust: {opacity: 0.5}`, covers (48, 48)–(112, 96), 16 × 12 whole blocks on the target's 4 × 4 grid; the
// shield, protected role `guard`, sits under the puff's corner at (96, 80)–(112, 96). With `see_through: dither` each
// whole block the puff covers away from the shield holds `smoke` exactly where the 4 × 4 Bayer matrix, read at the
// target pixel (x mod 4, y mod 4), is below 8, and `wall` elsewhere, at t = 0, 0.5 s and 1.54 s and on two GPUs. With
// `see_through: blend` each such pixel's final color (its 4 × 4 block at scale 4) is the formula with a = 128, the
// opacity's 8-bit value ⌊0.5 × 255 + 0.5⌋, src smoke and dst wall. The shield keeps `guard`'s index and color in both.
// Planted: `puff_full_opacity`, a see-through item drawn at full opacity.
import { describe, expect, it } from 'vitest';
import {
  AC, BAYER4, type Indices, type JsonObject, type Planted, TARGET, doc2d, failsNaming, film2d, frameAt, FRAME_SIZE, fromHex, hex, indexedLook, none, pixel, readFinal,
  readIndices, rect, requireGpu, runGpu, sameOnTwoGpus, tbox, useBins, useOut,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const out = useOut();
const COLORS = { wall: '#2c3e7b', smoke: '#c8b4a0', guard: '#d9482b' };
const PALETTE = ['wall', 'smoke', 'guard'];
const [WALL, SMOKE, GUARD] = [1, 2, 3];
const PUFF = { x0: 48, y0: 48, x1: 112, y1: 96 };
const shielded = (x: number, y: number): boolean => x >= 96 && x < 112 && y >= 80 && y < 96;
const DOC = doc2d('puff-464', FRAME_SIZE, [
  rect('wall', 'a0', tbox(40, 40, 100, 80), 'wall'),
  rect('shield', 'a1', tbox(96, 80, 16, 16), 'guard'),
  rect('puff', 'a2', tbox(PUFF.x0, PUFF.y0, PUFF.x1 - PUFF.x0, PUFF.y1 - PUFF.y0), 'smoke', { adjust: { opacity: 0.5 } }),
]);
const look = (seeThrough: string): JsonObject => indexedLook(`puff-${seeThrough}-464`, COLORS, PALETTE, { protected: ['guard'], see_through: seeThrough });

/** The dithered puff's blocks; failures name the item and the block. */
function ditherFailures(idx: Indices): string[] {
  const problems: string[] = [];
  for (let by = PUFF.y0; by < PUFF.y1; by += 4) for (let bx = PUFF.x0; bx < PUFF.x1; bx += 4) {
    if (shielded(bx, by)) continue;
    let smoke = 0; const wrong: string[] = [];
    for (let y = by; y < by + 4; y++) for (let x = bx; x < bx + 4; x++) {
      const want = BAYER4[y % 4]![x % 4]! < 8 ? SMOKE : WALL;
      const got = idx.at(x, y);
      if (got === SMOKE) smoke++;
      if (got !== want) wrong.push(`(${x}, ${y}) holds ${got}, not ${want}`);
    }
    if (smoke !== 8 || wrong.length) problems.push(`item puff: the 4 × 4 block at (${bx}, ${by}) covers ${smoke} of 16 pixels, not the 8 whose matrix entry is below 8 (${wrong.slice(0, 3).join('; ')})`);
  }
  for (let y = 80; y < 96; y++) for (let x = 96; x < 112; x++) if (idx.at(x, y) !== GUARD) { problems.push(`the protected shield's pixel (${x}, ${y}) under the puff holds ${idx.at(x, y)}, not guard's ${GUARD}`); break; }
  return problems;
}
function dithered(planted?: Planted): { problems: string[]; hashes: string[] } {
  requireGpu();
  const [r] = runGpu(bins.bin('deep-gpu'), out(), [film2d(DOC, look('dither'), { fps: 24, frames: 38, capture: [0, 12, 37], targets: ['indices'] })], planted);
  const idx = [0, 12, 37].map((n) => readIndices(out(), frameAt(r!, n, `the dithered puff at frame ${n}`), TARGET, `the dithered puff at frame ${n}`));
  return { problems: ditherFailures(idx[0]!), hashes: idx.map((i) => i.hash) };
}

describe(`${AC[7]} see-through on the index target: a 4 × 4 ordered threshold, or an 8-bit blend after the resolve`, () => {
  it(`${AC[7]} the puff at opacity 0.5 covers exactly the 8 pixels of each whole block whose matrix entry is below 8, the same at every t while still, and the protected shield keeps its index`, () => {
    const { problems, hashes } = dithered();
    none(problems, `${AC[7]} the dithered puff`);
    expect(new Set(hashes).size, `the still puff covers the same pixels at t = 0, 0.5 s and 1.54 s: ${hashes.join(', ')}`).toBe(1);
  });
  it(`${AC[7]} with see_through: blend each covered pixel is the 8-bit mix of the two resolved colors, and the protected shield keeps its exact color`, () => {
    requireGpu();
    const [r] = runGpu(bins.bin('deep-gpu'), out(), [film2d(DOC, look('blend'), { frames: 1, capture: [0] })]);
    const img = readFinal(out(), frameAt(r!, 0, 'the blended puff'), 'the blended puff');
    const a = Math.floor(0.5 * 255 + 0.5);
    const src = fromHex(COLORS.smoke); const dst = fromHex(COLORS.wall); const guard = fromHex(COLORS.guard);
    const want = [0, 1, 2].map((c) => Math.floor((a * src[c]! + (255 - a) * dst[c]! + 127) / 255));
    const problems: string[] = [];
    for (let y = PUFF.y0; y < PUFF.y1; y++) for (let x = PUFF.x0; x < PUFF.x1; x++) {
      const p = pixel(img, x * 4 + 2, y * 4 + 2);
      const w = shielded(x, y) ? guard : want;
      if ([0, 1, 2].some((c) => p[c] !== w[c])) { problems.push(`target pixel (${x}, ${y}) shows ${hex(p)}, not ${shielded(x, y) ? `the protected guard's ${hex(guard)}` : `the blend ${w.join(', ')}`}`); if (problems.length > 4) break; }
    }
    none(problems, `${AC[7]} the blended puff`);
  });
  it(`${AC[7]} a planted look that draws the puff at full opacity covers all 16 pixels of a block and fails, naming the item`, () => {
    failsNaming(dithered('puff_full_opacity').problems, ['item puff', 'covers 16 of 16'], `${AC[7]} the planted puff_full_opacity`);
  });
  it(`${AC[7]} the dithered puff covers the same pixels on two GPUs`, () => {
    const { hashes } = dithered();
    sameOnTwoGpus('puff', { puff: hashes[0]! }, `${AC[7]} the dithered puff`);
  });
});
