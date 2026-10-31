// AC4: with local test servers standing in for api.market.example and cdn.other.example, a price call carrying the
// market key in an X-Api-Key header that gets `302 Location: https://cdn.other.example/q` sends nothing to
// cdn.other.example, and what needs the price reading is BLOCKED, cause off-host redirect; a redirect to
// https://api.market.example/v2/q is followed with the key; a hub that lets its HTTP client follow redirects delivers
// the key to cdn.other.example and fails, naming that host.
import { describe, expect, it } from 'vitest';
import type { HttpClient } from '../../../packages/extension-host/src/index.ts';
import {
  installAndLoad, KEY, MARKET, MARKET_ID, marketPackage, memoryStore, openHost, openWorld, OTHER, PRICE, routedClient, testServer, YOU,
  type Reply, type TestServer,
} from './helpers.ts';
import { judgeRedirect } from './judges.ts';
import { followingClient } from './twins.ts';

const json = (body: unknown): Reply => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** The market answers /q with a 302 to `location`, and /v2/q with a price; the other host answers anything with a price. */
async function scenario(location: string, client?: (routes: Record<string, TestServer>) => HttpClient) {
  const api = await testServer((req) => {
    if (req.url === '/q') return { status: 302, headers: { location } };
    if (req.url === '/v2/q') return json({ price: 188.1 });
    return { status: 404 };
  });
  const cdn = await testServer(() => json({ price: 999 }));
  const routes = { [MARKET]: api, [OTHER]: cdn };
  const routed = routedClient(routes);
  const w = await openWorld();
  const h = await openHost(w, { secrets: memoryStore(), http: client ? client(routes) : routed.client });
  await installAndLoad(h, await marketPackage({ auth: 'header' }));
  await h.enterSecret(YOU, MARKET_ID, 'market_key', KEY);
  const read = await h.readSource(PRICE);
  return { api, cdn, routed, read };
}

describe('AC4 #364.25091cf4 a price call carrying the market key in X-Api-Key that gets 302 Location: https://cdn.other.example/q sends nothing to cdn.other.example and what needs the price reading is BLOCKED, cause off-host redirect, while a redirect to https://api.market.example/v2/q is followed with the key; a hub that lets its HTTP client follow redirects delivers the key to cdn.other.example and fails, naming that host', () => {
  it('AC4 a 302 to https://cdn.other.example/q sends nothing to cdn.other.example, and the price reading is BLOCKED, cause off-host redirect', async () => {
    const { api, cdn, routed, read } = await scenario(`https://${OTHER}/q`);
    expect(api.seen.map((s) => s.url), 'calls that reached api.market.example').toEqual(['/q']);
    expect(api.seen[0]!.headers['x-api-key'], 'the price call carried the key in X-Api-Key').toBe(KEY);
    expect(routed.asked.map((r) => new URL(r.url).hostname), 'hosts the hub called').toEqual([MARKET]);
    expect(cdn.seen, 'requests that reached cdn.other.example').toEqual([]);
    expect(read).toMatchObject({ status: 'BLOCKED', cause: expect.stringMatching(/off-host redirect/) });
    expect(judgeRedirect(read, { host: OTHER, seen: cdn.seen }, KEY)).toEqual([]);
  }, 120_000);

  it('AC4 a 302 to https://api.market.example/v2/q is followed with the key, and the price reads from it', async () => {
    const { api, cdn, read } = await scenario(`https://${MARKET}/v2/q`);
    expect(api.seen.map((s) => s.url), 'calls that reached api.market.example').toEqual(['/q', '/v2/q']);
    expect(api.seen.map((s) => s.headers['x-api-key']), 'the key on each call').toEqual([KEY, KEY]);
    expect(cdn.seen).toEqual([]);
    expect(read).toMatchObject({ status: 'reading', reading: { source: PRICE, value: 188.1, unit: 'USD' } });
  }, 120_000);

  it('AC4 (wrong program) a hub that lets its HTTP client follow redirects delivers the key to cdn.other.example and fails, naming that host', async () => {
    const { cdn, read } = await scenario(`https://${OTHER}/q`, followingClient);
    const problems = judgeRedirect(read, { host: OTHER, seen: cdn.seen }, KEY);
    expect(problems.some((p) => p.includes(OTHER) && p.includes('delivering the key')), problems.join('\n')).toBe(true);
  }, 120_000);
});
