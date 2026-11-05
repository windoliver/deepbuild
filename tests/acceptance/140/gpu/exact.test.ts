// AC1 (its second half): the GPU seam's suite compares the exact-class fixtures' bits across GPU families (an M1 and
// an M3). This reference Mac has one GPU, so the comparison must read BLOCKED with exactly one unblock ask, and the
// suite never PASS. The suite's own comparison is shown to work on twins made from this Mac's record: another
// family's record with equal bits passes, one with a fixture's bits changed fails naming it. The real M1 against M3
// run needs a record made on an M1 (DEEP_140_M1_RECORD); without it that test fails BLOCKED, never passing.
// At the base `deep-gpu` has no `seam_suite` call.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADAPTER, adapterReply, arr, isObject, obj, requireMac, run, run1, shown, str, useBuilds, useOut, type JsonObject, type JsonValue } from './helpers.ts';

const bins = useBuilds(['default']);
const out = useOut();
const SHA = /^[0-9a-f]{64}$/;

interface Suite { raw: JsonObject; result: string; record: string; parts: Map<string, JsonObject>; asks: JsonObject[] }
function suite(records: string[] = []): Suite {
  const r = run1(bins.bin(), out(), { call: 'seam_suite', seam: 'gpu', ...(records.length ? { records } : {}) });
  expect(r['seam'], 'the suite is the GPU seam\'s').toBe('gpu');
  const backend = obj(r['backend'], 'seam_suite: backend');
  str(backend['name'], 'seam_suite: backend.name'); str(backend['version'], 'seam_suite: backend.version');
  const parts = new Map(arr(r['parts'], 'seam_suite: parts').map((p, i) => { const o = obj(p, `parts[${i}]`); return [str(o['part'], `parts[${i}].part`), o] as const; }));
  return { raw: r, result: str(r['result'], 'seam_suite: result'), record: str(r['record'], 'seam_suite: record'), parts, asks: arr(r['asks'], 'seam_suite: asks').map((a, i) => obj(a, `asks[${i}]`)) };
}
interface ExactRecord { gpu: { name: string; family: string }; fixtures: { [name: string]: string } }
function record(path: string): { raw: JsonObject; rec: ExactRecord } {
  const raw = obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, `the record ${path}`);
  const gpu = obj(raw['gpu'], 'record: gpu');
  const fixtures = obj(raw['fixtures'], 'record: fixtures');
  const names = Object.keys(fixtures);
  expect(names.length, 'the record holds the exact-class fixtures').toBeGreaterThan(0);
  for (const n of names) expect(SHA.test(String(fixtures[n])), `record: fixture ${n}'s bits are a SHA-256, got ${shown(fixtures[n])}`).toBe(true);
  return { raw, rec: { gpu: { name: str(gpu['name'], 'record: gpu.name'), family: str(gpu['family'], 'record: gpu.family') }, fixtures: fixtures as { [name: string]: string } } };
}
function crossFamily(s: Suite): JsonObject {
  const p = s.parts.get('cross_family');
  expect(p, `the suite has a cross_family part: ${shown(s.raw)}`).toBeDefined();
  return p!;
}
/** A twin of this Mac's record as another GPU would write it, kept in the test's output folder. */
function twin(raw: JsonObject, family: string, name: string, edit?: (fixtures: JsonObject) => void): string {
  const copy = JSON.parse(JSON.stringify(raw)) as JsonObject;
  const gpu = obj(copy['gpu'], 'twin: gpu');
  gpu['family'] = family; gpu['name'] = name;
  if (edit) edit(obj(copy['fixtures'], 'twin: fixtures'));
  const path = join(out(), `${family}-${name.replace(/\W+/g, '_')}-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(copy));
  return path;
}
const otherFamily = (f: string): string => (f === 'apple7' ? 'apple9' : 'apple7');

describe('AC1 the exact-class fixtures give identical bits on two GPUs of different families; with one GPU that comparison is BLOCKED with one unblock ask, never PASS', () => {
  it('AC1 on this one GPU the suite\'s cross-family comparison is BLOCKED with exactly one unblock ask and the suite is never PASS; this GPU\'s record names it and holds the same bits run after run', () => {
    requireMac();
    const a = adapterReply(run(bins.bin(), out(), [ADAPTER])[0]!);
    const s = suite();
    const cf = crossFamily(s);
    expect(cf['result'], `with one GPU the cross-family comparison is BLOCKED: ${shown(cf)}`).toBe('BLOCKED');
    expect(s.result, `the suite is BLOCKED while a part is, never PASS: ${shown(s.raw)}`).toBe('BLOCKED');
    expect(s.asks.length, `exactly one unblock ask: ${shown(s.raw['asks'])}`).toBe(1);
    expect(s.asks[0]!['kind'], 'the ask is an unblock ask').toBe('unblock');
    expect(str(s.asks[0]!['ask'], 'the ask\'s text').length, 'the ask says what unblocks it').toBeGreaterThan(0);
    const mine = record(s.record);
    expect(mine.rec.gpu.name, 'the record names this GPU').toBe(a.adapter.name);
    expect(mine.rec.gpu.family.length, 'the record names this GPU\'s family').toBeGreaterThan(0);
    const again = record(suite().record);
    expect(again.rec.fixtures, 'the exact-class fixtures give the same bits on the same GPU run after run').toEqual(mine.rec.fixtures);
  }, 1_800_000);

  it('AC1 the comparison on twins of this record: another family\'s equal bits PASS, a fixture\'s changed bits FAIL naming it, and two records of one family stay BLOCKED', () => {
    requireMac();
    const s = suite();
    const mine = record(s.record);
    const other = otherFamily(mine.rec.gpu.family);
    const equal = suite([twin(mine.raw, other, 'Apple M1')]);
    expect(crossFamily(equal)['result'], `another family's equal bits pass: ${shown(crossFamily(equal))}`).toBe('PASS');
    expect(equal.asks.length, 'a comparison that ran asks nothing').toBe(0);
    const changedFixture = Object.keys(mine.rec.fixtures)[0]!;
    const changed = suite([twin(mine.raw, other, 'Apple M1', (fx) => { fx[changedFixture] = '0'.repeat(64); })]);
    const cf = crossFamily(changed);
    expect(cf['result'], `a fixture's changed bits fail: ${shown(cf)}`).toBe('FAIL');
    expect(changed.result, 'the suite fails with it').toBe('FAIL');
    expect(JSON.stringify(cf), `the failure names the fixture ${changedFixture}`).toContain(changedFixture);
    const same = suite([twin(mine.raw, mine.rec.gpu.family, `${mine.rec.gpu.name} (another)`)]);
    expect(crossFamily(same)['result'], 'two GPUs of one family are still one family: BLOCKED').toBe('BLOCKED');
    expect(same.result === 'PASS', 'the suite is never PASS on one family').toBe(false);
    expect(same.asks.length, 'still exactly one unblock ask').toBe(1);
  }, 1_800_000);

  it('AC1 on an M1 and an M3: the M1\'s record (DEEP_140_M1_RECORD) has this M3\'s bits for every exact-class fixture; without that record this is BLOCKED, never PASS', () => {
    requireMac();
    const m1 = process.env['DEEP_140_M1_RECORD'];
    // This GPU's own record first, so the suite this test needs is exercised whether or not an M1 record exists.
    record(suite().record);
    if (!m1) expect.fail('BLOCKED: no record from an M1 (unblock: run deep-gpu\'s {"call": "seam_suite", "seam": "gpu"} on an M1 Mac and set DEEP_140_M1_RECORD to the record it writes)');
    const s = suite([m1!]);
    const theirs = obj(JSON.parse(readFileSync(m1!, 'utf8')) as JsonValue, 'the M1 record');
    expect(isObject(theirs['gpu']) && String(theirs['gpu']['name']).includes('M1'), 'the record was made on an M1').toBe(true);
    expect(record(s.record).rec.gpu.name, 'this run is on an M3').toContain('M3');
    expect(crossFamily(s)['result'], `every exact-class fixture's bits are equal on the M1 and the M3: ${shown(crossFamily(s))}`).toBe('PASS');
  }, 1_800_000);
});
