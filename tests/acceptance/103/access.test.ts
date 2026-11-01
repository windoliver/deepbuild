// No access through composition (README, Criteria): AC3, a composite's secrets are its own; AC4, a job a sandboxed user
// starts on a used piece's reading runs under the user's grant, never the provider's; AC11, an action called through an
// edge asks as the calling piece; AC12, another piece's store comes only through a declared use, which a new version
// of it then reopens.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import {
  act, admitted, asksNaming, answer, HOUR, home, ID, jobsOf, json, makePackage, openHost, openWorld, piece, provides, readThrough, reopenCounts, report,
  routedClient, seedSession, server, shape, sleep, tempDir, tested, uses, waitUntil, YOU, type Json, type Provider, type World,
} from './helpers.ts';

const text = { type: 'string' };
const int = { type: 'integer' };
const num = { type: 'number' };
const STRICT = (properties: Record<string, Json>) => shape(properties);
const P1 = 'ext.stocks.prices@1';
const PRICE_SHAPE = STRICT({ symbol: text, cents: int });
const PRICE = { symbol: 'ACME', cents: 12345 };
const grantHosts = (...names: string[]) => names.map((host) => ({ host, quota: { calls: 1_000, per_ms: HOUR } }));

// ---- AC3
const MARKET = 'api.market.example';
/** A market key (a test value). */
const KEY = 'mk/test+103c0de=';
const STOCKS_INDEX = `// The stocks plug-in (#103 AC3): a price source on the market host with your market key, and its prices@1 reading.
export default async function (deep: any): Promise<void> {
  const key = await deep.secret('market_key');
  await deep.registerSource('ext.stocks.price', {
    variant: 'polled', host: '${MARKET}', path: '/q/stocks', secret: key, header: 'X-Api-Key',
    quota: { per_minute: 600, per_day: 100_000 }, timeout: 15_000, freshFor: 1,
    parse(answer: { status: number; body: string }) { if (answer.status !== 200) throw Error('no price'); return { value: Number(JSON.parse(answer.body).price), unit: 'USD' }; },
  });
  await deep.provide('${P1}', 'reading', ${JSON.stringify(PRICE_SHAPE)}, async () => (${JSON.stringify(PRICE)}));
}
`;
/** The composite: uses the stocks plug-in's prices, and has a secret slot and a source of its own on the same host. */
const COMPOSITE_INDEX = `// The composite (#103 AC3): it uses the stocks plug-in's prices; its own source asks the market host with its own
// market_key, which you never entered for it.
const strict = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export default async function (deep: any): Promise<void> {
  await deep.use('${P1}');
  const key = await deep.secret('market_key');
  await deep.registerSource('ext.brief.peek', {
    variant: 'polled', host: '${MARKET}', path: '/q/brief', secret: key, header: 'X-Api-Key',
    quota: { per_minute: 600, per_day: 100_000 }, timeout: 15_000, freshFor: 1,
    parse(answer: { status: number; body: string }) { if (answer.status !== 200) throw Error('no price'); return { value: Number(JSON.parse(answer.body).price), unit: 'USD' }; },
  });
  await deep.registerAction('ext.brief.read', { declares: 'read', reads: [], input: strict({ interface: { type: 'string' } }), output: strict({ got: { type: 'string' } }) },
    async (input: { interface: string }) => { try { return { got: JSON.stringify(await deep.read(input.interface)) }; } catch (e: any) { return { got: JSON.stringify({ error: String(e?.message ?? e) }) }; } });
}
`;

