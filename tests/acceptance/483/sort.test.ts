// #483.2a6f04d8: "A stable sort: 1,048,576 keys drawn from a fixed seed with 10% duplicates, and 1,000,003 equal keys
// (a count no workgroup size divides), each sort to one output hash on an M1 and an M3 over 20 repeated dispatches,
// equal to a CPU stable sort's with equal keys in increasing index; a planted sort that breaks ties by decreasing
// index fails on the equal keys at output 0, naming the first index out of order"
//
// `sort`, a compute operator whose one step is `sort_by_key@1 {keys, values, count}`, its storage output `sorted`
// taking the step's result (`from: s`), the keys and values given as check_operator `data` and `sorted` read back
// after each of 20 dispatches (`repeat: 20`, README). The values are the indices 0 … n − 1, so the output is the
// permutation, and a CPU stable sort of (key, index) (`helpers.ts: stableOrder`) gives the expected one, equal keys
// in increasing index. The random keys come from mulberry32 seeded 4832: each key repeats an earlier one with
// probability 0.1, else it is a fresh u32. Over 20 dispatches each fixture has exactly one output hash (the
// SHA-256 of its words), the CPU's. That holds here, on one GPU; the M1-and-M3 half reads a second Mac's record
// (this test's own, written there into DEEPBUILD_EVIDENCE_DIR) named by DEEPBUILD_SECOND_GPU_RECORD_483, and
// without it fails as BLOCKED with one ask. Oracle (run on our code): CUB's catch2_test_device_radix_sort_pairs.cu
// (cccl 28101b0741) requires key-value pairs sorted equal to std::stable_sort's, including a large array whose
// pair order must be stable; that is this comparison, made on our output. At the base there is no sort_by_key step.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, blocked, chipName, compute, coreStorage, failsNaming, familyOf, firstDiff, frameCall, ran, readAt, requireGpu, rng, run, sha256, stableOrder, step,
  u32File, useBins, useOut, writeU32, type Planted,
} from './helpers.ts';

const bins = useBins();
const out = useOut();
const N = 1_048_576;
const M = 1_000_003;

function randomKeys(): Uint32Array {
  const r = rng(4832);
  const k = new Uint32Array(N);
  for (let i = 0; i < N; i++) k[i] = i > 0 && r() / 4294967296 < 0.1 ? k[r() % i]! : r();
  return k;
}
const KEYS = { random: randomKeys(), equal: new Uint32Array(M).fill(42) };
const iota = (n: number): Uint32Array => Uint32Array.from({ length: n }, (_, i) => i);
const sortOp = (count: number) => compute('sort', { s: step('sort_by_key@1', { keys: 'keys', values: 'vals', count }) },
  { sorted: { storage: { type: 'u32', count }, from: 's' } }, { inputs: { keys: coreStorage('u32', count, 'keys'), vals: coreStorage('u32', count, 'vals') } }, count);
const bytes = (w: Uint32Array): Buffer => Buffer.from(w.buffer, w.byteOffset, w.byteLength);

