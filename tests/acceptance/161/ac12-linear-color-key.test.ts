// AC12 #161.6c7f6fc1: On a backing of linear (0, 1, 0) that holds an opaque grey square of (0.5, 0.5, 0.5),
// `fx.linear_color_key@1` keyed to the backing color writes (0, 0, 0, 0) on the backing and leaves the square
// (0.5, 0.5, 0.5, 1), so the backing reads (1, 1, 1) over white and (0, 0, 0) over black, within one 10-bit code value.
// A planted keyer that keeps the backing's color at alpha 0 reads (0, 1, 0) over black and fails, naming the operator.
//
// One 240 × 160 px document whose writer layer holds a camera, a box and a sun (a 3D writer layer: linear light). The
// group `keyed` holds the backing, a 200 × 80 px rectangle of the role (0, 255, 0), linear (0, 1, 0), and on it a
// 30 × 40 px square of the role (188, 188, 188), linear 0.5029, the 8-bit role nearest the criterion's grey. Under
// the backing's left part lies an opaque white fill and under its middle an opaque black one. The group's one pass is
// `fx.linear_color_key@1 {key: [0, 1, 0]}`, every other param at its default. `layers` with `float: true` (#430)
// answers the layer as premultiplied linear f32, and for a group whose `blend` isn't `normal` its `blend_inputs`
// `source`, the group's own texels after its passes, isolated over transparent. Four drawings in one run:
//   - without the group: the fills read (1, 1, 1, 1) and (0, 0, 0, 1);
//   - the group with no pass, `blend: "subtract"`: its `source` reads the backing (0, 1, 0, 1) and the square
//     (g, g, g, 1), within 3.5 codes of the criterion's grey (the 8-bit role's step);
//   - the keyed group, `blend: "subtract"`: its `source` reads (0, 0, 0, 0) on the backing, and the square as it
//     reached the pass, (g, g, g, 1), the criterion's (0.5, 0.5, 0.5, 1);
//   - the keyed group, blend normal: the layer reads (1, 1, 1, 1) where the backing lies over white and (0, 0, 0, 1)
//     where it lies over black.
// Each within one 10-bit code per channel, alpha included, at one texel inside its region. "Over black" is read twice:
// on the layer, and as premultiplied over on the group's own texel (its rgb plus (1 − its alpha) × black), since the
// base's compositor leaves what lies under a texel of alpha 0 as it is, whatever color the texel holds.
//
// Wrong programs: the base (no such operator); `--planted key_keeps_color_at_alpha_0`, under which a keyed texel
// keeps its rgb and takes alpha 0: the backing's own texel is (0, 1, 0, 0), which over black is (0, 1, 0), and the
// judge fails, naming the operator.
import { describe, expect, it } from 'vitest';
import {
  AC, ONE, TIMEOUT, at, buildLine, document, fx, group, layersCall, listProblems, mainLayer, off, opId, packOperators, rect, requireGpu, runGpu, threeD, useBin, useDir,
  type Drawn, type JsonObject, type JsonValue, type Planted,
} from './helpers.ts';

const ID = AC[12];
const gpu = useBin('deep-gpu');
const dir = useDir();
const OP = opId('linear_color_key');
const SIZE = [240, 160] as const;
/** One texel of each thing read. */
const AT = { white: [50, 80], black: [110, 80], square: [185, 80] } as const;

function doc(id: string, passes: JsonValue[] | null, blend = false): JsonObject {
  const items: JsonObject[] = [rect('under_white', 'a1', [20, 30, 60, 100], 'white'), rect('under_black', 'a2', [80, 30, 60, 100], 'black')];
  if (passes !== null) items.push(group('keyed', 'a5', passes, blend ? { blend: 'subtract' } : {}), rect('backing', 'a6', [20, 40, 200, 80], 'green', 1, { parent: 'keyed' }), rect('square', 'a7', [170, 60, 30, 40], 'g188', 1, { parent: 'keyed' }));
  return threeD(document(id, SIZE, items));
}

