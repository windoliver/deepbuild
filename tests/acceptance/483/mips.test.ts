// #483.aae924bf: "Mips on a compute texture: an operator that writes a 1,024 × 1,024 rgba8unorm checker of 4-texel
// black and white squares with mips: true reads back 11 levels, levels 0 to 2 with every texel at 0 or 255 and
// levels 3 to 10 with every texel within one code value of 127.5, as a CPU chain of 2 × 2 boxes in f64 gives; a floor
// drawn to the horizon with it, under a look whose `filter_taps` is 1, matches a CPU reference of the same trilinear
// lookups within 2 code values on 99.9% of pixels on one machine; once a channel turns the white squares red, the
// chain is made again with the output and level 3 reads (127.5, 0, 0) within one code value; a planted chain left at
// level 0 reads 0 at level 3, and one kept under the old key stays gray after the change, each failing, naming the
// level; and mips: true on an r32uint texture is refused with operator_type"
//
// One showpiece document through `view3d` (full-resolution passes), each operator declaring the check's estimate.
// `checker` stores, at its own texel (e mod 1,024, e ÷ 1,024), black (0, 0, 0, 1) or white (1, g, g, 1) by
// ((x >> 2) xor (y >> 2)) & 1, g = 1 − red, and red is an input `from: {channel: items/b0/at/pos/1}`, the value the
// document's channel `turn` gives that path: 0 at 0 s, 1 from 0.25 s. Its output `tex` is {rgba8unorm,
// [1024, 1024], mips: true}, read back at frames 0 and 30 (view3d `read`, README) and each level's RGB held to
// `helpers.ts: mipChain` of the CPU's own checker: exactly at levels 0 to 2, within one code at 3 to 10; at frame 30
// to the red checker's chain, whose level 3 is (127.5, 0, 0). Only RGB is read ("every texel" of a color); alpha is
// 255 throughout. The floor: `floor`, a pass that draws the plane y = 0 seen from 1 m up, looking level along −z with
// a 60° vertical field, its texture 8 m across centred under the camera; for each pixel it computes where its ray
// meets the plane, the uv there and the trilinear level from the footprint's longer axis (in texels), and samples
// `tex` at that uv and level (`sample@1` with `lod`); above the horizon, black. The CPU reference makes the same
// lookups in f64 (`helpers.ts: trilinear`) on the CPU chain, and frame 0's pre-tone target, which the pass replaces,
// is held to it within 2 codes on 99.9% of the 512 × 512 pixels, under the look's `filter_taps: 1`. The texture is
// uniform from level 3 down and the floor stays inside [0, 1] of uv wherever the level is under 3, so the sampler's
// address mode can't move a pixel. The planted twins: mips_level0_only and mips_kept_under_old_key, each failing
// naming level 3. Last, through check_operator, a texture output {r32uint, mips: true} is refused with operator_type,
// the same without mips checks. At the base there is no texture output, store step, mips or view3d `read`.
import { describe, expect, it } from 'vitest';
import {
  AC, LOOK, asItem, box, camera, checkCall, checked, compute, errors, f32File, failsNaming, frameOf, mipChain, pass, requireGpu, run, run1, sceneDoc, shown,
  step, trilinear, useBins, useOut, view3dFrames, withEstimates, writeJson, type JsonObject, type Planted,
} from './helpers.ts';

const bins = useBins();
const out = useOut();
const TEX = 1024;
const W = 512;
const B = Math.tan(Math.PI / 6); // tan of half the 60° field; the frame is square, so the horizontal factor too
const HEIGHT = 1;
const ACROSS = 8;
const K1 = (B * 2 / W) * (TEX / ACROSS);
const K2 = (B / HEIGHT) * (2 / W) * (TEX / ACROSS);

