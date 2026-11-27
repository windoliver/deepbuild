// #3617.e5d2f1f1: on a machine that is not a reference Mac, or at a one-minute load at or above its cores, the times
// read INCONCLUSIVE and never pass. Read through the lane's judge (`node benchmarks/canvas.mjs judge`) on reports with
// readings far under the limit, so only the machine and the load decide; the reference Mac at rest is the control that
// passes the same readings. The live five-run bench is in ac2-onepass.test.ts, which expects INCONCLUSIVE off a reference Mac.
import { describe, expect, it } from 'vitest';
import { CORES, CRITERIA, DRAW_P95_MS, REFERENCE_FINGERPRINT, TARGET_NAME, judgeReport, report, type JsonObject, type Reading } from './helpers.ts';

const ID = CRITERIA.inconclusive;
const UNDER: Reading[] = Array.from({ length: 5 }, () => ({ draw: 0.1 }));
const OVER: Reading[] = Array.from({ length: 5 }, () => ({ draw: 2.5 }));
const verdict = (readings: Reading[], fingerprint: JsonObject = REFERENCE_FINGERPRINT): JsonObject => judgeReport(report(readings, fingerprint));
const targetOf = (v: JsonObject): JsonObject => (v['targets'] as Record<string, JsonObject>)[TARGET_NAME]!;
const inconclusive = (v: JsonObject, what: string): void => {
  expect(v['status'], `${what}: the task reads INCONCLUSIVE, never PASS`).toBe('INCONCLUSIVE');
  expect(targetOf(v)['status'], `${what}: the ${TARGET_NAME} target reads INCONCLUSIVE`).toBe('INCONCLUSIVE');
  expect(String(v['reason']).length, `${what}: the verdict says why`).toBeGreaterThan(0);
};

describe(`${ID} off a reference Mac or under load, the times read INCONCLUSIVE and never pass`, () => {
  it(`${ID} the control: a reference Mac (Mac17,10) at rest passes five readings under ${DRAW_P95_MS} ms and fails five over it`, () => {
    const pass = verdict(UNDER);
    expect(pass['task']).toBe('canvas-gpu-draw-finish');
    expect(pass['status']).toBe('PASS');
    expect(verdict(OVER)['status']).toBe('FAIL');
    expect(verdict([...UNDER.slice(0, 4), { draw: 0.5 * 1.02 }])['status'], 'one run just over, within the margin, is neither').toBe('INCONCLUSIVE');
  });

  const off: [string, JsonObject][] = [
    ['another Mac model', { ...REFERENCE_FINGERPRINT, model: 'Mac14,6', chip: 'Apple M2 Max' }],
    ['a reference model with another memory size', { ...REFERENCE_FINGERPRINT, memoryBytes: 32 * 2 ** 30 }],
    ['a machine that reports no model (off macOS)', { ...REFERENCE_FINGERPRINT, model: null, chip: null, memoryBytes: null, power: null, lowPowerMode: null, thermalState: null }],
    ['a reference Mac on battery', { ...REFERENCE_FINGERPRINT, power: 'battery' }],
    ['a reference Mac in Low Power Mode', { ...REFERENCE_FINGERPRINT, lowPowerMode: true }],
    ['a reference Mac not thermally nominal', { ...REFERENCE_FINGERPRINT, thermalState: 'fair' }],
  ];
  for (const [name, fingerprint] of off) {
    it(`${ID} ${name}: readings under the limit read INCONCLUSIVE, and readings over it do too, never a pass and never a fail`, () => {
      inconclusive(verdict(UNDER, fingerprint), `${name}, under`);
      inconclusive(verdict(OVER, fingerprint), `${name}, over`);
    });
  }

  it(`${ID} a one-minute load at or above the cores at any run's start or end reads INCONCLUSIVE; one under them passes`, () => {
    const at = (k: number, load: [number, number]): Reading[] => UNDER.map((r, i) => (i === k ? { ...r, load } : r));
    inconclusive(verdict(at(2, [CORES, 1])), `load ${CORES} (the core count) at a run's start`);
    inconclusive(verdict(at(4, [1, CORES])), `load ${CORES} (the core count) at a run's end`);
    inconclusive(verdict(at(0, [CORES + 3, CORES + 3])), `load ${CORES + 3} over the cores`);
    inconclusive(verdict(OVER.map((r) => ({ ...r, load: [CORES, CORES] as [number, number] }))), 'readings over the limit at a load at the cores');
    expect(verdict(at(2, [CORES - 0.5, CORES - 0.5]))['status'], `a load of ${CORES - 0.5}, under the ${CORES} cores, counts`).toBe('PASS');
  });

  it(`${ID} a reading whose load can't be read, or from a build that isn't release, is never a pass`, () => {
    const noLoad = report(UNDER);
    for (const r of noLoad['runs'] as JsonObject[]) { delete r['loadStart']; delete r['loadEnd']; }
    expect(judgeReport(noLoad)['status']).not.toBe('PASS');
    const debug = judgeReport(report(UNDER, { ...REFERENCE_FINGERPRINT, build: { profile: 'debug', toolchain: 'rustc 1.99.1' } }));
    expect(debug['status'], 'a debug build\'s times are not read').not.toBe('PASS');
  });
});