describe(`${ID.ac3} a composite can't read a secret its own grant doesn't name`, () => {
  it('AC3 the composite reads the stocks plug-in\'s prices through its use, and its own source on the same host never carries the stocks plug-in\'s market key', async () => {
    const market = await server((req) => (req.url.startsWith('/q') ? json({ price: 187.25 }) : { status: 404 }));
    const w = await openWorld();
    const h = await openHost(w, { http: routedClient({ [MARKET]: market }).client });
    await admitted(h, await makePackage({
      id: 'acme/stocks', index: STOCKS_INDEX,
      manifest: { access: { words: ['hosts'] }, secrets: [{ name: 'market_key', for: 'the market data API\'s key' }], sources: [{ name: 'ext.stocks.price', variant: 'polled' }], provides: [provides(P1, [PRICE_SHAPE])] },
    }), 'the stocks plug-in', { hosts: grantHosts(MARKET) });
    await admitted(h, await makePackage({
      id: 'acme/brief', index: COMPOSITE_INDEX,
      manifest: {
        access: { words: ['hosts'] }, secrets: [{ name: 'market_key', for: 'a market key of its own' }], sources: [{ name: 'ext.brief.peek', variant: 'polled' }],
        actions: ['ext.brief.read'], uses: [uses(P1, 0, PRICE_SHAPE)],
      },
    }), 'the composite', { hosts: grantHosts(MARKET) });
    expect((await h.enterSecret(YOU, 'acme/stocks', 'market_key', KEY)).saved, 'your market key is saved for the stocks plug-in').toBe(true);

    // The key works for the piece you entered it for.
    expect((await h.readSource('ext.stocks.price')).status, 'the stocks plug-in\'s source reads with its key').toBe('reading');
    expect(market.seen.filter((s) => s.url.startsWith('/q/stocks')).map((s) => s.headers['x-api-key']), 'its call carried your key').toEqual([KEY]);

    // The composite gets the stocks plug-in's reading through its use, and nothing more.
    const read = await readThrough(h, 'acme/brief', P1);
    expect(read?.value, `the composite reads the prices through its use: ${JSON.stringify(read)}`).toEqual(PRICE);
    expect(JSON.stringify(read), 'the reading carries no key').not.toContain(KEY);

    // Its own source, on the same host, under a secret of the same name: never the stocks plug-in's value.
    const own = await h.readSource('ext.brief.peek');
    expect(own.status, `the composite's own source has no key of its own, so it doesn't read: ${JSON.stringify(own)}`).not.toBe('reading');
    expect(JSON.stringify(own), 'and it names the secret it lacks').toContain('market_key');
    const carried = market.seen.filter((s) => s.url.startsWith('/q/brief') && Object.values(s.headers).some((v) => v.includes(KEY)));
    expect(carried, 'no call for the composite carried the stocks plug-in\'s key').toEqual([]);
  }, 120_000);
});

// ---- AC4
const SESSION = '5e55a0e0-1031-4000-8000-00000000c0de';
const TRANSCRIPT = 'dh103-transcript-marker-sell-in-may';
const NOTES = 'dh103-notes-marker-private';
const DIGEST_INDEX = `// The digest plug-in (#103 AC4): it uses the stocks plug-in's prices and starts a model job on the reading it read.
const strict = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export default async function (deep: any): Promise<void> {
  await deep.use('${P1}');
  await deep.registerAction('ext.digest.ask', { declares: 'read', reads: [], input: strict({ prompt: { type: 'string' } }), output: strict({ got: { type: 'string' } }) },
    async (input: { prompt: string }) => {
      let read: any;
      try {
        read = await deep.read('${P1}');
        const handle = read?.handle;
        if (typeof handle !== 'string') throw Error('the read gave no reading handle: ' + JSON.stringify(read));
        const answer = await deep.runner.run({ prompt: input.prompt.split('{reading}').join(handle), inputs: [handle], budget: { usd: 1 }, deadline: 120_000 });
        return { got: JSON.stringify({ ok: true, read, answer }) };
      } catch (e: any) {
        return { got: JSON.stringify({ ok: false, read, error: String(e?.message ?? e) }) };
      }
    });
}
`;

