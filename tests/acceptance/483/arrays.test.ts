// #483.67c08cd2: "Small arrays: a median-of-nine pass written with array<f32, 9> and a sorting network matches a CPU
// median within one 10-bit code value on 99.9% of pixels on one machine; index(a, 20) on an array of 9 returns
// element 8; and a planted index that wraps returns element 2 and fails, naming the operator"
//
// The median is `helpers.ts: medianPass` (nine `with` copies into an array<f32, 9>, Devillard's 19 compare-exchanges
// of `index`, `min`, `max` and `with`, then `index(a, 4)`) over `helpers.ts: noisyFixture` (a ramp and a disc with
// 8% salt and pepper), given as `data.color`; `median.color`'s red is held to `median9` (the CPU median of the same
// f32 values, edges clamped) within 1/1023 on 99.9% of 512 × 512 pixels. The index: `pick`, a compute operator,
// reads i from storage (so the check can't fold it) and writes index(a, i) for a = [100, 101, …, 108]; i = 20,
// 2, 8 and 4,294,967,295 give 108, 102, 108 and 108 (clamped into [0, 8]). The planted index_wraps takes i mod 9,
// so i = 20 returns element 2 (102), and the failure names `pick`. At the base there is no `with` step and no data
// or read on check_operator.
import { describe, expect, it } from 'vitest';
import {
  AC, compute, coreStorage, f32File, failsNaming, frameCall, grayRgba, median9, medianPass, noisyFixture, ran, readAt, reds, requireGpu, run, step, u32File,
  useBins, useOut, within, writeRgba, writeU32, type Planted,
} from './helpers.ts';

const bins = useBins();
const out = useOut();
const N = 512;
const IDX = new Uint32Array([20, 2, 8, 4294967295]);
const PICK = compute('pick', {
  e: step('element@1'), a: { op: 'const@1', args: { value: [100, 101, 102, 103, 104, 105, 106, 107, 108], type: 'array<u32, 9>' } },
  i: step('read@1', { buf: 'idx', i: 'e' }), v: step('index@1', { a: 'a', i: 'i' }), w: step('write@1', { buf: 'out', i: 'e', v: 'v' }),
}, { out: { storage: { type: 'u32', count: 4 } } }, { inputs: { idx: coreStorage('u32', 4, 'idx') } }, 4);

function indexProblems(planted?: Planted): string[] {
  const dir = out();
  const r = ran(run(bins.bin(), dir, [frameCall({ operators: [PICK], data: { idx: writeU32(dir, 'idx', IDX) }, read: ['pick.out'] })], planted)[0]!, 'pick');
  const got = u32File(dir, readAt(r, 0, 'pick.out', 'pick').file, 'pick.out');
  const problems: string[] = [];
  IDX.forEach((i, e) => {
    const want = 100 + Math.min(8, i);
    if (got[e] !== want) problems.push(`pick: index(a, ${i}) on an array of 9 returned element ${got[e]! - 100} (${got[e]}), not element ${want - 100} (${want})`);
  });
  return problems;
}

describe(`${AC[5]} small arrays`, () => {
  it(`${AC[5]} a median of nine with array<f32, 9> and a sorting network matches the CPU median within one 10-bit code on 99.9% of pixels; index(a, 20) on an array of 9 returns element 8`, () => {
    requireGpu();
    const dir = out();
    const img = noisyFixture();
    const r = ran(run(bins.bin(), dir, [frameCall({ operators: [medianPass('median', N - 1)], data: { color: writeRgba(dir, 'noisy', grayRgba(img)) }, size: [N, N], read: ['median.color'] })])[0]!, 'the median pass');
    const got = reds(f32File(dir, readAt(r, 0, 'median.color', 'median').file, 'median.color'));
    expect(got.length, `${N} × ${N} pixels`).toBe(N * N);
    const w = within(got, median9(img, N, N), N, 1 / 1023);
    console.log(`${AC[5]}: ${(w.share * 100).toFixed(3)}% of pixels within one 10-bit code of the CPU median`);
    expect(w.share, `within one 10-bit code of the CPU median on 99.9% of pixels; the first outside: ${w.first ?? 'none'}`).toBeGreaterThanOrEqual(0.999);
    expect(indexProblems(), 'index clamps into the array').toEqual([]);
  }, 1_800_000);

  it(`${AC[5]} a planted index that wraps (--planted index_wraps) returns element 2 for index(a, 20) and fails, naming the operator`, () => {
    requireGpu();
    failsNaming(indexProblems('index_wraps'), ['pick: index(a, 20) on an array of 9 returned element 2'], 'the planted index_wraps');
  }, 1_800_000);
});
