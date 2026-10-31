// #874 AC3 #874.555fd457: a drafted check that passes on its stand-in is INVALID. Through the real hub, in an empty repo:
// the drafted check for `GET /health` declares its service surface and asserts only that the route answers 200, which
// the stand-in, a program that does nothing, also does. The agent writes the app; the stop's claim runs the check on
// its snapshot (it passes) and on the base, where it reaches the stand-in and passes too. The claim must then be
// INVALID, naming the check. Planted wrong programs: a hub that counts a pass on a stand-in as proof, and one that never
// carries the surface to the base checkout (the check then fails there before reaching anything, and proves nothing).
import { describe, expect, it } from 'vitest';
import { AC3, baseRuns, CHECK, claimThroughHub, mustFail, verdictsOf, type Claimed } from './helpers.ts';

function judge(c: Claimed): void {
  const base = baseRuns(c);
  expect(base.length, `${CHECK} must run on the base, the empty root commit: its runs saw ${JSON.stringify(c.seen)}`).toBeGreaterThan(0);
  for (const n of base) {
    expect({ status: n.status, body: n.body, error: n.error }, `${CHECK} on the base must reach the stand-in of its declared surface and pass there (it saw ${JSON.stringify(n)})`)
      .toEqual({ status: 200, body: '{}', error: null });
  }
  const verdicts = verdictsOf(c);
  const invalid = verdicts.filter((v) => v.data.outcome === 'INVALID' && (v.data.reasons as string[] | undefined ?? []).some((r) => r.includes(CHECK)));
  expect(invalid.length, `the claim must be INVALID, naming ${CHECK}: its verdicts are ${JSON.stringify(verdicts.map((v) => ({ outcome: v.data.outcome, reasons: v.data.reasons })))}`).toBeGreaterThan(0);
}

describe(`AC3 ${AC3} a drafted check that passes on its stand-in is INVALID`, () => {
  it('AC3 a check that asserts only 200 passes on the stand-in, and the claim is INVALID naming it', async () => {
    judge(await claimThroughHub('empty', 'ok'));
  }, 300_000);

  it('AC3 (wrong program) a hub that counts a pass on a stand-in as proof fails this test, naming INVALID', async () => {
    const c = await claimThroughHub('empty', 'ok', 'stand-in-pass-proves');
    await mustFail('stand-in-pass-proves', () => judge(c), ['must be INVALID']);
  }, 300_000);

  it('AC3 (wrong program) a hub that never carries the declared surface to the base checkout fails this test, naming the stand-in', async () => {
    const c = await claimThroughHub('empty', 'ok', 'stand-in-surface-dropped');
    await mustFail('stand-in-surface-dropped', () => judge(c), ['must reach the stand-in']);
  }, 300_000);
});