describe(`${ID.ac4} for a sandboxed plug-in granted only content-free fields, a job it starts with the readings of a piece it uses runs, and nothing the job finds gives it transcript text or a file the grant doesn't name`, () => {
  it('AC4 the job runs on the used piece\'s reading, and the plug-in gets neither your transcript, nor the notes file, nor any cite but that reading, though the provider\'s grant names text', async () => {
    const w = await openWorld({ runner: true });
    const h = await openHost(w);
    await seedSession(w, SESSION, TRANSCRIPT);
    // The provider is granted more than the user: every kind with its text.
    await admitted(h, await piece({ id: 'acme/stocks', spec: { outputs: [{ interface: P1, kind: 'reading', schema: PRICE_SHAPE, value: PRICE }] }, manifest: { provides: [provides(P1, [PRICE_SHAPE])] } }),
      'the stocks plug-in, granted text', { record: ['*'], text: true });
    // The user: sandboxed (not in the release), content-free fields only.
    await admitted(h, await makePackage({ id: 'acme/digest', index: DIGEST_INDEX, manifest: { access: { words: ['agent'] }, actions: ['ext.digest.ask'], uses: [uses(P1, 0, PRICE_SHAPE)] } }),
      'the digest plug-in, content-free', { record: ['*'] });
    expect((await h.loaded()).find((l) => l.id === 'acme/digest')?.place, 'the digest plug-in runs in the sandbox').toBe('sandbox');

    const transcript = join(home(), '.claude', 'projects', '-tmp-dh103-session', `${SESSION}.jsonl`);
    mkdirSync(join(transcript, '..'), { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: SESSION, message: { role: 'user', content: TRANSCRIPT } })}\n`);
    const notes = join(tempDir('notes'), 'notes.txt');
    writeFileSync(notes, `${NOTES}\n`);
    const prompt = [`@read ${transcript}`, `@read ${notes}`, `@answer ${JSON.stringify({ value: 'ACME is near its target', cites: [`session:${SESSION}`, `file:${notes}`, '{reading}'] })}`].join('\n');

    const r = await act(h, 'acme/digest', 'ext.digest.ask', { prompt });
    if (r.status !== 'done') throw Error(`the digest plug-in's action was refused: ${JSON.stringify(r)}`);
    const got = JSON.parse(String((r.output as { got?: unknown }).got)) as Json;
    const handle = got.read?.handle as string;
    expect(got.read?.value, `the digest plug-in read the stocks plug-in's reading through its use: ${JSON.stringify(got.read)}`).toEqual(PRICE);
    expect(got.ok, `the job on that reading ran: ${got.error ?? ''}`).toBe(true);
    expect((await jobsOf(w)).length, 'one job ran').toBe(1);
    const seen = JSON.stringify(got);
    expect(seen.includes(TRANSCRIPT), 'the plug-in got your transcript text').toBe(false);
    expect(seen.includes(NOTES), 'the plug-in got the notes file\'s text').toBe(false);
    expect(got.answer?.cites, 'the only cite it gets is the reading it used').toEqual([handle]);
  }, 300_000);
});

