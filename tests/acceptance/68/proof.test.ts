// The Proof line: each R2 kind failing on a planted fault and passing on the fix, through the core's verdict. The
// service kind's is AC4's test (service.test.ts) and the document kind's AC3's (document.test.ts); the data and
// message kinds' are here.
import { describe, expect, it } from 'vitest';
import { judge, piece, runOn, shown } from './helpers.ts';

describe('Proof: the data and message kinds fail on a planted fault and pass on the fix', () => {
  it('Proof data: east orders totalling 200 where 150 must hold fail at the check\'s assertion; the fixed table passes', async () => {
    const fault = await piece('data', 'fault');
    const r = await runOn(fault);
    expect(r.outcome, shown(r)).toBe('failed');
    expect(r.failures.some((f) => f.assertion), `the failure is at the check's assertion (${shown(r)})`).toBe(true);
    expect(judge(r, fault.spec).outcome).toBe('FAIL');

    const fix = await piece('data', 'fix');
    const ok = await runOn(fix);
    expect(ok.outcome, shown(ok)).toBe('passed');
    expect(judge(ok, fix.spec).outcome).toBe('PASS');
  });

  it('Proof message: a mail delivered to a Maildir but never seen fails, naming the acknowledgement; the seen mail passes', async () => {
    const fault = await piece('message', 'fault');
    const r = await runOn(fault);
    expect(r.outcome, shown(r)).toBe('failed');
    expect(r.failures.some((f) => f.assertion && /acknowledg/i.test(f.message)), `a failure at the check's assertion names the acknowledgement (${shown(r)})`).toBe(true);
    expect(judge(r, fault.spec).outcome).toBe('FAIL');

    const fix = await piece('message', 'fix');
    const ok = await runOn(fix);
    expect(ok.outcome, shown(ok)).toBe('passed');
    expect(judge(ok, fix.spec).outcome).toBe('PASS');
  });
});
