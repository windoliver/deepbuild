// #483.dadc80dd: "With the GPU layer's target pool first filled with a marker value, a producer that discards half its
// pixels feeds a consumer that reads only the clear value where nothing was written; a planted pool without a clear
// shows the marker and fails, naming the target"
//
// check_operator on the `test-meter` build with the test hook `pool_marker: [0.75, 0.75, 0.75, 0.75]`: every target
// the GPU layer's pool hands out for the frame starts filled with the marker (README). `prod`, a compute operator
// over 64 × 64 elements, writes (1, 0.5, 0.25, 1) into its rgba16float texture output `tex` at its own texel, its
// store under `when: keep`, so the right half (x ≥ 32) is never written: it discards half its pixels. `cons`, a pass
// at 64 × 64, loads `prod.tex` at each pixel. Read back, `cons.color` is (1, 0.5, 0.25, 1) on the left half and the
// declared clear value, 0 in every channel (no output here declares another), on the right. The planted
// pool_without_clear hands the target out as the pool left it: the right half shows the marker and the failure names
// prod.tex. At the base there is no texture output, store step or hook.
import { describe, expect, it } from 'vitest';
import { AC, compute, f32File, failsNaming, frameCall, pass, ran, readAt, requireGpu, run, step, useBins, useOut, type Planted } from './helpers.ts';

const bins = useBins(['test-meter']);
const out = useOut();
const S = 64;
const MARKER = [0.75, 0.75, 0.75, 0.75];
const WRITTEN = [1, 0.5, 0.25, 1];

const PROD = compute('prod', {
  e: step('element@1'), x: step('and@1', { a: 'e', b: S - 1 }), y: step('shr@1', { a: 'e', b: 6 }), keep: step('lt@1', { a: 'x', b: S / 2 }),
  p: step('compose@1', { x: 'x', y: 'y' }), c: { op: 'const@1', args: { value: WRITTEN, type: 'vec4' } },
  st: { op: 'store@1', args: { tex: 'tex', ixy: 'p', v: 'c' }, when: 'keep' },
}, { tex: { texture: { format: 'rgba16float', size: [S, S] } } }, {}, S * S);
const CONS = pass('cons', { px: step('pixel@1'), out: step('load@1', { tex: 'prod_tex', ixy: 'px' }) },
  { inputs: { prod_tex: { type: 'texture', from: { texture: { target: { op: 'prod', output: 'tex' } } } } } });

function poolProblems(planted?: Planted): string[] {
  const dir = out();
  const r = ran(run(bins.bin('test-meter'), dir, [frameCall({ operators: [PROD, CONS], size: [S, S], read: ['cons.color'], pool_marker: MARKER })], planted)[0]!, 'prod then cons');
  const px = f32File(dir, readAt(r, 0, 'cons.color', 'cons').file, 'cons.color');
  expect(px.length, `${S} × ${S} RGBA pixels`).toBe(S * S * 4);
  const problems: string[] = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const got = Array.from(px.subarray((y * S + x) * 4, (y * S + x) * 4 + 4));
    const want = x < S / 2 ? WRITTEN : [0, 0, 0, 0];
    if (got.some((g, c) => Math.abs(g - want[c]!) > 1e-3)) {
      const marker = got.every((g, c) => Math.abs(g - MARKER[c]!) <= 1e-3);
      problems.push(`target prod.tex: pixel (${x}, ${y}) reads (${got.join(', ')})${marker ? ', the pool\'s marker,' : ''} where ${x < S / 2 ? 'prod wrote' : 'nothing was written, not the clear value'} (${want.join(', ')})`);
      return problems;
    }
  }
  return problems;
}

describe(`${AC[8]} unwritten texels read the clear value`, () => {
  it(`${AC[8]} with the pool filled with a marker, the consumer reads the producer's pixels where it wrote and the clear value where it discarded`, () => {
    requireGpu();
    expect(poolProblems(), 'each pixel of cons').toEqual([]);
  }, 1_800_000);

  it(`${AC[8]} a planted pool without a clear (--planted pool_without_clear) shows the marker and fails, naming the target`, () => {
    requireGpu();
    failsNaming(poolProblems('pool_without_clear'), ['target prod.tex', 'the pool\'s marker'], 'the planted pool_without_clear');
  }, 1_800_000);
});
