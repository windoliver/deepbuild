// AC1: a secret's value never appears in the record, a log, a URL or a prompt. AC5: an error answer carrying the
// market key raw in its body and base64 and URL-encoded in its headers reaches the plug-in's parser as
// `invalid key [redacted]` with no form of the key; a hub that scrubs only logs and traces fails, naming the form.
// AC7: the key sent as Basic credentials for `user:` and echoed in a header in the URL-safe alphabet reaches the
// parser in neither form; a hub that scrubs only the key's own base64 in the standard alphabet fails, naming the form.
//
// Every call goes to a local server standing in for api.market.example, through the HTTP client the hub is given
// (helpers.ts, routedClient). The key is entered on the trusted path into an in-memory store standing in for the OS
// one, so no file holds it unless the hub wrote it there.
import { describe, expect, it } from 'vitest';
import type { HttpAnswer } from '../../../packages/extension-host/src/index.ts';
import { toJson } from '../../../packages/record/src/index.ts';
import {
  filesHolding, home, installAndLoad, KEY, MARKET, MARKET_GRANT, MARKET_ID, marketPackage, memoryStore, openHost, openWorld, PRICE,
  releaseEntry, report, routedClient, tempDir, testServer, toolBefore, YOU, type MarketReport, type Reply,
} from './helpers.ts';
import { formsIn, judgeParser, needles } from './judges.ts';
import { scrubsLogsOnly, scrubsOwnStandardBase64 } from './twins.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const json = (body: unknown, headers: Record<string, string> = {}): Reply => ({ status: 200, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('AC1 #364.8ec0560e a secret\'s value never appears in the record, a log, a URL or a prompt', () => {
  it('AC1 an outside plug-in\'s price call carries the key only in its X-Api-Key header, and no form of it is in the URL, what the plug-in or the caller gets, the record, or any file the hub wrote', async () => {
    // The provider echoes the key back, in a header and in the body, so the plug-in's side has it to leak if the hub let it.
    const api = await testServer((req) => (req.url === '/q' ? json({ price: 187.25, echo: req.headers['x-api-key'] ?? '' }, { 'x-echo': req.headers['x-api-key'] ?? '' }) : { status: 404 }));
    const routed = routedClient({ [MARKET]: api });
    const w = await openWorld();
    const h = await openHost(w, { secrets: memoryStore(), http: routed.client });
    const dir = await marketPackage({ auth: 'header' });
    await installAndLoad(h, dir);

    const entered = await h.enterSecret(YOU, MARKET_ID, 'market_key', KEY);
    expect(entered, 'a source with no key test saves the value untested').toEqual({ test: 'untested', saved: true });
    const read = await h.readSource(PRICE);
    expect(read, 'the price reading').toMatchObject({ status: 'reading', reading: { source: PRICE, value: 187.25, unit: 'USD' } });

    // The URL: what the hub asked its client for, and what reached the provider.
    expect(api.seen.map((s) => s.url), 'calls that reached api.market.example').toEqual(['/q']);
    expect(routed.asked.map((r) => r.url), 'calls the hub made').toEqual([`https://${MARKET}/q`]);
    expect(api.seen[0]!.headers['x-api-key'], 'the key, in the header the source names').toBe(KEY);
    const { 'x-api-key': _key, ...otherHeaders } = api.seen[0]!.headers;
    expect(formsIn({ url: api.seen[0]!.url, headers: otherHeaders }, KEY, 'the request beyond its X-Api-Key header'), 'the key anywhere else in the request').toEqual([]);
    expect(formsIn(routed.asked.map((r) => r.url), KEY, 'a URL the hub called'), 'the key in a URL').toEqual([]);

    // What the plug-in got (its handle and every answer its parser was given) and what the hub answered its caller.
    const got = await report<MarketReport>(h, 'ext.market.report');
    expect(got.seen.length, 'answers the parser was given').toBe(1);
    expect(typeof got.handle === 'string' && got.handle.length > 0, `deep.secret gives a handle: ${JSON.stringify(got.handle)}`).toBe(true);
    expect(formsIn(got, KEY, 'what the plug-in got'), 'the key in what the plug-in got').toEqual([]);
    expect(formsIn({ entered, read }, KEY, 'what the hub answered'), 'the key in what the hub answered').toEqual([]);

    // The record, read back, and every file under the world, the package and HOME (logs among them), on disk with
    // the record open and again after the host and the record closed.
    await w.record.sync();
    const events = await w.events();
    expect(events.filter((e) => formsIn(toJson(e), KEY, e.kind).length).map((e) => e.kind), 'events holding a form of the key').toEqual([]);
    const control = tempDir('control');
    writeFileSync(join(control, 'control.txt'), `Basic ${Buffer.from(`user:${KEY}`).toString('base64')}`);
    expect(filesHolding(needles(KEY), [control]).length, 'the search finds a form that is there').toBe(1);
    const roots = [w.dir, dir, home()];
    expect(filesHolding(needles(KEY), roots), 'files holding a form of the key, with the record open').toEqual([]);
    await h.close();
    await w.close();
    expect(filesHolding(needles(KEY), roots), 'files holding a form of the key, after the host and the record closed').toEqual([]);
  }, 120_000);

  it('AC1 a release plug-in that puts everything it was given into a tool.before context puts no form of the key in what reaches the agent\'s prompt', async () => {
    const api = await testServer((req) => (req.url === '/q' ? json({ price: 187.25, echo: req.headers['x-api-key'] ?? '' }, { 'x-echo': req.headers['x-api-key'] ?? '' }) : { status: 404 }));
    const routed = routedClient({ [MARKET]: api });
    const dir = await marketPackage({ auth: 'header', hook: true }, { id: 'deepbuild/market' });
    const w = await openWorld();
    const h = await openHost(w, { secrets: memoryStore(), http: routed.client, release: [await releaseEntry(dir)] });
    await installAndLoad(h, dir, { ...MARKET_GRANT, record: ['tool.before'] });
    expect((await h.loaded()).find((l) => l.id === 'deepbuild/market')?.place, 'the release copy runs in the hub').toBe('hub');

    await h.enterSecret(YOU, 'deepbuild/market', 'market_key', KEY);
    expect(await h.readSource(PRICE)).toMatchObject({ status: 'reading', reading: { value: 187.25 } });
    expect(api.seen[0]?.headers['x-api-key'], 'the key went to the provider').toBe(KEY);

    const reply = await h.hook(toolBefore());
    const prompt = reply.context.filter((b) => b.extension === 'deepbuild/market').map((b) => b.text).join('\n');
    expect(prompt, 'the context holds what the plug-in was given: the answer it parsed').toContain('187.25');
    expect(formsIn({ context: reply.context, denies: reply.denies }, KEY, 'what reaches the agent'), 'the key in the prompt').toEqual([]);
  }, 120_000);
});

