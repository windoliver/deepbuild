import { describe, expect, it } from 'vitest';
import { BROWSER_ORIGIN, send, served, shown, type Target } from './helpers.ts';
import { matchesTheRouteFirst } from './wrong.ts';

const CHOSEN = ['POST /v1/traces'];
const paths = [
  { path: '/never-registered', what: 'a path the package never registered' },
  { path: '/admin/exec', what: 'a route the package registered and you didn\'t choose' },
  { path: '/v1/traces', what: 'the route you chose' },
];

async function refusedBeforeTheRouteIsMatched(target: Target): Promise<void> {
  for (const { path, what } of paths) {
    const answer = await send(target.address, {
      method: 'POST', path, body: 'payload',
      headers: [['Host', target.address], ['Content-Type', 'text/plain'], ['Origin', BROWSER_ORIGIN]],
    });
    shown(`POST ${path} (${what}) Origin ${BROWSER_ORIGIN}`, answer);
    expect(answer.status, `POST ${path}, ${what}, carrying an Origin is answered as a chosen route is`).toBe(403);
  }
  const seen = await target.seen();
  console.log(`package count after the three: ${seen}`);
  expect(seen, 'none of the three reached the package').toBe(0);
}

describe('AC4 #2370 the browser checks run before the route is matched', () => {
  it('AC4 #2370 a POST carrying an Origin to a path never registered, to a registered route you didn\'t choose and to the chosen route are each answered 403', async () => {
    const s = await served('inbound', CHOSEN);
    await refusedBeforeTheRouteIsMatched(s);
  }, 120_000);

  it('AC4 #2370 (wrong program) a planted host that matches the route first answers 404 to the path never registered, and the test fails naming the path', async () => {
    const s = await served('inbound', CHOSEN);
    const planted = await matchesTheRouteFirst(s.address, CHOSEN);
    try {
      const failure = await refusedBeforeTheRouteIsMatched({ ...s, address: planted.address }).then(() => null, (e: Error) => e.message);
      console.log(`planted host failure: ${failure}`);
      expect(failure, 'the scenario fails on the planted host').not.toBeNull();
      expect(failure).toMatch(/POST \/never-registered, a path the package never registered/);
      expect(failure).toMatch(/404/);
    } finally {
      await planted.close();
    }
  }, 120_000);
});