// ---- AC11
const CHAT = 'chat.example';
const POST = 'ext.chat.post@1';
const MUTE = 'ext.chat.mute@1';
const POST_SHAPE = STRICT({ key: text, channel: text, text });
const MUTE_SHAPE = STRICT({ channel: text });
const CHAT_INDEX = `// The chat plug-in (#103 AC11): post (send) and mute (change), each an action output other pieces may use.
const strict = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text = { type: 'string' };
export default async function (deep: any): Promise<void> {
  await deep.provide('${POST}', 'action', ${JSON.stringify(POST_SHAPE)});
  await deep.provide('${MUTE}', 'action', ${JSON.stringify(MUTE_SHAPE)});
  await deep.store('ext.chat.muted', { generation: 1, schema: strict({ channel: text }) });
  await deep.registerAction('ext.chat.post', { declares: 'send', input: ${JSON.stringify(POST_SHAPE)}, output: strict({ key: text }) }, async (input: any) => {
    await deep.send({ kind: 'chat', key: input.key, to: [input.channel], subject: input.key, body: input.text, host: '${CHAT}', path: '/post' });
    return { output: { key: input.key }, report: { verified: true, checked: 'the chat host answered the post' } };
  });
  await deep.registerAction('ext.chat.mute', { declares: 'change', changes: ['ext.chat.muted'], input: ${JSON.stringify(MUTE_SHAPE)}, output: strict({ muted: text }) }, async (input: any) => {
    await deep.store.put('ext.chat.muted', input.channel, { channel: input.channel });
    return { output: { muted: input.channel }, report: { verified: true, checked: 'the channel is in the muted store' } };
  });
  await deep.registerAction('ext.chat.muted_list', { declares: 'read', reads: ['ext.chat.muted'], input: strict({}), output: strict({ channels: { type: 'array', items: text } }) },
    async () => ({ channels: (await deep.store.list('ext.chat.muted')).map((i: any) => i.key) }));
}
`;
const WATCHLIST_INDEX = `// The watchlist plug-in (#103 AC11): no host grant; its job calls the chat plug-in's post, then its mute, through its uses.
const runs: any[] = [];
const said = (e: any) => String(e?.message ?? e);
export default async function (deep: any): Promise<void> {
  await deep.use('${POST}');
  await deep.use('${MUTE}');
  await deep.schedule('ext.watchlist.alert', {
    cron: '0 0 1 1 *', deadline: 300_000, declares: { readings: [], notices: [], stores: [], sends: [], noop: false },
  }, async (ctx: { run: string }) => {
    const r: any = { run: ctx.run };
    runs.push(r);
    try { r.post = { output: await deep.call('${POST}', { key: 'acme-crossed', channel: '#general', text: 'ACME crossed 200' }) }; } catch (e) { r.post = { error: said(e) }; }
    try { r.mute = { output: await deep.call('${MUTE}', { channel: '#random' }) }; } catch (e) { r.mute = { error: said(e) }; }
  });
  await deep.registerCheck('ext.watchlist.report', async () => ({
    outcome: 'failed', testsRun: 1, evidence: [], read: [], mask: null,
    failures: [{ test: 'report', file: 'index.ts', line: 1, stack: null, assertion: false, message: JSON.stringify({ runs }) }],
  }));
}
`;
const WATCHLIST = 'acme/watchlist';

interface ChatScene { w: World; h: ExtensionHost; chat: Provider }
async function chatScene(plant?: string): Promise<ChatScene> {
  const chat = await server((req) => (req.url.startsWith('/post') ? json({ ok: true }) : { status: 404 }));
  const w = await openWorld();
  const h = await openHost(w, { http: routedClient({ [CHAT]: chat }).client, ...(plant ? { plant } : {}) });
  await admitted(h, await makePackage({
    id: 'acme/chat', index: CHAT_INDEX,
    manifest: {
      access: { words: ['hosts'] }, stores: ['ext.chat.muted'], actions: ['ext.chat.post', 'ext.chat.mute', 'ext.chat.muted_list'],
      provides: [provides(POST, [POST_SHAPE], 'action'), provides(MUTE, [MUTE_SHAPE], 'action')],
    },
  }), 'the chat plug-in', { hosts: grantHosts(CHAT) });
  // The watchlist plug-in: no access words, no host grant.
  await admitted(h, await makePackage({ id: WATCHLIST, index: WATCHLIST_INDEX, manifest: { checks: ['ext.watchlist.report'], uses: [uses(POST, 0, POST_SHAPE), uses(MUTE, 0, MUTE_SHAPE)] } }), 'the watchlist plug-in');
  // Your standing rule covers the chat plug-in's own posts to #general.
  await h.setSendRule(YOU, { sentence: 'The chat plug-in may post to #general', piece: 'acme/chat', recipients: ['#general'], schedule: null });
  return { w, h, chat };
}
const posts = (chat: Provider) => chat.seen.filter((s) => s.method === 'POST' && s.url.startsWith('/post'));
const muted = async (h: ExtensionHost): Promise<string[]> => {
  const r = await act(h, 'acme/chat', 'ext.chat.muted_list', {});
  if (r.status !== 'done') throw Error(`muted_list: ${JSON.stringify(r)}`);
  return (r.output as { channels: string[] }).channels;
};

