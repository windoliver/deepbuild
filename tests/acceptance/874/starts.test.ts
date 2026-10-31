// #874 AC2 #874.f1e74512: through a real hub, in a repo whose app already starts, a check for a new route gets no
// stand-in. The base has a start command (`package.json`'s `start`, `node server.mjs`) and one route, `/`. The drafted
// check for the new `GET /health` declares the same service surface as AC1's; the agent adds the route; the stop's claim
// runs the check on its snapshot (it passes) and on the base. There it must run on the real base, which answers the new
// route 404, never on a stand-in's 200 and `{}`, and the record must hold no `stand_in` for R1. Planted wrong program:
// a hub that builds a stand-in for every declared surface, even where the part already starts.
import { describe, expect, it } from 'vitest';
import { AC2, baseRuns, CHECK, claimThroughHub, mustFail, standInOf, type Claimed } from './helpers.ts';

function judge(c: Claimed): void {
  const base = baseRuns(c);
  expect(base.length, `${CHECK} must run on the base, whose app already starts: its runs saw ${JSON.stringify(c.seen)}`).toBeGreaterThan(0);
  for (const n of base) {
    expect({ status: n.status, body: n.body, error: n.error }, `no stand-in: ${CHECK} on the base must reach the base's own app, which answers the new route 404 (it saw ${JSON.stringify(n)})`)
      .toEqual({ status: 404, body: '{"error":"not found"}', error: null });
  }
  expect(standInOf(c), 'no stand-in: the record holds no stand_in for R1').toBeUndefined();
}

describe(`AC2 ${AC2} through a real hub, in a repo whose app already starts, a check for a new route gets no stand-in`, () => {
  it('AC2 the check for the new GET /health runs on the real base, and R1 records no stand_in', async () => {
    judge(await claimThroughHub('starts', 'body'));
  }, 300_000);

  it('AC2 (wrong program) a hub that builds a stand-in where the app already starts fails this test, naming the stand-in', async () => {
    const c = await claimThroughHub('starts', 'body', 'stand-in-always');
    await mustFail('stand-in-always', () => judge(c), ['no stand-in']);
  }, 300_000);
});
