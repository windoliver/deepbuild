// AC8 #161.6de2bd55: In a 3D writer layer, a fill that reaches `fx.invert@1` at premultiplied linear (0.2, 0, 0, 0.25)
// leaves it at (0.05, 0.25, 0.25, 0.25), and over an opaque fill of linear (0, 0, 0.4) the group composites to
// (0.05, 0.25, 0.55), each within one 10-bit code value. A planted invert that works on the premultiplied values writes
// (0.8, 1, 1, 0.25), brighter than its alpha allows, and fails, naming the operator.
//
// One 240 × 160 px document whose writer layer holds a camera, a box and a sun, so it is a 3D writer layer and its
// groups composite in linear light (#430's fixture). The group `tinted` holds one fill, 180 × 80 px: the role
// (231, 0, 0), linear 0.7991, at alpha 64/255, which is premultiplied linear (0.2006, 0, 0, 0.2510): the criterion's
// fill to the step an 8-bit role and an 8-bit alpha give. Under its left part lies an opaque black fill and under its
// middle an opaque fill of the role (0, 0, 170), linear (0, 0, 0.4020).
//
// `layers` with `float: true` (#430) answers the layer as premultiplied linear f32. A 3D writer layer's 2D items lie
// over its scene's picture, which is opaque, so the layer never shows a group's own texels; #430's `blend_inputs`
// does: for a group whose `blend` isn't `normal` its `source` is the group's own texels after its passes, drawn
// isolated over transparent. So four drawings, in one run:
//   - without the group: the two fills read opaque (0, 0, 0) and (0, 0, B), B within 2.5 codes of 0.4 (the role's step);
//   - the group with no pass, `blend: "subtract"`: its `source` is the fill as it reaches a pass, (r, g, b, a), within
//     1.5 codes of the criterion's (0.2, 0, 0, 0.25);
//   - the group under `fx.invert@1` at its defaults, `blend: "subtract"`: its `source` is what the pass leaves,
//     (a − r, a − g, a − b, a), the criterion's (0.05, 0.25, 0.25, 0.25), with no channel above its alpha;
//   - the group under `fx.invert@1`, blend normal: over the blue fill the layer reads (a − r, a − g, a − b + (1 − a) B, 1),
//     the criterion's (0.05, 0.25, 0.55), and over the black fill (a − r, a − g, a − b, 1).
// Each reading is one texel inside its region; each result is held to one 10-bit code per channel, alpha included,
// of that arithmetic on what the same run drew (README: Readings, "The issue's numbers on 8-bit roles").
//
// Wrong programs: the base, whose `fx.invert@1` inverts the premultiplied values; `--planted
// invert_on_premultiplied`, the same program by name: the pass leaves (0.8, 1, 1, 0.25), and the judge fails, naming
// `fx.invert@1`.
import { describe, expect, it } from 'vitest';
import {
  AC, ONE, TIMEOUT, at, buildLine, document, fx, group, layersCall, mainLayer, off, rect, requireGpu, runGpu, threeD, useBin, useDir, type Drawn, type JsonObject, type JsonValue, type Planted,
} from './helpers.ts';

const ID = AC[8];
const gpu = useBin('deep-gpu');
const dir = useDir();
const OP = 'fx.invert@1';
const SIZE = [240, 160] as const;
const FILL = [30, 40, 180, 80] as const;
/** A texel of the fill over each fill under it. */
const OVER = { black: [60, 80], blue: [120, 80] } as const;

function doc(id: string, passes: JsonValue[] | null, blend = false): JsonObject {
  const items: JsonObject[] = [rect('under_black', 'a1', [30, 30, 60, 100], 'black'), rect('under_blue', 'a2', [90, 30, 60, 100], 'b170')];
  if (passes !== null) items.push(group('tinted', 'a5', passes, blend ? { blend: 'subtract' } : {}), rect('fill', 'a6', FILL, 'r231', 64 / 255, { parent: 'tinted' }));
  return threeD(document(id, SIZE, items));
}

interface Read { failures: string[]; left: number[] }
/** The four drawings and what is wrong with them: a line about the pass starts with the operator's ID, one about the
 * fixture with `the fixture`. */
