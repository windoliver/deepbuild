// AC6: the price source's key test, entered against a recorded provider, reads valid and saves the value on 200,
// invalid and saves nothing on 401, and INCONCLUSIVE and saves the value on 503, on a timeout and with no network; a
// test that rejects the value on the 503, the timeout or no network fails, naming the case.
//
// The recorded provider is a local server standing in for api.market.example that gives the key-test call the
// provider's recorded answer for each case: 200, 401, 503, or none at all (the timeout). No network is simulated by
// the HTTP client the hub is given, which refuses the name before any socket. Each case starts from an empty store.
import { describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { installAndLoad, KEY, MARKET, MARKET_ID, marketPackage, memoryStore, openHost, openWorld, routedClient, testServer, YOU, type Reply, type RoutedClient, type TestServer, type TestStore } from './helpers.ts';
import { judgeKeyTest, KEY_CASES, type KeyCase } from './judges.ts';
import { rejectsWhenUnsure } from './twins.ts';

/** The key-test call's answer for each case the provider answers. */
const ANSWERS: Record<string, Reply> = {
  200: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"plan":"basic"}' },
  401: { status: 401, headers: { 'content-type': 'application/json' }, body: '{"error":"invalid key"}' },
  503: { status: 503, headers: { 'content-type': 'text/plain' }, body: 'try again later' },
  timeout: 'hang',
};

interface Setup { h: ExtensionHost; store: TestStore; api: TestServer; routed: RoutedClient; mode: { now: KeyCase } }
let setup: Promise<Setup> | undefined;
const world = (): Promise<Setup> => (setup ??= (async () => {
  const mode = { now: '200' as KeyCase };
  const api = await testServer((req) => (req.url === '/v1/key' ? ANSWERS[mode.now] ?? { status: 500 } : { status: 404 }));
  const routed = routedClient({ [MARKET]: api });
  const store = memoryStore();
  const w = await openWorld();
  const h = await openHost(w, { secrets: store, http: routed.client });
  await installAndLoad(h, await marketPackage({ auth: 'header', keyTest: true, timeout: 500 }));
  return { h, store, api, routed, mode };
})());

/** Runs every case through `enter` against the recorded provider; each case's problems, by the judge. */
async function cases(enter: (s: Setup) => ExtensionHost['enterSecret']): Promise<{ problems: string[]; keyCalls: { url: string; key: string | undefined }[] }> {
  const s = await world();
  const problems: string[] = [];
  const keyCalls: { url: string; key: string | undefined }[] = [];
  for (const { case: c } of KEY_CASES) {
    s.store.clear();
    s.mode.now = c;
    if (c === 'no network') s.routed.offline.add(MARKET);
    else s.routed.offline.delete(MARKET);
    const before = s.api.seen.length;
    const entered = await enter(s)(YOU, MARKET_ID, 'market_key', KEY);
    keyCalls.push(...s.api.seen.slice(before).map((r) => ({ url: r.url, key: r.headers['x-api-key'] })));
    problems.push(...judgeKeyTest(c, entered, s.store.holds(KEY)));
  }
  s.routed.offline.delete(MARKET);
  return { problems, keyCalls };
}

describe('AC6 #364.9f6db5ef the price source\'s key test reads valid and saves on 200, invalid and saves nothing on 401, and INCONCLUSIVE and saves the value on 503, on a timeout and with no network; a test that rejects the value on the 503, the timeout or no network fails, naming the case', () => {
  it('AC6 each case reads and saves as the issue says, and the test call carries the value as entered', async () => {
    const { problems, keyCalls } = await cases((s) => s.h.enterSecret.bind(s.h));
    expect(problems).toEqual([]);
    // One key-test call per case the provider answers (200, 401, 503, timeout); none reaches it with no network.
    expect(keyCalls, 'key-test calls that reached the provider').toEqual(Array(4).fill({ url: '/v1/key', key: KEY }));
  }, 120_000);

  it('AC6 (wrong program) a key test that rejects the value on the 503, the timeout and no network fails, naming each case', async () => {
    const { problems } = await cases((s) => rejectsWhenUnsure(s.h, s.store));
    for (const c of ['503', 'timeout', 'no network']) expect(problems.some((p) => p.startsWith(`${c}:`)), `${c}: ${problems.join('\n')}`).toBe(true);
  }, 120_000);
});
