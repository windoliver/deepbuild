import { describe, expect, it } from 'vitest';
import { BROWSER_ORIGIN, COUNTER_ROUTES, FOREIGN_HOST, send, served, type Header, type Target } from './helpers.ts';
import { appendsAnEventPerRefusal, REFUSAL_KIND } from './wrong.ts';

const REFUSED = 1000;

function refusedRequest(n: number, address: string): { method: string; path: string; headers: Header[]; body?: string } {
  const port = address.split(':')[1];
  const route = n % 2 === 0 ? { method: 'GET', path: '/status' } : { method: 'POST', path: '/set', body: `v${n}` };
  const browser: Header[][] = [
    [['Host', address], ['Origin', BROWSER_ORIGIN]],
    [['Host', address], ['Sec-Fetch-Site', 'cross-site']],
    [['Host', `${FOREIGN_HOST}:${port}`]],
  ];
  return { ...route, headers: browser[n % 3]! };
}

async function thousandRefusalsLeaveNoTrace(target: Target): Promise<void> {
  const before = await target.events();
  const lastBefore = before.length ? before[before.length - 1]!.log_pos : 0;
  const statuses: Record<number, number> = {};
  for (let n = 0; n < REFUSED; n++) {
    const { status } = await send(target.address, refusedRequest(n, target.address));
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
  const after = await target.events();
  const added = after.filter((e) => e.log_pos > lastBefore);
  const kinds: Record<string, number> = {};
  for (const e of added) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  console.log(`record event count before ${before.length}, after ${REFUSED} refused requests ${after.length}; added by kind ${JSON.stringify(kinds)}; answers ${JSON.stringify(statuses)}`);
  expect(added.length, `the record after ${REFUSED} refused requests holds no new event, where it gained ${JSON.stringify(kinds)}`).toBe(0);
  const seen = await target.seen();
  console.log(`package count after ${REFUSED} refused requests: ${seen}`);
  expect(seen, `none of the ${REFUSED} reached the package`).toBe(0);
  expect(statuses, `each of the ${REFUSED} was answered 403`).toEqual({ 403: REFUSED });
}

describe('AC5 #2370 a refusal appends nothing to the record', () => {
  it('AC5 #2370 1,000 refused requests in a row leave the record\'s event count as it was and the package\'s count at 0', async () => {
    const s = await served('counter', COUNTER_ROUTES);
    await thousandRefusalsLeaveNoTrace(s);
  }, 300_000);

  it('AC5 #2370 (wrong program) a planted host that appends an event per refusal grows the record by 1,000, and the test fails naming the kind', async () => {
    const s = await served('counter', COUNTER_ROUTES);
    const planted = await appendsAnEventPerRefusal(s.address, s.world.record);
    try {
      const failure = await thousandRefusalsLeaveNoTrace({ ...s, address: planted.address }).then(() => null, (e: Error) => e.message);
      console.log(`planted host failure: ${failure}`);
      expect(failure, 'the scenario fails on the planted host').not.toBeNull();
      expect(failure).toMatch(new RegExp(REFUSAL_KIND.replaceAll('.', '\\.')));
      expect(failure).toMatch(new RegExp(`${REFUSED}`));
    } finally {
      await planted.close();
    }
  }, 300_000);
});