function read(planted?: Planted): Read {
  const out = dir();
  const pass: JsonValue[] = [{ op: OP, params: {} }];
  const ran = runGpu(gpu().bin, out, [layersCall(doc('invert-bare', null)), layersCall(doc('invert-plain', [], true)), layersCall(doc('invert-own', pass, true)), layersCall(doc('invert-on', pass))], planted);
  if (ran.problem) return { failures: [ran.problem], left: [] };
  const drawn = ['the fixture, without the group', 'the fixture, the group with no pass', `${OP}: the group under it, blend subtract`, `${OP}: the group under it`].map((what, i) => mainLayer(out, ran.replies[i], SIZE, what));
  const failures = drawn.filter((d): d is string => typeof d === 'string');
  if (failures.length) return { failures, left: [] };
  const [bare, plain, own, on] = drawn as [Drawn, Drawn, Drawn, Drawn];
  const reach = plain.own.get('tinted'); const leaves = own.own.get('tinted');
  if (reach === undefined || typeof reach === 'string') return { failures: [`the fixture, the group with no pass: no blend_inputs source for the group: ${String(reach)}`], left: [] };
  if (leaves === undefined || typeof leaves === 'string') return { failures: [`${OP}: no blend_inputs source for the group under it: ${String(leaves)}`], left: [] };
  const hold = (what: string, got: number[], want: number[], within = ONE): void => { if (off(got, want) > within) failures.push(`${what}: reads ${at(got)}, not ${at(want)}`); };
  if (bare.dim !== '3d') failures.push(`the fixture: the writer layer is ${bare.dim}, not 3d`);
  hold('the fixture, without the group, the opaque black fill', fx(bare.floats, ...OVER.black), [0, 0, 0, 1]);
  const under = fx(bare.floats, ...OVER.blue);
  hold('the fixture, without the group, the opaque fill of linear (0, 0, 0.4)', under, [0, 0, 0.4, 1], 2.5);
  const [r, g, b, a] = fx(reach, ...OVER.blue);
  hold('the fixture, the fill as it reaches the pass', [r, g, b, a], [0.2, 0, 0, 0.25], 1.5);
  const left = fx(leaves, ...OVER.blue);
  hold(`${OP}: the fill it leaves, of ${at([r, g, b, a])} (the criterion's (0.05, 0.25, 0.25, 0.25))`, left, [a - r, a - g, a - b, a]);
  if (left.slice(0, 3).some((c) => c > left[3]! + ONE / 1023)) failures.push(`${OP}: it leaves ${at(left)}, brighter than its alpha allows`);
  hold(`${OP}: the group over the opaque fill ${at(under)} (the criterion's (0.05, 0.25, 0.55))`, fx(on.floats, ...OVER.blue), [a - r, a - g, a - b + (1 - a) * under[2], 1]);
  hold(`${OP}: the group over the opaque black fill`, fx(on.floats, ...OVER.black), [a - r, a - g, a - b, 1]);
  return { failures, left };
}

describe(`${ID} fx.invert@1 on premultiplied color, in a 3D writer layer`, () => {
  it(`${ID} a fill at premultiplied linear (0.2, 0, 0, 0.25) leaves fx.invert@1 at (0.05, 0.25, 0.25, 0.25), and over an opaque fill of linear (0, 0, 0.4) the group composites to (0.05, 0.25, 0.55), within one 10-bit code`, () => {
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const { failures } = read();
    expect(failures, failures.join('\n  ')).toEqual([]);
  }, TIMEOUT);

  it(`${ID} planted: an invert that works on the premultiplied values (--planted invert_on_premultiplied) writes (0.8, 1, 1, 0.25), brighter than its alpha allows, and fails, naming the operator`, () => {
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const { failures, left } = read('invert_on_premultiplied');
    expect(left.length, `the planted program draws the four figures: ${failures.join('; ')}`).toBe(4);
    expect(off(left, [0.8, 1, 1, 0.25]), `the planted invert writes (0.8, 1, 1, 0.25) to the fixture's step; it wrote ${at(left)}`).toBeLessThanOrEqual(1.5);
    expect(failures.some((f) => f.startsWith(`${OP}: `) && f.includes('brighter than its alpha allows')), `the judge fails, naming ${OP}: ${failures.join('; ')}`).toBe(true);
    expect(failures.filter((f) => f.startsWith('the fixture')), 'the fixture itself is as the clean run draws it').toEqual([]);
  }, TIMEOUT);
});