const CHECKER = compute('checker', {
  e: step('element@1'), x: step('and@1', { a: 'e', b: TEX - 1 }), y: step('shr@1', { a: 'e', b: 10 }),
  cx: step('shr@1', { a: 'x', b: 2 }), cy: step('shr@1', { a: 'y', b: 2 }), cxy: step('xor@1', { a: 'cx', b: 'cy' }), par: step('and@1', { a: 'cxy', b: 1 }),
  wh: step('eq@1', { a: 'par', b: 1 }), g: step('sub@1', { a: 1, b: 'red' }), white: step('compose@1', { x: 1, y: 'g', z: 'g', w: 1 }),
  black: { op: 'const@1', args: { value: [0, 0, 0, 1], type: 'vec4' } }, col: step('select@1', { f: 'black', t: 'white', cond: 'wh' }),
  p: step('compose@1', { x: 'x', y: 'y' }), st: step('store@1', { tex: 'tex', ixy: 'p', v: 'col' }),
}, { tex: { texture: { format: 'rgba8unorm', size: [TEX, TEX], mips: true } } },
{ inputs: { red: { type: 'f32', range: [0, 1], default: 0, from: { channel: 'items/b0/at/pos/1' } } } }, TEX * TEX);
const FLOOR = pass('floor', {
  px: step('pixel@1'), pf: { op: 'convert@1', args: { x: 'px', to: 'vec2<f32>' } },
  pxf: { op: 'split@1', args: { x: 'pf', pick: 'x' } }, pyf: { op: 'split@1', args: { x: 'pf', pick: 'y' } },
  hx: step('add@1', { a: 'pxf', b: 0.5 }), xs: step('mul@1', { a: 'hx', b: 2 / W }), xn: step('sub@1', { a: 'xs', b: 1 }),
  hy: step('add@1', { a: 'pyf', b: 0.5 }), ys: step('mul@1', { a: 'hy', b: 2 / W }), yn: step('sub@1', { a: 1, b: 'ys' }),
  sky: step('ge@1', { a: 'yn', b: 0 }), ny: step('min@1', { a: 'yn', b: -1e-6 }), nb: step('mul@1', { a: 'ny', b: -B }), t: step('div@1', { a: HEIGHT, b: 'nb' }),
  ax: step('mul@1', { a: 'xn', b: B }), xw: step('mul@1', { a: 'ax', b: 't' }), u0: step('div@1', { a: 'xw', b: ACROSS }), u: step('add@1', { a: 'u0', b: 0.5 }),
  v: step('div@1', { a: 't', b: ACROSS }), uv: step('compose@1', { x: 'u', y: 'v' }),
  fx: step('mul@1', { a: 't', b: K1 }), t2: step('mul@1', { a: 't', b: 't' }), axx: step('mul@1', { a: 'ax', b: 'ax' }), r1: step('add@1', { a: 'axx', b: 1 }),
  rs: step('sqrt@1', { x: 'r1' }), fy0: step('mul@1', { a: 't2', b: K2 }), fy: step('mul@1', { a: 'fy0', b: 'rs' }), fm: step('max@1', { a: 'fx', b: 'fy' }),
  lod0: step('log2@1', { x: 'fm' }), lod: step('clamp@1', { x: 'lod0', lo: 0, hi: 10 }),
  c: step('sample@1', { tex: 'tex', uv: 'uv', lod: 'lod' }), black: { op: 'const@1', args: { value: [0, 0, 0, 1], type: 'vec4' } },
  out: step('select@1', { f: 'c', t: 'black', cond: 'sky' }),
}, { inputs: { tex: { type: 'texture', from: { texture: { target: { op: 'checker', output: 'tex' } } } } } });

/** The CPU's checker, white squares (255, 255 − 255 × red, 255 − 255 × red), and its chain. */
function cpuChain(red: number): { size: number; rgb: Float64Array }[] {
  const l0 = new Float64Array(TEX * TEX * 3);
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
    const wh = (((x >> 2) ^ (y >> 2)) & 1) === 1;
    l0.set(wh ? [255, 255 * (1 - red), 255 * (1 - red)] : [0, 0, 0], (y * TEX + x) * 3);
  }
  return mipChain(l0, TEX);
}
/** The floor's lookup at pixel (x, y), as FLOOR computes it, in f64: its code values. */
function floorAt(chain: { size: number; rgb: Float64Array }[], x: number, y: number): [number, number, number] {
  const xn = ((x + 0.5) * 2) / W - 1; const yn = 1 - ((y + 0.5) * 2) / W;
  if (yn >= 0) return [0, 0, 0];
  const t = HEIGHT / (Math.min(yn, -1e-6) * -B); const ax = xn * B;
  const fm = Math.max(t * K1, t * t * K2 * Math.sqrt(ax * ax + 1));
  return trilinear(chain, (ax * t) / ACROSS + 0.5, t / ACROSS, Math.min(10, Math.max(0, Math.log2(fm))));
}
const doc = (dir: string, ops: JsonObject[]): string => writeJson(dir, 'mips.json', sceneDoc('mips-483', { cam: camera([0, 2, 7]), b0: box([0, 0, 0]), ...Object.fromEntries(ops.map((o) => [String(o['id']), asItem(o)])) }, {
  size: [W, W], budget: { class: 'showpiece' },
  channels: { turn: { target: 'items/b0/at/pos/1', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '0.25s', value: 1, interp: 'linear' } } } },
}));

function chainProblems(levels: { size: number[]; file: string }[], dir: string, want: { size: number; rgb: Float64Array }[], when: string): string[] {
  const problems: string[] = [];
  if (levels.length !== 11) problems.push(`levels${when}: ${levels.length} read back, not 11`);
  levels.slice(0, 11).forEach((lv, L) => {
    const s = TEX >> L;
    const px = f32File(dir, lv.file, `level ${L}${when}`);
    if (px.length !== s * s * 4) { problems.push(`level ${L}${when}: ${px.length / 4} texels, not ${s} × ${s}`); return; }
    const tol = L <= 2 ? 0.5 : 1;
    for (let i = 0; i < s * s; i++) {
      const got = [0, 1, 2].map((c) => px[i * 4 + c]! * 255); const ref = [0, 1, 2].map((c) => want[L]!.rgb[i * 3 + c]!);
      if (got.some((g, c) => Math.abs(g - ref[c]!) > tol)) {
        problems.push(`level ${L}${when}: texel (${i % s}, ${Math.floor(i / s)}) reads (${got.map((g) => g.toFixed(1)).join(', ')}), the CPU chain's (${ref.map((r) => r.toFixed(1)).join(', ')})`);
        return;
      }
    }
  });
  return problems;
}

