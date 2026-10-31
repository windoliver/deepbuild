// AC2: a plug-in's tests run from recorded source calls with secrets stripped and a clock they control, and make no
// live call.
//
// First the price source is called live (against the local server standing in for api.market.example) twice, the
// clock moved past its freshness between, and the host's recording is taken. Then a new world runs the plug-in from
// that recording alone, on a clock the test sets to a Saturday and moves: no secret is entered there (a recording holds
// none, so a replay needs none), and the HTTP client it is given still reaches the live server, so a live call would
// show in the server's count.
import { describe, expect, it } from 'vitest';
import { installAndLoad, KEY, MARKET, MARKET_ID, marketPackage, memoryStore, openHost, openWorld, PRICE, report, routedClient, testServer, YOU, type MarketReport } from './helpers.ts';
import { formsIn } from './judges.ts';

const FRESH = 60_000;
/** Thursday 29 October 2026, 15:00 UTC: the live run. */
const LIVE = Date.UTC(2026, 9, 29, 15, 0, 0);
/** Saturday 31 October 2026, 10:00 UTC: the replay's own clock. */
const SATURDAY = Date.UTC(2026, 9, 31, 10, 0, 0);

describe('AC2 #364.fd9dab33 a plug-in\'s tests run from recorded source calls with secrets stripped and a clock they control, and make no live call', () => {
  it('AC2 two live price calls record with no form of the key; replayed on a controlled clock they give the same prices as of that clock, the cache holds within freshness, and nothing reaches the network', async () => {
    const prices = [187.25, 188.1, 999];
    const api = await testServer((req) => (req.url === '/q' ? { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ price: prices.shift() }) } : { status: 404 }));

    // The live run, which records.
    let live = LIVE;
    const w1 = await openWorld();
    const h1 = await openHost(w1, { secrets: memoryStore(), http: routedClient({ [MARKET]: api }).client, now: () => live });
    await installAndLoad(h1, await marketPackage({ auth: 'header', freshFor: FRESH }));
    await h1.enterSecret(YOU, MARKET_ID, 'market_key', KEY);
    expect(await h1.readSource(PRICE)).toMatchObject({ status: 'reading', reading: { source: PRICE, value: 187.25, unit: 'USD', as_of: LIVE } });
    live += FRESH + 1_000;
    expect(await h1.readSource(PRICE)).toMatchObject({ status: 'reading', reading: { value: 188.1, as_of: LIVE + FRESH + 1_000 } });
    expect(api.seen.map((s) => s.headers['x-api-key']), 'the live calls carried the key').toEqual([KEY, KEY]);
    const recording = h1.recording();
    expect(recording.calls.map((c) => [c.source, c.request.method, c.request.url]), 'the recorded calls').toEqual([
      [PRICE, 'GET', `https://${MARKET}/q`], [PRICE, 'GET', `https://${MARKET}/q`],
    ]);
    expect(recording.calls.map((c) => ('status' in c.answer ? JSON.parse(c.answer.body).price : c.answer)), 'the recorded answers').toEqual([187.25, 188.1]);
    expect(formsIn(recording, KEY, 'the recording'), 'the recording holds the secret').toEqual([]);

    // The plug-in's test: replayed from the recording (passed as data, as a test fixture would be) on its own clock.
    const liveCalls = api.seen.length;
    let clock = SATURDAY;
    const routed = routedClient({ [MARKET]: api });
    const w2 = await openWorld();
    const h2 = await openHost(w2, { secrets: memoryStore(), http: routed.client, now: () => clock, replay: JSON.parse(JSON.stringify(recording)) });
    await installAndLoad(h2, await marketPackage({ auth: 'header', freshFor: FRESH }));

    expect(await h2.readSource(PRICE), 'the first recorded price, as of the test\'s clock').toMatchObject({ status: 'reading', reading: { source: PRICE, value: 187.25, unit: 'USD', as_of: SATURDAY } });
    clock += FRESH / 2;
    expect(await h2.readSource(PRICE), 'within its freshness, the same reading from the cache').toMatchObject({ status: 'reading', reading: { value: 187.25, as_of: SATURDAY } });
    expect((await report<MarketReport>(h2, 'ext.market.report')).seen.length, 'answers parsed: the cached read made no call').toBe(1);
    clock = SATURDAY + FRESH + 1_000;
    expect(await h2.readSource(PRICE), 'past its freshness, the second recorded price').toMatchObject({ status: 'reading', reading: { value: 188.1, as_of: SATURDAY + FRESH + 1_000 } });
    clock += FRESH + 1_000;
    const spent = await h2.readSource(PRICE);
    expect(spent.status, `a call the recording doesn't hold makes no reading, and isn't made live: ${JSON.stringify(spent)}`).not.toBe('reading');

    expect(api.seen.length, 'calls that reached the live server during the replay').toBe(liveCalls);
    expect(routed.asked, 'calls the replaying hub made through its HTTP client').toEqual([]);
  }, 120_000);
});
