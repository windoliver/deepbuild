// Criterion 4 (README: Criterion 4): an allowance names a finding, an element and a reason. With no reason it is INVALID,
// and suppresses nothing; one that matches no finding fails as stale, naming itself; a valid one suppresses exactly the
// finding it names and no other. Judged on the 26% jump of fixture JUMP(260) and the pop-in of POP(1), one recording each,
// and on a recording that holds both.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Drive, JUMP, POP, STEP, cleanup, checked, el, expectFindings, recording, requireMacos, still, type Allowance, type Obj } from './helpers.ts';

let drive: Drive;
beforeAll(async () => {
  requireMacos();
  drive = await Drive.start();
}, 600_000);
afterAll(cleanup, 60_000);

const REASON = 'the card flies in by design: the design says it is placed, not animated';
const jump = (extra: Allowance[]): Promise<Obj> => checked(drive, { recording: JUMP(260), allowances: extra });
const JUMP_FINDING = { finding: 'jump', element: 'card:1', t: 30 * STEP, value: 0.26 };

/** A recording that holds a pop_in on row:new (step 30) and a jump of card:1 (step 60): two findings. */
const both = (): ReturnType<typeof recording> =>
  recording({ at: (k) => [...still(), ...(k < 30 ? [] : [el('row:new', 100, 300, Math.min(1, 0.55 + (k - 30) * 0.01))]), el('card:1', 100 + (k >= 60 ? 260 : 0), 200)] });

describe('#1427 AC4 an allowance names a finding, an element and a reason', () => {
  it('a valid allowance suppresses its finding, and the claim no longer fails', async () => {
    const reply = await jump([{ finding: 'jump', element: 'card:1', reason: REASON }]);
    expectFindings(reply, []);
    expect(['FAIL', 'INVALID', 'BLOCKED'], `claim ${reply.claim}: ${JSON.stringify(reply).slice(0, 400)}`).not.toContain(reply.claim);
  });

  it('with no reason key it is INVALID, and the finding it names is not suppressed', async () => {
    const reply = await jump([{ finding: 'jump', element: 'card:1' }]);
    expect(reply.claim, JSON.stringify(reply).slice(0, 500)).toBe('INVALID');
    expectFindings(reply, [JUMP_FINDING]);
  });
  it('with an empty reason it is INVALID, and the finding stays', async () => {
    const reply = await jump([{ finding: 'jump', element: 'card:1', reason: '' }]);
    expect(reply.claim, JSON.stringify(reply).slice(0, 500)).toBe('INVALID');
    expectFindings(reply, [JUMP_FINDING]);
  });
  it('with a reason of only spaces it is INVALID, and the finding stays', async () => {
    const reply = await jump([{ finding: 'jump', element: 'card:1', reason: '   ' }]);
    expect(reply.claim, JSON.stringify(reply).slice(0, 500)).toBe('INVALID');
    expectFindings(reply, [JUMP_FINDING]);
  });
  it('with a null reason it is INVALID', async () => {
    const reply = await jump([{ finding: 'jump', element: 'card:1', reason: null }]);
    expect(reply.claim, JSON.stringify(reply).slice(0, 500)).toBe('INVALID');
  });
  it('an INVALID allowance is INVALID even where it matches nothing: a missing reason is not first judged stale', async () => {
    const reply = await checked(drive, { recording: JUMP(240), allowances: [{ finding: 'jump', element: 'card:1' }] });
    expect(reply.claim, JSON.stringify(reply).slice(0, 500)).toBe('INVALID');
  });

  it('an allowance that matches no finding fails as stale, naming itself', async () => {
    // The recording moves 24%, which is no jump: the allowance for one is stale.
    const reply = await checked(drive, { recording: JUMP(240), allowances: [{ finding: 'jump', element: 'card:1', reason: REASON }] });
    expect(reply.claim, JSON.stringify(reply).slice(0, 500)).toBe('FAIL');
    expect(JSON.stringify(reply.stale ?? null), `a stale list names the allowance: ${JSON.stringify(reply).slice(0, 500)}`).toMatch(/jump/);
    expect(JSON.stringify(reply.stale ?? null)).toMatch(/card:1/);
    expectFindings(reply, []);
  });
  it('an allowance that matches a finding on another element is stale, and does not suppress the finding', async () => {
    const reply = await jump([{ finding: 'jump', element: 'card:2', reason: REASON }]);
    expect(reply.claim, JSON.stringify(reply).slice(0, 500)).toBe('FAIL');
    expect(JSON.stringify(reply.stale ?? null)).toMatch(/card:2/);
    expectFindings(reply, [JUMP_FINDING]);
  });
  it('an allowance for another finding on the right element is stale, and does not suppress the finding', async () => {
    const reply = await jump([{ finding: 'pop_in', element: 'card:1', reason: REASON }]);
    expect(reply.claim, JSON.stringify(reply).slice(0, 500)).toBe('FAIL');
    expect(JSON.stringify(reply.stale ?? null)).toMatch(/pop_in/);
    expectFindings(reply, [JUMP_FINDING]);
  });
  it('an allowance for a finding that is not on the closed list is not accepted', async () => {
    const reply = await jump([{ finding: 'wobble', element: 'card:1', reason: REASON }]);
    expect(['INVALID', 'FAIL'], JSON.stringify(reply).slice(0, 500)).toContain(reply.claim);
    expectFindings(reply, [JUMP_FINDING]);
  });

  it('a valid allowance suppresses only the finding it names: the other finding in the recording stays', async () => {
    const reply = await checked(drive, { recording: both(), allowances: [{ finding: 'jump', element: 'card:1', reason: REASON }] });
    expectFindings(reply, [{ finding: 'pop_in', element: 'row:new', t: 30 * STEP, value: 0.55 }]);
    expect(reply.claim, 'the pop-in still fails it').toBe('FAIL');
  });
  it('two valid allowances suppress both findings, and the claim does not fail', async () => {
    const reply = await checked(drive, {
      recording: both(),
      allowances: [
        { finding: 'jump', element: 'card:1', reason: REASON },
        { finding: 'pop_in', element: 'row:new', reason: 'the row is a live badge that is allowed to appear at once' },
      ],
    });
    expectFindings(reply, []);
    expect(['FAIL', 'INVALID', 'BLOCKED'], JSON.stringify(reply).slice(0, 500)).not.toContain(reply.claim);
  });
  it('one valid and one stale allowance together: the claim fails as stale, the valid one still suppresses', async () => {
    const reply = await checked(drive, {
      recording: both(),
      allowances: [
        { finding: 'jump', element: 'card:1', reason: REASON },
        { finding: 'flicker', element: 'row:new', reason: 'it flickers' },
      ],
    });
    expect(reply.claim).toBe('FAIL');
    expect(JSON.stringify(reply.stale ?? null)).toMatch(/flicker/);
    expectFindings(reply, [{ finding: 'pop_in', element: 'row:new', t: 30 * STEP, value: 0.55 }]);
  });

  it('with no allowance at all, the claim and findings are the plain check\'s', async () => {
    const reply = await checked(drive, { recording: POP(1), allowances: [] });
    expectFindings(reply, [{ finding: 'pop_in', element: 'row:new', t: 30 * STEP, value: 1 }]);
    expect(reply.claim).toBe('FAIL');
  });
});