/**
 * The watchlist's job calls post, then mute, through its edges: each raises one ask naming the watchlist plug-in as
 * the caller, and nothing happens before your yes. Throws, naming the caller, when the post goes out with no such ask.
 */
async function callsThroughEdges(plant?: string): Promise<void> {
  const { w, h, chat } = await chatScene(plant);
  // Control: the chat plug-in's own post, as you call it in the app, goes out under your rule with no ask.
  const own = await act(h, 'acme/chat', 'ext.chat.post', { key: 'hello', channel: '#general', text: 'hello' });
  expect(own.status, `the chat plug-in's own post under your rule: ${JSON.stringify(own)}`).toBe('done');
  expect(posts(chat), 'it posted once').toHaveLength(1);
  expect(await w.asks.needsYou(), 'with no ask').toEqual([]);

  await h.runNow(YOU, 'ext.watchlist.alert');
  const first = await waitUntil(async () => {
    const asked = await asksNaming(w, WATCHLIST);
    if (asked.length) return { asked };
    if (posts(chat).length > 1) return { asked };
    return undefined;
  }, 60_000, `an ask naming ${WATCHLIST}, or a post`);
  if (!first.asked.length) throw Error(`the call through the edge posted with no ask naming the caller ${WATCHLIST}: ${posts(chat).length - 1} post(s) went out`);
  await sleep(1_000);
  expect(posts(chat), 'nothing is posted before your yes').toHaveLength(1);
  const asked = await asksNaming(w, WATCHLIST);
  expect(asked, 'one ask, naming the watchlist plug-in as the caller').toHaveLength(1);
  expect(asked[0]!.card, 'the ask is about the post').toContain('post');
  await answer(w, asked[0]!.ask, 'allow');
  await waitUntil(() => posts(chat).length === 2, 30_000, 'the post after your yes');
  expect(JSON.parse(posts(chat)[1]!.body).body, 'the post the watchlist asked for').toBe('ACME crossed 200');

  // The change action: the same way.
  const second = await waitUntil(async () => {
    const left = (await asksNaming(w, WATCHLIST)).filter((a) => a.ask !== asked[0]!.ask);
    return left.length ? left : undefined;
  }, 60_000, `the mute call's ask naming ${WATCHLIST}`);
  expect(second, 'one ask for the mute call, naming the watchlist plug-in').toHaveLength(1);
  expect(second[0]!.card, 'the ask is about mute').toContain('mute');
  await sleep(500);
  expect(await muted(h), 'nothing is muted before your yes').toEqual([]);
  await answer(w, second[0]!.ask, 'allow');
  await h.idle();
  expect(await muted(h), 'muted after your yes').toEqual(['#random']);
  const runs = (await report(h, 'ext.watchlist.report')).runs as Json[];
  expect(runs.map((r) => [r.post, r.mute]), 'both calls returned their action\'s output to the watchlist').toEqual([[{ output: { key: 'acme-crossed' } }, { output: { muted: '#random' } }]]);
  expect(posts(chat), 'and posted once more, no more').toHaveLength(2);
}

