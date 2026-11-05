// #483.c7526ca0: "Scan and compact: scan(add) over 1,048,576 and over 1,000,003 u32 values equals the CPU's exclusive
// prefix sum bit for bit, wrapping at 2³²; compact over 1,000,003 elements with 30% of the flags set keeps the
// flagged elements in index order, with the CPU's count; and a planted compact that appends by an atomic counter's
// returned value fails, naming the first index out of order"
//
// `scan`: one step `scan@1 {in: xs, op: add}` (`op` a literal field), its storage output taking the step's result;
// `compact`: one step `compact@1 {in: vals, flag: flags, count}`, its outputs `kept` from `c.out` and `n` (one word)
// from `c.count`; every input given as check_operator `data` (bools as one 32-bit word each, 0 or 1) and each output
// read back (README). The scanned values are full-range u32 words from mulberry32 (seeds 4833 and 4834), so the sums
// wrap many times; the CPU's sum wraps with `>>> 0` (`helpers.ts: exclusiveScan`). Each scan runs twice, and both
// dispatches must equal the CPU's, the run-to-run half of the oracle. The compacted values are the indices, so
// `kept` must be exactly the flagged indices in increasing order, `n` their count; elements past `n` aren't read.
// Oracle (run on our code): CUB's catch2_test_device_scan.cu and catch2_test_device_scan_deterministic.cu (an
// exclusive sum against a host reference, bit-reproducible run to run) and catch2_test_device_select_flagged.cu
// (flagged items kept in index order with the right count), cccl 28101b0741: those checks, made on our output.
// At the base there is no scan or compact step.
import { describe, expect, it } from 'vitest';
import {
  AC, compute, coreStorage, exclusiveScan, failsNaming, firstDiff, frameCall, ran, readAt, requireGpu, rng, run, u32File, unit, useBins, useOut, writeU32,
  type Planted,
} from './helpers.ts';

const bins = useBins();
const out = useOut();
const N = 1_048_576;
const M = 1_000_003;

const words = (n: number, seed: number): Uint32Array => { const r = rng(seed); return Uint32Array.from({ length: n }, () => r()); };
const scanOp = (count: number) => compute('scan', { sc: { op: 'scan@1', args: { in: 'xs', op: 'add' } } },
  { out: { storage: { type: 'u32', count }, from: 'sc' } }, { inputs: { xs: coreStorage('u32', count, 'xs') } }, count);
const compactOp = (count: number) => compute('compact', { c: { op: 'compact@1', args: { in: 'vals', flag: 'flags', count } } },
  { kept: { storage: { type: 'u32', count }, from: 'c.out' }, n: { storage: { type: 'u32', count: 1 }, from: 'c.count' } },
  { inputs: { vals: coreStorage('u32', count, 'vals'), flags: coreStorage('bool', count, 'flags') } }, count);
function flagsOf(n: number): Uint32Array { const r = rng(4836); return Uint32Array.from({ length: n }, () => (unit(r) < 0.3 ? 1 : 0)); }

function compactProblems(planted?: Planted): string[] {
  const dir = out();
  const flags = flagsOf(M);
  const want = Uint32Array.from([...flags.keys()].filter((i) => flags[i] === 1));
  expect(Math.abs(want.length / M - 0.3), 'about 30% of the flags are set').toBeLessThan(0.005);
  const vals = Uint32Array.from({ length: M }, (_, i) => i);
  const r = ran(run(bins.bin(), dir, [frameCall({ operators: [compactOp(M)], data: { vals: writeU32(dir, 'vals', vals), flags: writeU32(dir, 'flags', flags) }, read: ['compact.kept', 'compact.n'] })], planted)[0]!, 'the compact');
  const kept = u32File(dir, readAt(r, 0, 'compact.kept', 'compact').file, 'compact.kept');
  const n = u32File(dir, readAt(r, 0, 'compact.n', 'compact').file, 'compact.n')[0];
  const problems: string[] = [];
  if (n !== want.length) problems.push(`compact: count ${String(n)}, the CPU's ${want.length}`);
  const i = firstDiff(kept, want, want.length);
  if (i >= 0) problems.push(`compact: the first index out of order is output ${i}: it holds element ${kept[i]}, the CPU's ${want[i]}`);
  return problems;
}

describe(`${AC[4]} scan and compact are exact`, () => {
  it(`${AC[4]} scan(add) over 1,048,576 and 1,000,003 u32 values equals the CPU's wrapping exclusive prefix sum bit for bit, twice; compact keeps the 30% flagged of 1,000,003 in index order with the CPU's count`, () => {
    requireGpu();
    const dir = out();
    const inputs = [words(N, 4833), words(M, 4834)];
    const replies = run(bins.bin(), dir, inputs.map((xs, k) => frameCall({ operators: [scanOp(xs.length)], data: { xs: writeU32(dir, `xs${k}`, xs) }, repeat: 2, read: ['scan.out'] })));
    const problems: string[] = [];
    inputs.forEach((xs, k) => {
      const want = exclusiveScan(xs);
      const r = ran(replies[k]!, `the scan of ${xs.length}`);
      for (let d = 0; d < 2; d++) {
        const got = u32File(dir, readAt(r, d, 'scan.out', `scan of ${xs.length}`).file, `scan of ${xs.length}, dispatch ${d}`);
        const i = got.length === xs.length ? firstDiff(got, want) : 0;
        if (i >= 0) problems.push(`scan of ${xs.length}, dispatch ${d}: output ${i} is ${got[i]}, the CPU's ${want[i]} (${got.length} outputs)`);
      }
    });
    expect(problems, 'each scan, each dispatch').toEqual([]);
    expect(compactProblems(), 'the compact').toEqual([]);
  }, 3_600_000);

  it(`${AC[4]} a planted compact that appends by an atomic counter's returned value (--planted compact_by_atomic) fails, naming the first index out of order`, () => {
    requireGpu();
    failsNaming(compactProblems('compact_by_atomic'), ['the first index out of order is output'], 'the planted compact_by_atomic');
  }, 3_600_000);
});