/** One price call answered by `reply`, through a sandboxed market package; what the client and the parser got. */
async function scrubScenario(auth: 'header' | 'basic', reply: (req: { url: string; headers: Record<string, string> }) => Reply) {
  const api = await testServer(reply);
  const routed = routedClient({ [MARKET]: api });
  const w = await openWorld();
  const h = await openHost(w, { secrets: memoryStore(), http: routed.client });
  await installAndLoad(h, await marketPackage({ auth }));
  const entered = await h.enterSecret(YOU, MARKET_ID, 'market_key', KEY);
  expect(entered.saved, `the key is saved: ${JSON.stringify(entered)}`).toBe(true);
  const read = await h.readSource(PRICE);
  const got = await report<MarketReport>(h, 'ext.market.report');
  expect(routed.answers.length, 'answers the client got').toBe(1);
  const raw: HttpAnswer = routed.answers[0]!.answer;
  return { api, read, raw, parser: got.seen };
}

describe('AC5 #364.161145a6 with the market key mk/test+51f0c9=, a recorded error answer whose body reads "invalid key mk/test+51f0c9=" and whose headers carry the key base64 and URL-encoded reaches the plug-in\'s parser as "invalid key [redacted]", with no form of the key anywhere in what it gets; a hub that scrubs only logs and traces fails, naming the form it found', () => {
  let s: ReturnType<typeof scrubScenario> | undefined;
  // The provider's recorded error answer, served by the local server standing in for api.market.example.
  const scenario = () => (s ??= scrubScenario('header', (req) => (req.url === '/q'
    ? { status: 401, headers: { 'content-type': 'text/plain', 'x-key-b64': Buffer.from(KEY).toString('base64'), 'x-key-url': encodeURIComponent(KEY) }, body: `invalid key ${KEY}` }
    : { status: 404 })));

  it('AC5 the parser gets the 401 with its body as "invalid key [redacted]" and no form of the key in its status, headers or body', async () => {
    const { parser, raw } = await scenario();
    // The answer as the client got it carries the key in all three forms, so the scrub has something to do.
    expect(raw.body).toBe(`invalid key ${KEY}`);
    const there = judgeParser(raw, KEY).join('\n');
    for (const form of ['raw', 'URL-encoded', 'base64 at byte offset 0']) expect(there, `the recorded answer carries the key ${form}`).toContain(form);

    expect(parser.length, 'answers the parser was given').toBe(1);
    expect(parser[0]!.status).toBe(401);
    expect(parser[0]!.body, 'the body the parser gets').toMatch(/^invalid key \[redacted\]$/i);
    expect(judgeParser(parser, KEY), 'forms of the key in what the parser got').toEqual([]);
  }, 120_000);

  it('AC5 (wrong program) a hub that scrubs only logs and traces hands the parser the key and fails, naming the form', async () => {
    const { raw } = await scenario();
    const twin = scrubsLogsOnly(raw, KEY);
    expect(formsIn(twin.log, KEY, 'its log'), 'the twin\'s log is scrubbed').toEqual([]);
    const problems = judgeParser([twin.parser], KEY);
    expect(problems.some((p) => p.includes('holds the key raw')), problems.join('\n')).toBe(true);
    expect(problems.some((p) => p.includes('URL-encoded')), problems.join('\n')).toBe(true);
  }, 120_000);
});

