// AC9 #161.99d85364: On a 257 × 129 px frame, a group whose bounds are one opaque 33 × 33 px patch of linear (0.8, 0, 0),
// with passes `blur@1 {radius: 8}` and then `fx.invert@1` at `grow: 8`, reads (0.2, 1, 1, 1) at the patch's centre and
// (0, 0, 0, 0) everywhere outside its bounds grown by 8 px, and no texel holds a channel more than one 10-bit code value
// above its alpha. A planted invert with no alpha guard writes channels near 1 over alphas near 0 in the grown band, a
// white fringe once composited, and fails, naming the first texel.
//
// The frame's writer layer holds a camera, a box and a sun (a 3D writer layer: linear light). The patch is one
// rectangle of the role (231, 0, 0), linear 0.7991, at [112, 48, 33, 33], so its centre is texel (128, 64), 16 px
// from each edge, where a blur of radius 8 leaves it whole. What is read is the group's own texels: #430's
// `blend_inputs` `source` (`layers` with `float: true`, the group's `blend` set to `subtract`), the group after its
// passes, premultiplied linear f32, drawn isolated over transparent. Three drawings in one run:
//   - the group with no pass: the centre is the patch, (0.8, 0, 0, 1) within 1.5 codes (the 8-bit role's step);
//   - the group under the blur alone: the centre is the patch as it reaches the invert, (c, 0, 0, 1), within 3 codes
//     of the criterion's (0.8, 0, 0, 1) (the role's step and what the base's blur loses at a flat texel, 1.2 codes);
//   - the group with the two passes: the centre reads (1 − c, 1, 1, 1), the criterion's (0.2, 1, 1, 1), within one
//     code; every texel outside the patch's box grown by 8 px is exactly (0, 0, 0, 0); and no texel holds a channel
//     more than one code above its alpha. The blur shows: 200 or more texels of the grown band hold an alpha between
//     0.02 and 0.98.
//
// Wrong programs: the base (its invert writes 1 − rgb over every alpha, 16 px out); `--planted
// invert_without_alpha_guard`, under which `fx.invert@1` writes rgb = 1 − rgb and keeps the alpha wherever the alpha
// is under 1/16 and is the shipped operator elsewhere: the centre still reads right, and the judge fails on the band,
// naming the first texel.
import { describe, expect, it } from 'vitest';
import {
  AC, ONE, TIMEOUT, at, buildLine, document, fx, group, grown, inBox, layersCall, mainLayer, off, rect, requireGpu, runGpu, threeD, useBin, useDir, type Drawn, type JsonObject, type JsonValue, type Planted,
} from './helpers.ts';

const ID = AC[9];
const gpu = useBin('deep-gpu');
const dir = useDir();
const OP = 'fx.invert@1';
const SIZE = [257, 129] as const;
const PATCH = [112, 48, 33, 33] as const;
const CENTRE = [128, 64] as const;
const PASSES: JsonValue[] = [{ op: 'blur@1', params: { radius: 8 } }, { op: OP, params: {}, grow: 8 }];
const doc = (id: string, passes: JsonValue[]): JsonObject =>
  threeD(document(id, SIZE, [group('soft', 'a1', passes, { blend: 'subtract' }), rect('patch', 'a2', PATCH, 'r231', 1, { parent: 'soft' })]));

