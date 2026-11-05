// #1106 AC3: the stand-in sent to a second allowed host, in a query string and in a form body is refused each time
// and recorded; a filter that substitutes on every allowed host fails, naming the host. The world declares two
// credentials, each with its own host: SHOP_API_KEY for the shop API (localhost:<port>, GET and POST) and
// OTHER_API_KEY for the other API (127.0.0.1:<port>, GET), so the run's egress allows both hosts. The app sends
// SHOP_API_KEY's stand-in (1) in the Authorization header to the other API's host, the second allowed host; (2) in a
// query string to the shop API's host; (3) in a form body to the shop API's host. Controls first: SHOP_API_KEY in
// the header to its own host, and OTHER_API_KEY in the header to its own, each get their API's 200, so both hosts
// are allowed and the filter is there. Reading, for each of the three: no sample API got the value with it; the
// filter forwarded nothing of it (no sample API got the attempt at all), and the record holds an event naming the
// stack's run that refuses it and names its placement.
import { afterEach, describe, expect, it } from 'vitest';
import { call, type Call, cleanup, downWorld, type Line, OTHER_VALUE, SHOP_VALUE, type Up, upWorld, waitFor, holds, type World } from './helpers.ts';

afterEach(cleanup, 60_000);

interface Attempt { name: string; to: (w: World) => string; put: 'header' | 'query' | 'body'; method: 'GET' | 'POST'; names: (w: World, text: string) => boolean; place: (w: World) => string }
const ATTEMPTS: Attempt[] = [
  {
    name: 'second-host', to: (w) => w.other.host, put: 'header', method: 'GET', place: (w) => `to the second allowed host ${w.other.host}`,
    names: (w, text) => text.includes('127.0.0.1') && text.includes(String(w.other.port)),
  },
  { name: 'query', to: (w) => w.shop.host, put: 'query', method: 'GET', place: () => 'in a query string', names: (_w, text) => /query|url/i.test(text) },
  { name: 'body', to: (w) => w.shop.host, put: 'body', method: 'POST', place: () => 'in a form body', names: (_w, text) => /body/i.test(text) },
];
const REFUSAL = /refus|den(?:y|ied)|block|reject/i;
/** Events about a run's processes and leases, which name the run but can't be a refusal of a request. */
const ROUTINE = /^(process\.|lease\.|run\.started$|run\.finished$)/;

/**
 * AC3's reading of one attempt: null when it was refused and recorded; otherwise what failed, naming the host that
 * got the value when one did.
 */
function refusalProblem(w: World, a: Attempt, got: Call, events: Line[], run: string): string | null {
  for (const api of [w.shop, w.other]) {
    const leaked = api.seen.filter((r) => r.attempt === a.name && holds(r, SHOP_VALUE));
    if (leaked.length) return `${api.host} received SHOP_API_KEY's value from the stand-in sent ${a.place(w)}`;
  }
  for (const api of [w.shop, w.other]) {
    if (api.seen.some((r) => r.attempt === a.name)) return `the filter forwarded the stand-in sent ${a.place(w)} to ${api.host} instead of refusing it`;
  }
  if (got.status === 200) return `the stand-in sent ${a.place(w)} got 200`;
  const recorded = events.some((e) => !ROUTINE.test(String(e.kind)) && (() => { const text = JSON.stringify(e); return text.includes(run) && REFUSAL.test(text) && a.names(w, text); })());
  if (!recorded) return `no event in the record names the run ${run} and refuses the stand-in sent ${a.place(w)}`;
  return null;
}

async function scenario(plant?: string): Promise<{ u: Up; problems: string[] }> {
  const u = await upWorld(plant);
  const { w, port } = u;
  const shop = await call(port, { variable: 'SHOP_API_KEY', to: w.shop.host, put: 'header', method: 'GET', attempt: 'control-shop' });
  expect(shop.status === 200 && shop.upstream === 'shop', `the control: SHOP_API_KEY's stand-in in its header to its own host ${w.shop.host} gets the shop API's 200 (${JSON.stringify({ ...shop, chain: undefined, trust: undefined })})`).toBe(true);
  const other = await call(port, { variable: 'OTHER_API_KEY', to: w.other.host, put: 'header', method: 'GET', attempt: 'control-other' });
  expect(other.status === 200 && other.upstream === 'other', `the control: ${w.other.host} is allowed, OTHER_API_KEY's stand-in to it getting the other API's 200 (${JSON.stringify({ ...other, chain: undefined, trust: undefined })})`).toBe(true);
  expect(w.other.seen.some((r) => r.headers.authorization === `Bearer ${OTHER_VALUE}`), 'the other API got its own credential\'s value').toBe(true);
  const got: Record<string, Call> = {};
  for (const a of ATTEMPTS) got[a.name] = await call(port, { variable: 'SHOP_API_KEY', to: a.to(w), put: a.put, method: a.method, attempt: a.name });
  // A refusal is recorded as it happens; give the record a moment to hold the last one.
  let problems: string[] = [];
  await waitFor(async () => {
    const events = await u.client.events();
    problems = ATTEMPTS.map((a) => refusalProblem(w, a, got[a.name]!, events, u.run)).filter((p): p is string => p !== null);
    return problems.length === 0 || problems.some((p) => !p.startsWith('no event')) ? true : undefined;
  }, 10_000, 'the refusals in the record').catch(() => undefined);
  return { u, problems };
}

describe('AC3 #1106.bd90f543 the stand-in sent to a second allowed host, in a query string and in a form body is refused each time and recorded; a filter that substitutes on every allowed host fails, naming the host', () => {
  it('AC3 SHOP_API_KEY\'s stand-in sent to the other credential\'s host, in a query string and in a form body to its own host, is refused each time, reaches no sample API, and each refusal is in the record on the stack\'s run', async () => {
    let u: Up | undefined;
    try {
      const s = await scenario();
      u = s.u;
      expect(s.problems).toEqual([]);
    } finally {
      await downWorld(u);
    }
  }, 240_000);

  it('AC3 (wrong program) a filter that substitutes on every allowed host (DEEP_HUB_PLANT=standin-every-host) fails the reading, naming the host', async () => {
    let u: Up | undefined;
    try {
      const s = await scenario('standin-every-host');
      u = s.u;
      expect(s.problems.length, 'the reading passes on a filter that puts the value into a request to another allowed host').toBeGreaterThan(0);
      expect(s.problems.join(' | '), 'and names that host').toContain(`${s.u.w.other.host} received SHOP_API_KEY's value`);
    } finally {
      await downWorld(u);
    }
  }, 240_000);
});
