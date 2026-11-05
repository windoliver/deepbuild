// #483.c832ba9c: "3D textures: a compute operator fills a 128³ r32float density and a pass in the same frame samples
// it; a pass that reads it in the next frame is refused at check, naming the input; and a 256³ rgba8unorm texture
// (64 MB) in a figure, whose operator storage is 32 MB, is refused with over_budget naming the operator"
//
// `density` writes d(x, y, z) = (x + 2y + 3z) ÷ 1024 into its texture3d output `vol` {r32float, [128, 128, 128]}.
// 128³ texels are twice a dispatch's 1,048,576 elements, so element e stores its own two slots, the texels 2e and
// 2e + 1 in x-fastest order (the write rule's k × element + j), with `store@1` given a vec3 index. In the same
// check_operator frame, `show` (128 × 128) reads `vol` as a `texture3d` input: its red is sample3d at the centre of
// each texel of slice 37, its green load3d of slice 101; both are held to d within one 10-bit code at every pixel.
// `later` reads `vol` with `frame: previous` (README: the smallest way to write a read of the next frame) and is
// refused at check with an error at `inputs/vol`. Then two `live` sessions of a figure (operator storage 32 MB):
// one whose `fill` writes a 128³ rgba8unorm texture (8 MB) is live, the control; one whose `big3d` writes 256³
// (64 MB) is refused with over_budget naming big3d. Each writes one texel (a dispatch of one element), so neither
// comes near the class's GPU time. At the base there is no texture3d output, input, store, load3d or sample3d.
import { describe, expect, it } from 'vitest';
import {
  AC, FRAME_COLOR, WRITER, asItem, checked, compute, errors, f32File, figure, frameCall, liveCall, liveReply, pass, payload, ran, readAt, requireGpu, run,
  run1, sessionRow, shown, step, useBins, useOut, withEstimates, writeJson, type JsonObject,
} from './helpers.ts';

const bins = useBins();
const out = useOut();
const S = 128;

const DENSITY = compute('density', {
  e: step('element@1'), l0: step('mul@1', { a: 'e', b: 2 }),
  x0: step('and@1', { a: 'l0', b: 127 }), yy: step('shr@1', { a: 'l0', b: 7 }), y: step('and@1', { a: 'yy', b: 127 }), z: step('shr@1', { a: 'l0', b: 14 }),
  x1: step('add@1', { a: 'x0', b: 1 }), y2: step('mul@1', { a: 'y', b: 2 }), z3: step('mul@1', { a: 'z', b: 3 }),
  s0: step('add@1', { a: 'x0', b: 'y2' }), s: step('add@1', { a: 's0', b: 'z3' }), s1: step('add@1', { a: 's', b: 1 }),
  f0: { op: 'convert@1', args: { x: 's', to: 'f32' } }, f1: { op: 'convert@1', args: { x: 's1', to: 'f32' } },
  d0: step('div@1', { a: 'f0', b: 1024 }), d1: step('div@1', { a: 'f1', b: 1024 }),
  p0: step('compose@1', { x: 'x0', y: 'y', z: 'z' }), p1: step('compose@1', { x: 'x1', y: 'y', z: 'z' }),
  st0: step('store@1', { tex: 'vol', ixy: 'p0', v: 'd0' }), st1: step('store@1', { tex: 'vol', ixy: 'p1', v: 'd1' }),
}, { vol: { texture3d: { format: 'r32float', size: [S, S, S] } } }, {}, 1_048_576);
const vol = (extra: JsonObject = {}): JsonObject => ({ type: 'texture3d', from: { texture3d: { op: 'density', output: 'vol', ...extra } } });
const SHOW = pass('show', {
  px: step('pixel@1'), pf: { op: 'convert@1', args: { x: 'px', to: 'vec2<f32>' } }, h: step('add@1', { a: 'pf', b: 0.5 }), uv: step('div@1', { a: 'h', b: S }),
  u: { op: 'split@1', args: { x: 'uv', pick: 'x' } }, v: { op: 'split@1', args: { x: 'uv', pick: 'y' } }, uvw: step('compose@1', { x: 'u', y: 'v', z: 37.5 / S }),
  sm: step('sample3d@1', { tex: 'vol', uvw: 'uvw' }), sr: { op: 'split@1', args: { x: 'sm', pick: 'x' } },
  ix: { op: 'split@1', args: { x: 'px', pick: 'x' } }, iy: { op: 'split@1', args: { x: 'px', pick: 'y' } }, p3: step('compose@1', { x: 'ix', y: 'iy', z: 101 }),
  ld: step('load3d@1', { tex: 'vol', ixyz: 'p3' }), lr: { op: 'split@1', args: { x: 'ld', pick: 'x' } },
  out: step('compose@1', { x: 'sr', y: 'lr', z: 0, w: 1 }),
}, { inputs: { src: FRAME_COLOR, vol: vol() } });
const LATER = pass('later', {
  px: step('pixel@1'), pf: { op: 'convert@1', args: { x: 'px', to: 'vec2<f32>' } }, uv: step('div@1', { a: 'pf', b: S }),
  u: { op: 'split@1', args: { x: 'uv', pick: 'x' } }, v: { op: 'split@1', args: { x: 'uv', pick: 'y' } }, uvw: step('compose@1', { x: 'u', y: 'v', z: 0.5 }),
  sm: step('sample3d@1', { tex: 'vol', uvw: 'uvw' }), out: step('mul@1', { a: 'sm', b: 1 }),
}, { inputs: { src: FRAME_COLOR, vol: vol({ frame: 'previous' }) } });
/** A compute operator of one element writing one texel of an n³ rgba8unorm texture3d. */
const oneTexel = (id: string, n: number): JsonObject => compute(id, {
  p: { op: 'const@1', args: { value: [0, 0, 0], type: 'vec3<u32>' } }, c: { op: 'const@1', args: { value: [1, 1, 1, 1], type: 'vec4' } },
  st: step('store@1', { tex: 'vol', ixy: 'p', v: 'c' }),
}, { vol: { texture3d: { format: 'rgba8unorm', size: [n, n, n] } } }, {}, 1);

