import { afterEach, describe, expect, it } from 'vitest';
import { apply, expectState, LOCAL_FIRST, openWorld, removeRoots, said, startSession, verdict } from './helpers.ts';

afterEach(removeRoots);

describe('AC7 a drafting change that would drop a check that once caught a real bug is held for you', () => {
  it('AC7 dropping app.e2e, named in a FAIL verdict, is held, naming it; dropping app.lint (only PASS) or app.flaky (only INVALID) is applied', async () => {
    const w = await openWorld();
    const S1 = await startSession(w, 'shop', [{ id: 'm1', from: 'you', text: 'the e2e, lint and flaky suites slow every draft down' }]);
    await verdict(w, 'FAIL', 'app.e2e');
    await verdict(w, 'PASS', 'app.e2e');
    await verdict(w, 'PASS', 'app.lint');
    await verdict(w, 'INVALID', 'app.flaky');
    const evidence = [{ at: said(S1, 'm1'), quote: 'slow every draft down' }];
    const drop = (check: string) => apply(w, { target: 'drafting:shop', diff: `- ${check}`, evidence, scope: `session:${S1}`, replay: { tasks: 20, regressions: 0 } }, LOCAL_FIRST);
    const e2e = await drop('app.e2e');
    const held = await expectState(w, e2e, 'held', 'dropping a check that once caught a real bug');
    expect(String(held.reason ?? ''), 'the hold names the check').toContain('app.e2e');
    await expectState(w, await drop('app.lint'), 'applied', 'dropping a check that only ever passed');
    await expectState(w, await drop('app.flaky'), 'applied', 'dropping a check whose only failure was INVALID');
    await w.record.close();
  });
});