interface Read { failures: string[]; first: { x: number; y: number; texel: number[] } | null; centre: number[] }
function read(planted?: Planted): Read {
  const out = dir();
  const ran = runGpu(gpu().bin, out, [layersCall(doc('guard-plain', [])), layersCall(doc('guard-blur', PASSES.slice(0, 1))), layersCall(doc('guard-on', PASSES))], planted);
  if (ran.problem) return { failures: [ran.problem], first: null, centre: [] };
  const drawn = ['the fixture, the group with no pass', 'the fixture, the group under blur@1 alone', `${OP}: the group under blur@1 and then it`].map((what, i) => mainLayer(out, ran.replies[i], SIZE, what));
  const failures = drawn.filter((d): d is string => typeof d === 'string');
  if (failures.length) return { failures, first: null, centre: [] };
  const [plain, blurred, on] = (drawn as [Drawn, Drawn, Drawn]).map((d) => d.own.get('soft'));
  if (plain === undefined || typeof plain === 'string') return { failures: [`the fixture, the group with no pass: no blend_inputs source for the group: ${String(plain)}`], first: null, centre: [] };
  if (blurred === undefined || typeof blurred === 'string') return { failures: [`the fixture, the group under blur@1 alone: no blend_inputs source for the group: ${String(blurred)}`], first: null, centre: [] };
  if (on === undefined || typeof on === 'string') return { failures: [`${OP}: no blend_inputs source for the group under the passes: ${String(on)}`], first: null, centre: [] };
  if ((drawn[0] as Drawn).dim !== '3d') failures.push(`the fixture: the writer layer is ${(drawn[0] as Drawn).dim}, not 3d`);
  const band = grown(PATCH, 8);
  if (off(fx(plain, ...CENTRE), [0.8, 0, 0, 1]) > 1.5) failures.push(`the fixture, the patch: reads ${at(fx(plain, ...CENTRE))}, not (0.8, 0, 0, 1)`);
  const c = fx(blurred, ...CENTRE);
  if (off(c, [0.8, 0, 0, 1]) > 3) failures.push(`the fixture, the patch's centre as the blur leaves it: reads ${at(c)}, not (0.8, 0, 0, 1)`);
  const centre = fx(on, ...CENTRE);
  if (off(centre, [1 - c[0], 1 - c[1], 1 - c[2], 1]) > ONE) failures.push(`${OP}: the patch's centre reads ${at(centre)}, not ${at([1 - c[0], 1, 1, 1])} (the criterion's (0.2, 1, 1, 1))`);
  let outside = 0; let firstOutside = ''; let soft = 0; let over = 0; let first: Read['first'] = null;
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    const t = fx(on, x, y);
    if (!inBox(band, x, y)) {
      if (t.some((v) => v !== 0)) { outside++; firstOutside ||= `texel (${x}, ${y}) holds ${at(t)}`; }
    } else if (!inBox(PATCH, x, y) && t[3] > 0.02 && t[3] < 0.98) soft++;
    if (t.slice(0, 3).some((v) => v > t[3] + ONE / 1023)) { over++; first ??= { x, y, texel: t }; }
  }
  if (outside) failures.push(`${OP}: ${outside} texels outside the patch's bounds grown by 8 px aren't (0, 0, 0, 0); first ${firstOutside}`);
  if (soft < 200) failures.push(`the fixture: the blur softens ${soft} texels of the grown band, under 200; the passes didn't run as the criterion names them`);
  if (first) failures.push(`${OP}: ${over} texels hold a channel more than one 10-bit code above their alpha; first texel (${first.x}, ${first.y}) holds ${at(first.texel)}`);
  return { failures, first, centre };
}

describe(`${ID} fx.invert@1 after a blur keeps every texel within its alpha`, () => {
  it(`${ID} a 33 × 33 px patch of linear (0.8, 0, 0) under blur@1 {radius: 8} and fx.invert@1 at grow 8 reads (0.2, 1, 1, 1) at its centre, (0, 0, 0, 0) outside its bounds grown by 8 px, and no channel above its alpha`, () => {
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const { failures } = read();
    expect(failures, failures.join('\n  ')).toEqual([]);
  }, TIMEOUT);

  it(`${ID} planted: an invert with no alpha guard (--planted invert_without_alpha_guard) writes channels near 1 over alphas near 0 in the grown band and fails, naming the first texel`, () => {
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const { failures, first, centre } = read('invert_without_alpha_guard');
    expect(centre.length, `the planted program draws the three figures: ${failures.join('; ')}`).toBe(4);
    expect(failures.filter((f) => f.startsWith('the fixture')), 'the fixture itself is as the clean run draws it').toEqual([]);
    expect(first, `the judge fails on a texel that holds a channel above its alpha: ${failures.join('; ')}`).not.toBeNull();
    expect(failures.some((f) => f.startsWith(`${OP}: `) && f.includes(`first texel (${first!.x}, ${first!.y})`)), 'the failure names the first texel').toBe(true);
    expect(inBox(grown(PATCH, 16), first!.x, first!.y) && !inBox(PATCH, first!.x, first!.y), `the first texel, (${first!.x}, ${first!.y}), is in the band the passes grew`).toBe(true);
    expect(Math.max(...first!.texel.slice(0, 3)) > 0.9 && first!.texel[3]! < 1 / 16, `it holds a channel near 1 over an alpha near 0: ${at(first!.texel)}`).toBe(true);
  }, TIMEOUT);
});
