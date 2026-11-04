// #429.3eb19699: every public step matches its CPU reference within one 10-bit code value per channel on 99.9% of
// pixels on the same machine, and exact steps (integer, bool and bit operations only, floats carried as bits) match
// bit for bit on two GPUs, and with one GPU that comparison is BLOCKED with one unblock ask naming the missing GPU,
// never skipped; an operator that calls itself exact but uses any f32 operation is refused with not_exact.
//
// Calls (README): `op_table` lists gpu.step@1's entries; `steps_reference` runs every public step on this GPU and
// through the step graph's CPU interpreter over a grid of seeded inputs, writing both results as .f32 files;
// #380's `exact` record gains `steps` (every exact public step's output bits on its exactness fixture) and
// `cross_gpu` compares records, BLOCKED with one ask whose `gpu` names the missing family when only one is given.
// A code here is 1/1023 of max(1, |reference|), so a result in [0, 1] is held to one 10-bit display code and a
// larger one to the same relative step. The real two-GPU run needs a record made on a GPU of another family,
// named by DEEPBUILD_SECOND_GPU_RECORD; without it that test fails as BLOCKED with the ask, never passing.
// Oracle: the WebGPU CTS expression families this criterion links are ported against our `op` call in
// tests/acceptance/380/cts-exact.test.ts; wgpu's cts_runner/test.lst is wgpu's own suite and runs in its repo.
// At the base there is no op_table or steps_reference call, and the exact record holds no steps.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHA, answered, blocked, checkCall, checked, errors, num, obj, objs, requireGpu, run, run1, shown, str, thisFamily, useBins, useOut } from './helpers.ts';

const bins = useBins();
const out = useOut();

function opTable(): { name: string; exact: boolean; public: boolean }[] {
  const t = answered(run1(bins.bin(), out(), { call: 'op_table' }), 'op_table');
  return objs(t['entries'], 'op_table: entries').map((e, i) => ({ name: str(e['name'], `entries[${i}].name`), exact: e['exact'] === true, public: e['public'] !== false }));
}

function codes(g: number, c: number): number {
  if (Number.isNaN(g) && Number.isNaN(c)) return 0;
  if (!Number.isFinite(c) || !Number.isFinite(g)) return g === c ? 0 : Infinity;
  return (Math.abs(g - c) * 1023) / Math.max(1, Math.abs(c));
}