describe(`${AC[6]} 3D textures`, () => {
  it(`${AC[6]} a 128³ r32float density is sampled in the same frame; read in the next frame it is refused naming the input; 256³ rgba8unorm in a figure is refused with over_budget naming the operator`, () => {
    requireGpu();
    const dir = out();
    const [same, next] = run(bins.bin(), dir, [
      frameCall({ operators: [DENSITY, SHOW], size: [S, S], read: ['show.color'] }),
      frameCall({ operators: [DENSITY, LATER], size: [S, S] }),
    ]);
    const px = f32File(dir, readAt(ran(same!, 'density then show'), 0, 'show.color', 'show').file, 'show.color');
    expect(px.length, `${S} × ${S} RGBA pixels`).toBe(S * S * 4);
    const problems: string[] = [];
    for (let y = 0; y < S && problems.length < 5; y++) for (let x = 0; x < S && problems.length < 5; x++) {
      const i = (y * S + x) * 4;
      const [a, b] = [(x + 2 * y + 3 * 37) / 1024, (x + 2 * y + 3 * 101) / 1024];
      if (Math.abs(px[i]! - a) > 1 / 1023) problems.push(`pixel (${x}, ${y}): sample3d of slice 37 reads ${px[i]!.toFixed(5)}, the density ${a.toFixed(5)}`);
      if (Math.abs(px[i + 1]! - b) > 1 / 1023) problems.push(`pixel (${x}, ${y}): load3d of slice 101 reads ${px[i + 1]!.toFixed(5)}, the density ${b.toFixed(5)}`);
    }
    expect(problems, 'the pass reads the density the compute operator wrote this frame').toEqual([]);
    const later = checked(next!, 'a pass reading vol in the next frame');
    expect(later.outcome, 'a read of the 3D texture in the next frame is refused at check').toBe('refused');
    expect(errors(later).some((e) => String(e['path'] ?? '').endsWith('inputs/vol')), `an error names the input inputs/vol: ${shown(later.issues)}`).toBe(true);

    const [fill, big] = withEstimates(bins.bin(), out(), [oneTexel('fill', 128), oneTexel('big3d', 256)]);
    const docs = { small: figure('small3d-483', { fill: asItem(fill!) }), large: figure('big3d-483', { big3d: asItem(big!) }) };
    const live = liveReply(run1(bins.bin(), out(), liveCall({
      frames: 2, sessions: Object.entries(docs).map(([s, d]) => ({ session: s, writer: WRITER, doc: writeJson(dir, `${s}.json`, payload(d)), size: [128, 64] })),
    })));
    expect(sessionRow(live, 'small')['state'], `a 128³ rgba8unorm texture (8 MB) fits the figure's 32 MB: ${shown(sessionRow(live, 'small'))}`).toBe('live');
    const row = sessionRow(live, 'large');
    expect(row['state'], `the 256³ rgba8unorm texture (64 MB) in a figure is refused: ${shown(row)}`).toBe('refused');
    const issues = (row['issues'] as JsonObject[] | undefined) ?? [];
    expect(issues.some((i) => i['code'] === 'over_budget' && JSON.stringify(i).includes('big3d')), `refused with over_budget naming big3d: ${shown(row)}`).toBe(true);
  }, 1_800_000);
});
