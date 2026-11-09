// Criterion 6 (README: Criterion 6): virtual timestamps prove the shape of motion, not native pacing, so a result never
// reads PASS for pacing: it says "pacing not measured" until a live run has measured it. `checked` holds every reply to
// that (helpers.ts, `contract`); this file asks for the replies where a wrong check would leave it off: the clean one,
// the failing one, the INVALID one, the one a valid allowance cleared and a real replica's.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Drive, JUMP, NOT_MEASURED, POP, SLIDE, cleanup, checked, journey, requireMacos, type Obj } from './helpers.ts';

let drive: Drive;
beforeAll(async () => {
  requireMacos();
  drive = await Drive.start();
}, 600_000);
afterAll(cleanup, 60_000);

const says = (reply: Obj): void => {
  expect(reply.pacing, JSON.stringify(reply).slice(0, 400)).toEqual(expect.stringContaining(NOT_MEASURED));
  expect(JSON.stringify(reply), 'nothing in the result reads PASS for pacing').not.toMatch(/pacing[^,}]{0,40}PASS/i);
};

describe('#1427 AC6 a result never reads PASS for pacing: it says "pacing not measured"', () => {
  it('a recording with no finding says pacing not measured', async () => {
    const reply = await checked(drive, { recording: SLIDE() });
    expect(reply.findings).toEqual([]);
    says(reply);
  });
  it('a recording with a finding says it too', async () => {
    says(await checked(drive, { recording: POP(1) }));
  });
  it('an INVALID result says it too', async () => {
    const reply = await checked(drive, { recording: JUMP(260), allowances: [{ finding: 'jump', element: 'card:1' }] });
    expect(reply.claim).toBe('INVALID');
    says(reply);
  });
  it('a result whose finding a valid allowance cleared says it too', async () => {
    const reply = await checked(drive, { recording: JUMP(260), allowances: [{ finding: 'jump', element: 'card:1', reason: 'placed, not animated, by design' }] });
    expect(reply.findings).toEqual([]);
    says(reply);
  });
  it('a real replica\'s journey that passes says it too', async () => {
    const reply = await checked(drive, { journey: journey('Fade in') });
    expect(reply.findings).toEqual([]);
    says(reply);
  });
  it('and a clean recording is not given a pacing verdict by a field the check made up: pacing is words, not a verdict', async () => {
    const reply = await checked(drive, { recording: SLIDE() });
    expect(typeof reply.pacing, 'pacing is a sentence').toBe('string');
    expect(['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE']).not.toContain(reply.pacing);
  });
});
