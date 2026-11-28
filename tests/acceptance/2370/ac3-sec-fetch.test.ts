import { describe, expect, it } from 'vitest';
import { COUNTER_ROUTES, send, served, shown, type Target } from './helpers.ts';
import { refusesAnySecFetchHeader } from './wrong.ts';

async function secFetchSiteRefusedAndToolFetchServed(target: Target): Promise<void> {
  const before = await target.seen();
  const statuses: number[] = [];
  for (const site of ['cross-site', 'same-site', 'none']) {
    const answer = await send(target.address, { method: 'GET', path: '/status', headers: [['Host', target.address], ['Sec-Fetch-Site', site]] });
    statuses.push(answer.status);
    shown(`GET /status Host ${target.address} Sec-Fetch-Site ${site}`, answer);
  }
  const seenAfterSite = await target.seen();
  console.log(`package count before ${before}, after the three Sec-Fetch-Site requests ${seenAfterSite}`);
  expect({ statuses, seen: seenAfterSite }, 'GET /status with Sec-Fetch-Site cross-site, same-site and none is refused before the package').toEqual({ statuses: [403, 403, 403], seen: before });

  const toolFetch = await send(target.address, { method: 'GET', path: '/status', headers: [['Host', target.address], ['Sec-Fetch-Mode', 'cors']] });
  const seenAfterTool = await target.seen();
  shown(`GET /status Host ${target.address} Sec-Fetch-Mode cors`, toolFetch, seenAfterTool);
  expect({ status: toolFetch.status, seen: seenAfterTool }, 'GET /status carrying only the header Sec-Fetch-Mode: cors, as a tool\'s own fetch sends, reaches the package').toEqual({ status: 200, seen: before + 1 });
}

describe('AC3 #2370 a request carrying Sec-Fetch-Site never reaches the package; one carrying only Sec-Fetch-Mode does', () => {
  it('AC3 #2370 GET /status with the listener\'s Host and Sec-Fetch-Site cross-site, same-site or none is answered 403 and the count stays; the same GET with only Sec-Fetch-Mode: cors reaches the package', async () => {
    const s = await served('counter', COUNTER_ROUTES);
    await secFetchSiteRefusedAndToolFetchServed(s);
  }, 120_000);

  it('AC3 #2370 (wrong program) a planted host that refuses any Sec-Fetch header refuses the tool\'s GET, and the test fails naming Sec-Fetch-Mode', async () => {
    const s = await served('counter', COUNTER_ROUTES);
    const planted = await refusesAnySecFetchHeader(s.address);
    try {
      const failure = await secFetchSiteRefusedAndToolFetchServed({ ...s, address: planted.address }).then(() => null, (e: Error) => e.message);
      console.log(`planted host failure: ${failure}`);
      expect(failure, 'the scenario fails on the planted host').not.toBeNull();
      expect(failure).toMatch(/the header Sec-Fetch-Mode: cors/);
      expect(failure).toMatch(/403/);
    } finally {
      await planted.close();
    }
  }, 120_000);
});
