// AC5: no check kind can turn a model's opinion into PASS. Each kind's check runs on its fixed work, once as a check
// whose oracle is code and once as one whose oracle is a model; the core's verdict passes the first and never the
// second. The core reads the check's oracle (ClaimCheck.oracle), so no kind, these or another, can get round it.
import { describe, expect, it } from 'vitest';
import { judge, KINDS, piece, runOn, shown } from './helpers.ts';

describe.each(KINDS)('AC5 the %s kind can not turn a model\'s opinion into PASS', (kind) => {
  it(`AC5 ${kind}: on the fixed work its check passes with code as its oracle, and is never PASS with a model as its oracle`, async () => {
    const fix = await piece(kind, 'fix');
    const byCode = await runOn(fix, 'code');
    expect(judge(byCode, fix.spec, 'code').outcome, shown(byCode)).toBe('PASS');

    const byModel = await runOn(fix, 'model');
    const v = judge(byModel, fix.spec, 'model');
    expect(v.outcome, `${shown(byModel)}; reasons: ${v.reasons.join(' | ')}`).not.toBe('PASS');
  }, 60_000);
});