/** Each fixture sorted `repeat` times: the problems, naming the fixture and the first index out of order, and its hashes. */
function sorts(repeat: number, planted?: Planted, which: (keyof typeof KEYS)[] = ['random', 'equal']): { problems: string[]; hashes: Record<string, string> } {
  const dir = out();
  const problems: string[] = [];
  const hashes: Record<string, string> = {};
  const calls = which.map((name) => {
    const keys = KEYS[name];
    return frameCall({ operators: [sortOp(keys.length)], data: { keys: writeU32(dir, `${name}-keys`, keys), vals: writeU32(dir, `${name}-vals`, iota(keys.length)) }, repeat, read: ['sort.sorted'] });
  });
  const replies = run(bins.bin(), dir, calls, planted);
  which.forEach((name, n) => {
    const keys = KEYS[name];
    const want = stableOrder(keys);
    const r = ran(replies[n]!, `the ${name} keys' sort`);
    expect(r.dispatches.length, `${name}: ${repeat} dispatches`).toBe(repeat);
    const seen = new Set<string>();
    for (let d = 0; d < repeat; d++) {
      const read = readAt(r, d, 'sort.sorted', name);
      if (seen.has(read.file)) continue;
      seen.add(read.file);
      const got = u32File(dir, read.file, `${name}: dispatch ${d}`);
      if (got.length !== keys.length) { problems.push(`${name} keys, dispatch ${d}: ${got.length} outputs, not ${keys.length}`); continue; }
      const i = firstDiff(got, want);
      if (i >= 0) problems.push(`${name} keys, dispatch ${d}: the first index out of order is output ${i}: it holds index ${got[i]}, the CPU stable sort's ${want[i]}`);
    }
    if (seen.size !== 1) problems.push(`${name} keys: ${seen.size} output hashes over ${repeat} dispatches, not one`);
    hashes[name] = [...seen][0] ?? '';
    if (seen.size === 1 && hashes[name] !== sha256(bytes(want))) problems.push(`${name} keys: the output hash ${hashes[name]} isn't the CPU stable sort's ${sha256(bytes(want))}`);
  });
  return { problems, hashes };
}
const RECORD = (family: string): string => join(process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-483-evidence'), `sort-483-${family}.json`);

describe(`${AC[3]} sort_by_key is stable and gives one hash`, () => {
  it(`${AC[3]} on this GPU, 1,048,576 seeded keys with 10% duplicates and 1,000,003 equal keys each sort to one hash over 20 dispatches, the CPU stable sort's`, () => {
    requireGpu();
    expect(KEYS.random.length - new Set(KEYS.random).size, 'the random fixture repeats about 10% of its keys').toBeGreaterThan(0.08 * N);
    const { problems, hashes } = sorts(20);
    expect(problems, 'each fixture over 20 dispatches').toEqual([]);
    const chip = chipName();
    const path = RECORD(familyOf(chip));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ criterion: AC[3], chip, family: familyOf(chip), hashes }));
    console.log(`${AC[3]}: this GPU's record (${chip}): ${path}`);
  }, 3_600_000);

  it(`${AC[3]} a planted sort that breaks ties by decreasing index (--planted sort_ties_decreasing) fails on the equal keys at output 0, naming the first index out of order`, () => {
    requireGpu();
    const { problems } = sorts(1, 'sort_ties_decreasing', ['equal']);
    failsNaming(problems, ['equal keys', 'the first index out of order is output 0'], 'the planted sort_ties_decreasing');
  }, 3_600_000);

  it(`${AC[3]} an M1 and an M3 give the same output hashes`, () => {
    requireGpu();
    const chip = chipName();
    const { problems, hashes } = sorts(1);
    expect(problems, 'this GPU\'s sorts').toEqual([]);
    const here = /\bM1\b/.test(chip) ? 'M1' : /\bM3\b/.test(chip) ? 'M3' : null;
    const missing = here === 'M1' ? 'an M3' : here === 'M3' ? 'an M1' : 'an M1 or an M3';
    const other = process.env['DEEPBUILD_SECOND_GPU_RECORD_483'];
    if (!other || !existsSync(other)) {
      blocked(`the two-GPU half needs ${missing}'s record (this is ${chip}): run this file on ${missing} and name the sort-483-<family>.json it writes into DEEPBUILD_EVIDENCE_DIR in DEEPBUILD_SECOND_GPU_RECORD_483`);
    }
    const rec = JSON.parse(readFileSync(other, 'utf8')) as { criterion?: string; chip?: string; family?: string; hashes?: Record<string, string> };
    expect(rec.criterion, 'the record is this criterion\'s').toBe(AC[3]);
    expect([here, /\bM1\b/.test(rec.chip ?? '') ? 'M1' : /\bM3\b/.test(rec.chip ?? '') ? 'M3' : null].sort(), `one record from an M1 and one from an M3 (here ${chip}, there ${rec.chip ?? 'unnamed'})`).toEqual(['M1', 'M3']);
    expect(rec.hashes, `the ${rec.chip ?? 'other'}'s hashes equal this GPU's`).toEqual(hashes);
  }, 3_600_000);
});
