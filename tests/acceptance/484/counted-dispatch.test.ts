// #484.ca2dfa6e: "A compute operator dispatched by a count: with elements {from: the cull's count output, max:
// 1,048,576} after a compact that keeps 300,017 of 1,000,003 elements, its output equals the CPU's on rows 0 to 300,016
// and keeps the sentinel 0xFFFFFFFF in every row after; the check costs it at 1,048,576 elements; and a planted dispatch
// that runs max invocations without the count's guard writes row 300,017 and fails, naming the row"
//
// One `check_operator` frame of two operators (#483's `operators`, `data` and `read`):
//
//   cull    compact@1 over the values `vals` by the flags `flags`, both 1,000,003 words of `data`; outputs `kept` from
//           c.out and `count` from c.count
//   worker  elements {from: 'cull.count', max: 1,048,576}, workgroup 256, reading `kept`; each invocation e writes
//           out[e] = (kept[e] × 2,654,435,761 mod 2³²) << 1 into `out`, 1,048,576 words declared with clear 0xFFFFFFFF
//
// The flags set row i when (i × 7,919 mod 1,000,003) < 300,017: 1,000,003 is prime, so i ↦ i × 7,919 is a bijection and
// exactly 300,017 flags are set, scattered. The values are the row numbers, so `kept` is the flagged rows in order. The
// CPU's output is the same formula, computed here on those rows. It is always even, so a write past the count can never
// hide as the sentinel, whatever a guardless invocation reads.
//
// The count's 300,017 isn't a multiple of the workgroup's 256, so the last workgroup holds invocations past the count,
// which must write nothing: row 300,017 falls inside that workgroup (1,171 × 256 = 299,776; 1,172 × 256 = 300,032).
// The check's reply gives `costed_elements`, the elements it costs each compute operator at: `worker`'s must be
// 1,048,576, and `cull`'s fixed 1,000,003 is the control. `--planted dispatch_without_guard` runs max invocations
// without the guard and fails naming row 300,017.
import { describe, expect, it } from 'vitest';
import {
  AC, accepted, compute, failsNaming, isObject, none, obj, requireGpu, run, shown, step, storage, u32, u32File, useGpu, useOut, writeU32,
  type JsonObject, type Planted,
} from './helpers.ts';

const bin = useGpu();
const dir = useOut();
const M = 1_000_003;
const KEPT = 300_017;
const MAX = 1_048_576;
const SENTINEL = 0xffffffff;
const K = 2_654_435_761;

const flagged = (i: number): boolean => (i * 7919) % M < KEPT;
const cpuOut = (v: number): number => (Math.imul(v, K) << 1) >>> 0;

const CULL = compute('cull', { c: step('compact@1', { in: 'vals', flag: 'flags', count: M }) }, {
  kept: { storage: { type: 'u32', count: M }, from: 'c.out' },
  count: { storage: { type: 'u32', count: 1 }, from: 'c.count' },
}, { inputs: { vals: storage('u32', M, 'core', 'vals'), flags: storage('bool', M, 'core', 'flags') } }, M);

const WORKER: JsonObject = compute('worker', {
  e: step('element@1'), v: step('read@1', { buf: 'kept', i: 'e' }), k: u32(K), one: u32(1),
  m: step('mul@1', { a: 'v', b: 'k' }), s: step('shl@1', { a: 'm', b: 'one' }), w: step('write@1', { buf: 'out', i: 'e', v: 's' }),
}, { out: { storage: { type: 'u32', count: MAX, clear: SENTINEL } } }, { inputs: { kept: storage('u32', M, 'cull', 'kept') }, after: ['cull'] }, { from: 'cull.count', max: MAX });

interface Result { problems: string[]; costed: JsonObject }
function dispatched(planted?: Planted): Result {
  const out = dir();
  const flags = Uint32Array.from({ length: M }, (_, i) => (flagged(i) ? 1 : 0));
  const vals = Uint32Array.from({ length: M }, (_, i) => i);
  const data = { vals: writeU32(out, 'vals', vals), flags: writeU32(out, 'flags', flags) };
  const [reply] = run(bin(), out, [{ call: 'check_operator', operators: [CULL, WORKER], data, read: ['cull.kept', 'cull.count', 'worker.out'] }], planted);
  const frame = accepted(reply!, 'the frame');
  const dispatch = obj((frame['dispatches'] as JsonObject[] | undefined)?.[0], 'the frame\'s dispatch');
  const read = obj(dispatch['read'], 'the dispatch\'s reads');
  const words = (key: string): Uint32Array => u32File(out, obj(read[key], key)['file'] as string, key);
  const kept = words('cull.kept');
  const rows = words('worker.out');
  const problems: string[] = [];
  const count = words('cull.count')[0];
  if (count !== KEPT) problems.push(`the compact keeps ${String(count)} elements, not ${KEPT}`);
  if (rows.length !== MAX) problems.push(`the output holds ${rows.length} rows, not ${MAX}`);
  const want = Uint32Array.from({ length: M }, (_, i) => i).filter(flagged);
  expect(want.length, 'exactly 300,017 flags are set').toBe(KEPT);
  for (let r = 0; r < KEPT && problems.length < 5; r++) {
    if (kept[r] !== want[r]) problems.push(`the compact's row ${r} holds ${String(kept[r])}, the CPU's ${want[r]!}`);
    if (rows[r] !== cpuOut(want[r]!)) problems.push(`row ${r}: the output holds ${String(rows[r])}, the CPU's ${cpuOut(want[r]!)}`);
  }
  for (let r = KEPT, n = 0; r < MAX && n < 5; r++) {
    if (rows[r] !== SENTINEL) { problems.push(`row ${r}: the output holds ${String(rows[r])}, past the count, not the sentinel 0xFFFFFFFF`); n++; }
  }
  return { problems, costed: isObject(frame['costed_elements']) ? frame['costed_elements'] : {} };
}

describe(`${AC[4]} a compute operator dispatched by a count`, () => {
  it(`${AC[4]} with elements {from: the cull's count output, max: 1,048,576} after a compact keeping 300,017 of 1,000,003, its output equals the CPU's on rows 0 to 300,016, keeps the sentinel in every row after, and the check costs it at 1,048,576 elements`, () => {
    requireGpu();
    const { problems, costed } = dispatched();
    none(problems, 'the counted dispatch');
    expect(costed['worker'], `the check costs worker at its max: ${shown(costed)}`).toBe(MAX);
    expect(costed['cull'], `the check costs cull at its fixed elements: ${shown(costed)}`).toBe(M);
  }, 3_600_000);

  it(`${AC[4]} a planted dispatch that runs max invocations without the count's guard (--planted dispatch_without_guard) writes row 300,017 and fails, naming the row`, () => {
    requireGpu();
    failsNaming(dispatched('dispatch_without_guard').problems, [`row ${KEPT}: the output holds`], '--planted dispatch_without_guard');
  }, 3_600_000);
});