interface Read { failures: string[]; backing: number[]; overBlack: number[] }
function read(planted?: Planted): Read {
  const out = dir();
  const pass: JsonValue[] = [{ op: OP, params: { key: [0, 1, 0] } }];
  const ran = runGpu(gpu().bin, out, [layersCall(doc('key-bare', null)), layersCall(doc('key-plain', [], true)), layersCall(doc('key-own', pass, true)), layersCall(doc('key-on', pass))], planted);
  if (ran.problem) return { failures: [ran.problem], backing: [], overBlack: [] };
  const drawn = ['the fixture, without the group', 'the fixture, the group with no pass', `${OP}: the keyed group, blend subtract`, `${OP}: the keyed group`].map((what, i) => mainLayer(out, ran.replies[i], SIZE, what));
  const failures = drawn.filter((d): d is string => typeof d === 'string');
  if (failures.length) return { failures, backing: [], overBlack: [] };
  const [bare, plain, own, on] = drawn as [Drawn, Drawn, Drawn, Drawn];
  const reach = plain.own.get('keyed'); const keyed = own.own.get('keyed');
  if (reach === undefined || typeof reach === 'string') return { failures: [`the fixture, the group with no pass: no blend_inputs source for the group: ${String(reach)}`], backing: [], overBlack: [] };
  if (keyed === undefined || typeof keyed === 'string') return { failures: [`${OP}: no blend_inputs source for the keyed group: ${String(keyed)}`], backing: [], overBlack: [] };
  const hold = (what: string, got: number[], want: number[], within = ONE): void => { if (off(got, want) > within) failures.push(`${what}: reads ${at(got)}, not ${at(want)}`); };
  if (bare.dim !== '3d') failures.push(`the fixture: the writer layer is ${bare.dim}, not 3d`);
  hold('the fixture, without the group, the white fill', fx(bare.floats, ...AT.white), [1, 1, 1, 1]);
  hold('the fixture, without the group, the black fill', fx(bare.floats, ...AT.black), [0, 0, 0, 1]);
  hold('the fixture, the backing of linear (0, 1, 0)', fx(reach, ...AT.black), [0, 1, 0, 1]);
  const grey = fx(reach, ...AT.square);
  hold('the fixture, the opaque grey square of (0.5, 0.5, 0.5)', grey, [0.5, 0.5, 0.5, 1], 3.5);
  const backing = fx(keyed, ...AT.black);
  hold(`${OP}: the backing, keyed out`, backing, [0, 0, 0, 0]);
  // Premultiplied over: a texel's rgb, plus (1 − its alpha) of what lies under it. Under it here is black.
  hold(`${OP}: the backing over black, by its own texel`, backing.slice(0, 3), [0, 0, 0]);
  hold(`${OP}: the square it leaves (the criterion's (0.5, 0.5, 0.5, 1))`, fx(keyed, ...AT.square), grey);
  hold(`${OP}: the backing over white`, fx(on.floats, ...AT.white), [1, 1, 1, 1]);
  const overBlack = fx(on.floats, ...AT.black);
  hold(`${OP}: the backing over black, composited`, overBlack, [0, 0, 0, 1]);
  hold(`${OP}: the square, composited`, fx(on.floats, ...AT.square), grey);
  return { failures, backing, overBlack };
}

describe(`${ID} fx.linear_color_key@1 writes premultiplied color`, () => {
  it(`${ID} keyed to its backing of linear (0, 1, 0), fx.linear_color_key@1 writes (0, 0, 0, 0) on the backing and leaves the grey square, so the backing reads (1, 1, 1) over white and (0, 0, 0) over black, within one 10-bit code`, () => {
    expect(listProblems(packOperators()).filter((p) => p.includes(OP)), `the pack holds ${OP}`).toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const { failures } = read();
    expect(failures, failures.join('\n  ')).toEqual([]);
  }, TIMEOUT);

  it(`${ID} planted: a keyer that keeps the backing's color at alpha 0 (--planted key_keeps_color_at_alpha_0) reads (0, 1, 0) over black and fails, naming the operator`, () => {
    expect(listProblems(packOperators()).filter((p) => p.includes(OP)), `the pack holds ${OP}`).toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const { failures, backing, overBlack } = read('key_keeps_color_at_alpha_0');
    expect(backing.length, `the planted program draws the four figures: ${failures.join('; ')}`).toBe(4);
    // The plant shows either where the layer composites it over black, or in the group's own texel (README: Readings).
    const shows = off(overBlack.slice(0, 3), [0, 1, 0]) <= ONE || off(backing, [0, 1, 0, 0]) <= ONE;
    expect(shows, `the planted keyer's backing reads (0, 1, 0) over black; composited it read ${at(overBlack)}, and its own texel is ${at(backing)}`).toBe(true);
    expect(failures.some((f) => f.startsWith(`${OP}: the backing over black`)), `the judge fails, naming ${OP}: ${failures.join('; ')}`).toBe(true);
    expect(failures.filter((f) => f.startsWith('the fixture')), 'the fixture itself is as the clean run draws it').toEqual([]);
  }, TIMEOUT);
});