describe(`${ID.ac11} a watchlist plug-in with no host grant calls a chat plug-in's post and mute through edges: each asks, naming the watchlist plug-in as the caller, and nothing happens before your yes`, () => {
  it('AC11 the post through the edge raises one ask naming the watchlist plug-in and posts only after your yes; mute, with no standing rule, asks the same way', async () => {
    await callsThroughEdges();
  }, 240_000);

  it('AC11 your no to the post sends nothing, and the watchlist\'s call is refused', async () => {
    const { w, h, chat } = await chatScene();
    await h.runNow(YOU, 'ext.watchlist.alert');
    const asked = await waitUntil(async () => { const a = await asksNaming(w, WATCHLIST); return a.length ? a : undefined; }, 60_000, `an ask naming ${WATCHLIST}`);
    await answer(w, asked[0]!.ask, 'deny');
    const mute = await waitUntil(async () => { const a = (await asksNaming(w, WATCHLIST)).filter((x) => x.ask !== asked[0]!.ask); return a.length ? a : undefined; }, 60_000, 'the mute call\'s ask');
    await answer(w, mute[0]!.ask, 'deny');
    await h.idle();
    expect(posts(chat), 'nothing was posted').toEqual([]);
    expect(await muted(h), 'nothing was muted').toEqual([]);
    const [run] = (await report(h, 'ext.watchlist.report')).runs as Json[];
    expect(typeof run?.post?.error, `the post call was refused to the watchlist: ${JSON.stringify(run)}`).toBe('string');
    expect(typeof run?.mute?.error, 'and so was mute').toBe('string');
  }, 240_000);

  it('AC11 (wrong program) a hub that runs the call under the chat plug-in\'s own grant posts with no ask and fails, naming the caller', async () => {
    await expect(callsThroughEdges('call-under-provider-grant')).rejects.toThrow(/the call through the edge posted with no ask naming the caller acme\/watchlist/);
  }, 240_000);
});

// ---- AC12
const ALERT = 'ext.alerts.alert';
const ALERTS = 'ext.alerts.alerts@1';
const ALERT_SHAPE = STRICT({ symbol: text, above: num });
const ALERTS_SHAPE = STRICT({ alerts: { type: 'array', items: ALERT_SHAPE } });
const ALERTS_INDEX = `// The alerts plug-in (#103 AC12): its alerts in its own store, and its alerts@1 reading of them.
const strict = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const ALERT = '${ALERT}';
const SHAPE = ${JSON.stringify(ALERT_SHAPE)};
export default async function (deep: any): Promise<void> {
  await deep.store(ALERT, { generation: 1, schema: SHAPE });
  await deep.provide('${ALERTS}', 'reading', ${JSON.stringify(ALERTS_SHAPE)}, async () => ({ alerts: (await deep.store.list(ALERT)).map((i: any) => i.value) }));
  await deep.registerAction('ext.alerts.add', { declares: 'change', changes: [ALERT], input: SHAPE, output: strict({ added: { type: 'string' } }) }, async (input: any) => {
    await deep.store.put(ALERT, input.symbol, input);
    return { output: { added: input.symbol }, report: { verified: true, checked: 'the alert is in the store' } };
  });
  await deep.registerAction('ext.alerts.list', { declares: 'read', reads: [ALERT], input: strict({}), output: strict({ alerts: { type: 'array', items: SHAPE } }) },
    async () => ({ alerts: (await deep.store.list(ALERT)).map((i: any) => i.value) }));
}
`;
/** A plug-in that queries the alerts plug-in's store kind and, with `use`, also reads its alerts@1 through a declared use. */
const readerIndex = (me: string, use: boolean) => `// ${me} (#103 AC12): a record query of another plug-in's store kind${use ? ', and a declared use of its alerts@1' : ''}.
const strict = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const said = (e: any) => String(e?.message ?? e);
export default async function (deep: any): Promise<void> {
  ${use ? `await deep.use('${ALERTS}');` : ''}
  await deep.registerAction('ext.${me}.query', { declares: 'read', reads: [], input: strict({}), output: strict({ got: { type: 'string' } }) }, async () => {
    try { return { got: JSON.stringify({ rows: await deep.record.query({ kinds: ['${ALERT}'] }) }) }; } catch (e) { return { got: JSON.stringify({ error: said(e) }) }; }
  });
  ${use ? `await deep.registerAction('ext.${me}.read', { declares: 'read', reads: [], input: strict({ interface: { type: 'string' } }), output: strict({ got: { type: 'string' } }) }, async (input: any) => {
    try { return { got: JSON.stringify(await deep.read(input.interface)) }; } catch (e) { return { got: JSON.stringify({ error: said(e) }) }; }
  });` : ''}
}
`;
const alertsPackage = (version: string) => makePackage({
  id: 'acme/alerts', version, index: ALERTS_INDEX,
  manifest: { stores: [ALERT], actions: ['ext.alerts.add', 'ext.alerts.list'], provides: [provides(ALERTS, [ALERTS_SHAPE])] },
});
const queryOf = async (h: ExtensionHost, id: string, me: string): Promise<Json> => {
  const r = await act(h, id, `ext.${me}.query`, {});
  if (r.status !== 'done') throw Error(`${id}'s query action: ${JSON.stringify(r)}`);
  return JSON.parse(String((r.output as { got?: unknown }).got)) as Json;
};