describe('AC7 #364.5f1f8998 with the market key mk/test+51f0c9= sent as Basic credentials for user: and the key, so its base64 starts at byte offset 2, and echoed in a header in the URL-safe alphabet, the plug-in\'s parser gets neither form; a hub that scrubs only the key\'s own base64 in the standard alphabet fails, naming the form it found', () => {
  const BASIC = `Basic ${Buffer.from(`user:${KEY}`).toString('base64')}`;
  let s: ReturnType<typeof scrubScenario> | undefined;
  // The provider echoes the credentials it got in its body and the key in a header in the URL-safe alphabet.
  const scenario = () => (s ??= scrubScenario('basic', (req) => (req.url === '/q'
    ? json({ price: 187.25, credentials: req.headers.authorization ?? '' }, { 'x-echo-key': Buffer.from(KEY).toString('base64url') })
    : { status: 404 })));

  it('AC7 the key goes as Basic credentials for user:, and the parser gets neither the base64 at byte offset 2 nor the URL-safe echo', async () => {
    const { api, parser, raw } = await scenario();
    expect(api.seen[0]?.headers.authorization, 'the credentials the hub sent').toBe(BASIC);
    const there = judgeParser(raw, KEY).join('\n');
    expect(there, 'the answer carries the key\'s base64 at byte offset 2').toContain('base64 at byte offset 2');
    expect(there, 'the answer carries the key in the URL-safe alphabet').toContain('URL-safe alphabet');

    expect(parser.length, 'answers the parser was given').toBe(1);
    expect(parser[0]!.status).toBe(200);
    expect(judgeParser(parser, KEY), 'forms of the key in what the parser got').toEqual([]);
  }, 120_000);

  it('AC7 (wrong program) a hub that scrubs only the key\'s own base64 in the standard alphabet leaves the Basic credentials\' base64 and fails, naming byte offset 2', async () => {
    const { raw } = await scenario();
    const problems = judgeParser([scrubsOwnStandardBase64(raw, KEY)], KEY);
    expect(problems.some((p) => p.includes('base64 at byte offset 2')), problems.join('\n')).toBe(true);
  }, 120_000);
});
