// AC3: a document with one number that doesn't match its source fails, naming the number and the source. Also the
// Proof line for the document kind: it fails on its planted fault and passes on the fix, through the core's verdict.
import { describe, expect, it } from 'vitest';
import { judge, piece, runOn, shown, SOURCE, WRONG_NUMBER } from './helpers.ts';

describe('AC3 a document with one number that does not match its source fails, naming the number and the source', () => {
  it('AC3 the report writing 1,250 where its cited source says 1240 fails, naming 1,250 and sources/q3.json; the fixed report passes', async () => {
    const fault = await piece('document', 'fault');
    const r = await runOn(fault);
    expect(r.outcome, shown(r)).toBe('failed');
    const named = r.failures.find((f) => f.assertion && (f.message.includes(WRONG_NUMBER) || f.message.includes('1250')) && f.message.includes(SOURCE));
    expect(named, `a failure at the check's assertion names ${WRONG_NUMBER} and ${SOURCE} (${shown(r)})`).toBeDefined();
    expect(judge(r, fault.spec).outcome).toBe('FAIL');

    const fix = await piece('document', 'fix');
    const ok = await runOn(fix);
    expect(ok.outcome, shown(ok)).toBe('passed');
    expect(judge(ok, fix.spec).outcome).toBe('PASS');
  });
});