/** A's query is refused naming the use, the use reaches A, and B's new version reopens A once and reruns their contract test. Throws, naming the kind, when the query is answered. */
async function storeThroughUse(plant?: string): Promise<void> {
  const w = await openWorld();
  const h = await openHost(w, plant ? { plant } : {});
  await admitted(h, await alertsPackage('1.0.0'), 'the alerts plug-in (B)');
  await admitted(h, await makePackage({ id: 'acme/digest', index: readerIndex('digest', true), manifest: { access: { words: ['record'] }, actions: ['ext.digest.query', 'ext.digest.read'], uses: [uses(ALERTS, 0, ALERTS_SHAPE)] } }),
    'the digest plug-in (A), granted every record kind', { record: ['*'] });
  await admitted(h, await makePackage({ id: 'acme/peek', index: readerIndex('peek', false), manifest: { access: { words: ['record'] }, actions: ['ext.peek.query'] } }),
    'a plug-in that only queries, granted every record kind', { record: ['*'] });
  const added = await act(h, 'acme/alerts', 'ext.alerts.add', { symbol: 'ACME', above: 200 });
  expect(added.status, `an alert is added to B's store: ${JSON.stringify(added)}`).toBe('done');

  const query = await queryOf(h, 'acme/digest', 'digest');
  if (Array.isArray(query.rows)) throw Error(`acme/digest's query of ${ALERT} was answered from acme/alerts's store: ${JSON.stringify(query.rows).slice(0, 300)}`);
  expect(query.error, 'the query is refused, naming the kind').toContain(ALERT);
  expect(query.error, 'and naming the use to declare: B\'s alerts@1').toContain(ALERTS);

  const read = await readThrough(h, 'acme/digest', ALERTS);
  expect(read?.value, `the same data reaches A through its use: ${JSON.stringify(read)}`).toEqual({ alerts: [{ symbol: 'ACME', above: 200 }] });

  await admitted(h, await alertsPackage('2.0.0'), 'B\'s new version');
  expect(await reopenCounts(w, 'acme/alerts', '2.0.0'), 'B\'s new version reopens A\'s claims once, and nothing for the piece that only queried').toEqual({ 'acme/digest': 1 });
  const runs = (await tested(w)).filter((t) => t.provider === 'acme/alerts' && t.version === '2.0.0');
  expect(runs, 'the contract test between A and B ran again at the new version, and passed').toEqual([{ user: 'acme/digest', interface: ALERTS, provider: 'acme/alerts', version: '2.0.0', passed: true }]);
}

describe(`${ID.ac12} plug-in A's deep.record.query of B's store kind is refused, naming the use to declare; the same data through a declared use of B's alerts@1 reaches A, and B's new version reopens A's claims once and reruns their contract test`, () => {
  it('AC12 the query is refused naming alerts@1, the use reaches A, and B\'s new version reopens A once (the query-only piece not at all) and reruns the contract test', async () => {
    await storeThroughUse();
  }, 180_000);

  it('AC12 (wrong program) a hub that answers the query from B\'s store fails, naming the kind', async () => {
    // #363's planted record read by the grant's words alone answers another plug-in's kind from its store.
    await expect(storeThroughUse('record-by-grant-words')).rejects.toThrow(/acme\/digest's query of ext\.alerts\.alert was answered from acme\/alerts's store/);
  }, 180_000);
});