function mipsProblems(planted?: Planted): string[] {
  const dir = out();
  const ops = withEstimates(bins.bin(), dir, [CHECKER, FLOOR]);
  const frames = view3dFrames(run1(bins.bin(), dir, {
    call: 'view3d', doc: doc(dir, ops), look: { ...LOOK, filter_taps: 1 }, size: [W, W], fps: 60, frames: 31, targets: ['pre_tone'], capture: [0, 30], read: ['checker.tex'],
  }, planted), 'the mips document');
  const problems: string[] = [];
  const gray = cpuChain(0);
  const red = cpuChain(1);
  expect([gray[3]!.rgb.slice(0, 3), red[3]!.rgb.slice(0, 3)].map((v) => Array.from(v)), 'the CPU chains\' level 3: gray, then (127.5, 0, 0)').toEqual([[127.5, 127.5, 127.5], [127.5, 0, 0]]);
  for (const [n, want, when] of [[0, gray, ''], [30, red, ' after the change']] as const) {
    const f = frameOf(frames, n, 'the mips document');
    const tex = f.read.get('checker.tex');
    if (!tex) { problems.push(`frame ${n}: checker.tex wasn't read back`); continue; }
    problems.push(...chainProblems(tex.levels, dir, want, when));
  }
  const f0 = frameOf(frames, 0, 'the mips document');
  expect(f0.pre_tone, 'frame 0: the pre-tone target is written').not.toBeNull();
  const img = f32File(dir, f0.pre_tone!, 'frame 0: pre_tone');
  expect(img.length, `${W} × ${W} RGBA pixels`).toBe(W * W * 4);
  let off = 0; let first = '';
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const ref = floorAt(gray, x, y); const i = (y * W + x) * 4;
    if ([0, 1, 2].some((c) => Math.abs(img[i + c]! * 255 - ref[c]!) > 2)) { off++; if (!first) first = `pixel (${x}, ${y}) reads ${[0, 1, 2].map((c) => (img[i + c]! * 255).toFixed(1)).join(', ')}, the reference ${ref.map((r) => r.toFixed(1)).join(', ')}`; }
  }
  console.log(`${AC[7]}${planted ? ` (planted ${planted})` : ''}: the floor: ${off} of ${W * W} pixels more than 2 codes from the CPU's trilinear lookups${first ? `; first ${first}` : ''}`);
  if (off / (W * W) > 0.001) problems.push(`the floor: ${off} of ${W * W} pixels are more than 2 codes from the CPU's trilinear lookups; the first: ${first}`);
  return problems;
}

describe(`${AC[7]} mips on a compute texture`, () => {
  it(`${AC[7]} the checker's 11 levels match the CPU chain, the floor matches the CPU's trilinear lookups under filter_taps 1, the red checker's chain is made again; mips on r32uint is refused with operator_type`, () => {
    requireGpu();
    expect(mipsProblems(), 'the chain, the floor and the chain made again').toEqual([]);
    const ids = (mips: boolean): JsonObject => compute('ids', {
      e: step('element@1'), x: step('and@1', { a: 'e', b: 63 }), y: step('shr@1', { a: 'e', b: 6 }), p: step('compose@1', { x: 'x', y: 'y' }),
      st: step('store@1', { tex: 'tex', ixy: 'p', v: 'e' }),
    }, { tex: { texture: { format: 'r32uint', size: [64, 64], mips } } }, {}, 4096);
    const [plain, mipped] = run(bins.bin(), out(), [checkCall(ids(false)), checkCall(ids(true))]).map((r, i) => checked(r, i ? 'r32uint with mips' : 'r32uint without mips'));
    expect(plain!.outcome, `an r32uint texture without mips checks: ${shown(plain!.issues)}`).toBe('accepted');
    expect(mipped!.outcome, 'mips: true on r32uint').toBe('refused');
    expect(errors(mipped!, 'operator_type').length, `refused with operator_type: ${shown(mipped!.issues)}`).toBeGreaterThan(0);
  }, 1_800_000);

  it(`${AC[7]} a planted chain left at level 0 (--planted mips_level0_only) reads 0 at level 3 and fails, naming the level`, () => {
    requireGpu();
    failsNaming(mipsProblems('mips_level0_only'), [/level 3: texel \(\d+, \d+\) reads \(0\.0, 0\.0, 0\.0\)/], 'the planted mips_level0_only');
  }, 1_800_000);

  it(`${AC[7]} a planted chain kept under the old key (--planted mips_kept_under_old_key) stays gray after the change and fails, naming the level`, () => {
    requireGpu();
    failsNaming(mipsProblems('mips_kept_under_old_key'), ['level 3 after the change'], 'the planted mips_kept_under_old_key');
  }, 1_800_000);
});
