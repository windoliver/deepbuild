// #28 AC33: numeric contracts and their precision twin.
// The fixture: a running sum of 1 followed by sixteen steps of 2^-12, so the float64 answer is 1 + 2^-8. Accumulated
// in FP32 the sum is exact; accumulated in FP16, whose spacing at 1 is 2^-10, every step rounds away, so the twin
// ends at 1, an error of 2^-8 = 0.00390625: at most 4e-3, above 1e-3 + 1e-3·|x| and below 1e-2.
import { describe, expect, it } from 'vitest';
import { runContract, verdict } from '../../../packages/verdicts/src/index.ts';
import type { NumericContract, Outputs, Precision } from '../../../packages/verdicts/src/index.ts';
import { check, checkOf, claim, COMMIT, numbersIn, reqId, reqOf, requirement, run, text } from './helpers.ts';

const f16 = (Math as unknown as { f16round(x: number): number }).f16round;
const ROUND: Record<Precision, (x: number) => number> = { fp64: (x) => x, fp32: Math.fround, fp16: f16 };
const STEPS = [1, ...Array.from({ length: 16 }, () => 2 ** -12)];
function reference(accumulate: Precision): Outputs {
  const round = ROUND[accumulate];
  let acc = 0;
  const prefix: number[] = [];
  for (const x of STEPS) { acc = round(acc + x); prefix.push(acc); }
  return { sum: [acc], prefix };
}
const TWIN_ERROR = 2 ** -8;
function contract(atol: number): NumericContract {
  return {
    reference: { precision: 'fp64' }, accumulate: 'fp32', twin: { accumulate: 'fp16' }, assert: 'assert_close',
    tolerances: [
      { output: 'sum', size: 1, atol, rtol: 1e-3, unit: 'value' },
      { output: 'prefix', size: STEPS.length, atol, rtol: 1e-3, unit: 'value' },
    ],
  };
}
const nearTwinError = (s: string): boolean => numbersIn(s).some((n) => Math.abs(n - TWIN_ERROR) <= 0.05 * TWIN_ERROR);

describe('AC33 a numeric contract must fail on its precision twin', () => {
  it('AC33 the fixture is what the criterion states: the twin differs from the FP32 answer by at most 4e-3', () => {
    const fp32 = reference('fp32'), twin = reference('fp16');
    const err = Math.max(...fp32.prefix!.map((v, i) => Math.abs(v - twin.prefix![i]!)));
    expect(err).toBe(TWIN_ERROR);
    expect(err).toBeLessThanOrEqual(4e-3);
  });
  it('AC33 with atol 1e-3 and rtol 1e-3, the check fails on the twin at its named assert_close and counts', () => {
    const r = runContract(contract(1e-3), { reference, underTest: () => reference('fp32') });
    expect(r.run.outcome).toBe('passed');
    expect(r.twin.outcome).toBe('failed');
    expect(r.twin.failed_at).toBe('assert_close');
    expect(r.twin.largest_error.prefix).toBe(TWIN_ERROR);
    expect(r.run.compared).toEqual({ sum: 1, prefix: STEPS.length });
    expect(r.outcome).toBe('counts');
  });
  it('AC33 the same check with atol 1e-2 passes the twin and is INVALID, naming 4e-3', () => {
    const r = runContract(contract(1e-2), { reference, underTest: () => reference('fp32') });
    expect(r.twin.outcome, 'the twin runs, and passes').toBe('passed');
    expect(r.outcome).toBe('INVALID');
    expect(nearTwinError(text(r.reasons)), `reasons name the twin's largest error: ${text(r.reasons)}`).toBe(true);
  });
  it('AC33 a compared count below an output\'s size makes it INVALID, naming the output', () => {
    const r = runContract(contract(1e-3), { reference, underTest: () => ({ sum: reference('fp32').sum!, prefix: reference('fp32').prefix!.slice(0, 8) }) });
    expect(r.run.compared.prefix).toBeLessThan(STEPS.length);
    expect(r.outcome).toBe('INVALID');
    expect(text(r.reasons)).toContain('prefix');
  });
  it('AC33 in the verdict: the tight contract covers a requirement about computed numbers; the loose one is INVALID naming 4e-3; a shape-and-finiteness check doesn\'t cover it, naming the depth it needs', () => {
    const numbers = [requirement(1, { numbers: true })];
    const tight = check('kernel', { contract: contract(1e-3), covers: [reqId(1)] });
    const tightRun = run(tight, COMMIT, 'passed', { contract: runContract(contract(1e-3), { reference, underTest: () => reference('fp32') }) });
    expect(verdict(claim({ requirements: numbers, checks: [tight], runs: [tightRun] })).outcome).toBe('PASS');

    const loose = check('kernel', { contract: contract(1e-2), covers: [reqId(1)] });
    const looseRun = run(loose, COMMIT, 'passed', { contract: runContract(contract(1e-2), { reference, underTest: () => reference('fp32') }) });
    const lv = verdict(claim({ requirements: numbers, checks: [loose], runs: [looseRun] }));
    expect(checkOf(lv, 'kernel').outcome).toBe('INVALID');
    expect(lv.outcome).toBe('INVALID');
    expect(nearTwinError(text(lv.reasons)), text(lv.reasons)).toBe(true);

    const shape = check('kernel:shape', { covers: [reqId(1)] });
    const sv = verdict(claim({ requirements: numbers, checks: [shape], runs: [run(shape, COMMIT, 'passed')] }));
    expect(reqOf(sv, reqId(1)).outcome).toBe('INVALID');
    expect(sv.outcome).toBe('INVALID');
    expect(text(sv.reasons)).toContain(reqId(1));
    expect(text(sv.reasons)).toContain('unit');
  });
});