describe('#429.3eb19699 every public step matches its CPU reference, and exact steps match bit for bit across GPUs', () => {
  it('#429.3eb19699 every public step lands within one 10-bit code per channel of its f64 reference on 99.9% of pixels; f32 math declared exact is refused with not_exact', () => {
    requireGpu();
    const dir = out();
    const publicSteps = opTable().filter((e) => e.public).map((e) => e.name);
    expect(publicSteps.length, 'the op table lists the public steps').toBeGreaterThan(50);
    const ref = answered(run1(bins.bin(), dir, { call: 'steps_reference' }), 'steps_reference');
    const rows = objs(ref['steps'], 'steps_reference: steps');
    expect(rows.map((r) => r['op']).sort(), 'every public step has a reference run').toEqual([...publicSteps].sort());
    const problems: string[] = [];
    for (const r of rows) {
      const op = str(r['op'], 'op');
      const size = (r['size'] as number[]) ?? [0, 0];
      const read = (k: 'gpu' | 'cpu'): Buffer => {
        const h = str(r[k], `${op}.${k}`);
        expect(h, `${op}.${k} is a SHA-256`).toMatch(SHA);
        return readFileSync(join(dir, `${h}.f32`));
      };
      const g = read('gpu'); const c = read('cpu');
      const pixels = size[0]! * size[1]!;
      if (pixels < 4096 || g.length !== pixels * 16 || c.length !== pixels * 16) { problems.push(`${op}: ${size.join(' × ')} pixels, files of ${g.length} and ${c.length} bytes`); continue; }
      let off = 0; let worst = 0;
      for (let i = 0; i < pixels; i++) {
        let px = 0;
        for (let ch = 0; ch < 4; ch++) px = Math.max(px, codes(g.readFloatLE(i * 16 + ch * 4), c.readFloatLE(i * 16 + ch * 4)));
        if (px > 1) off++;
        worst = Math.max(worst, px);
      }
      if (off / pixels > 0.001) problems.push(`${op}: ${off} of ${pixels} pixels past one code (worst ${worst.toFixed(2)})`);
    }
    expect(problems, 'each public step against its reference').toEqual([]);
    const f32add = {
      id: 'addf', kind: 'compute', origin: 'composed', about: 'An f32 add that calls itself exact.', inputs: {}, determinism: 'exact',
      steps: { e: { op: 'element@1', args: {} }, x: { op: 'bitcast@1', args: { x: 'e', to: 'f32' } }, s: { op: 'add@1', args: { a: 'x', b: 'x' } }, b: { op: 'bitcast@1', args: { x: 's', to: 'u32' } }, w: { op: 'write@1', args: { buf: 'out', i: 'e', v: 'b' } } },
      outputs: { out: { storage: { type: 'u32', count: 64 } } }, elements: 64, workgroup: 64, cost: { ns_per_element: 1000 },
    };
    const c = checked(run1(bins.bin(), dir, checkCall(f32add)), 'an f32 add declared exact');
    expect(c.outcome, shown(c.raw)).toBe('refused');
    expect(errors(c, 'not_exact').length, 'refused with not_exact').toBeGreaterThan(0);
  }, 3_600_000);

  it('#429.3eb19699 with one GPU, the bit-for-bit comparison of exact steps is BLOCKED with one unblock ask naming the missing GPU', () => {
    requireGpu();
    const dir = out();
    const exactSteps = opTable().filter((e) => e.public && e.exact).map((e) => e.name);
    const [rec] = run(bins.bin(), dir, [{ call: 'exact' }]);
    const record = JSON.parse(readFileSync(join(dir, `${str(answered(rec!, 'exact')['record'], 'record')}.json`), 'utf8')) as { [k: string]: unknown };
    const held = record['steps'];
    const steps = held !== null && typeof held === 'object' ? Object.keys(held) : [];
    expect(exactSteps.filter((s) => !steps.includes(s)), 'the record holds every exact public step\'s bits').toEqual([]);
    const cmp = run1(bins.bin(), dir, { call: 'cross_gpu', records: [join(dir, `${str(rec!['record'], 'record')}.json`)] });
    expect(cmp['result'], `one GPU family is BLOCKED, never PASS: ${shown(cmp)}`).toBe('BLOCKED');
    const asks = objs(cmp['asks'], 'asks');
    expect(asks.length, 'with exactly one unblock ask').toBe(1);
    const gpu = str(asks[0]!['gpu'], 'the ask\'s gpu, the missing GPU\'s family');
    expect(gpu, 'the ask names a Metal GPU family').toMatch(/^apple\d+$/);
    expect(gpu, `the missing GPU is another family than this one (${thisFamily()})`).not.toBe(thisFamily());
  }, 1_800_000);

  it('#429.3eb19699 exact steps give the same bits on two GPUs of different families', () => {
    requireGpu();
    const dir = out();
    const [rec] = run(bins.bin(), dir, [{ call: 'exact' }]);
    const here = join(dir, `${str(answered(rec!, 'exact')['record'], 'record')}.json`);
    const other = process.env['DEEPBUILD_SECOND_GPU_RECORD'];
    if (!other || !existsSync(other)) {
      const cmp = run1(bins.bin(), dir, { call: 'cross_gpu', records: [here] });
      blocked(`the two-GPU half needs a record from a GPU of another family than ${thisFamily()}: ${shown(objs(cmp['asks'] ?? [], 'asks')[0] ?? cmp)}; run deep-gpu's exact call there and name its record in DEEPBUILD_SECOND_GPU_RECORD`);
    }
    const cmp = run1(bins.bin(), dir, { call: 'cross_gpu', records: [here, other] });
    expect(num((cmp['families'] as unknown[] | undefined)?.length, 'families'), 'two families compared').toBe(2);
    expect(cmp['result'], `every exact step and operator has equal bits: ${shown(obj(cmp, 'cross_gpu'))}`).toBe('PASS');
  }, 1_800_000);
});
