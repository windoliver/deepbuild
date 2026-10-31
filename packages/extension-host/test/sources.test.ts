// #364's scope beyond its checkbox criteria: a source that fails backs off, each call's cost and each reading is
// recorded, readings are queried by window, a secret is removed only on a yes naming what goes BLOCKED, the Keychain
// keeps a secret without it ever being on a command line, sign-in goes through an OAuth loopback, and a stream source
// is read at run time from a cursor the hub keeps across a restart, each event held to the reading type it names.
// Each runs a real package through a real host and record; the provider is an HTTP client the test answers.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openRecord, type Event, type RecordStore } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';
import { keychainStore, openExtensionHost, openTrust, packageDigest, type ExtensionHost, type HttpAnswer, type HttpClient, type HttpRequest, type SecretStore } from '../src/index.js';

const dirs: string[] = [];
const closing: { close(): Promise<void> }[] = [];
afterAll(async () => {
  for (const c of closing.reverse()) await c.close().catch(() => undefined);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const temp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'deep-src-test-')));
  dirs.push(d);
  return d;
};

const KEY = 'mk/test+51f0c9=';
const MARKET = 'api.market.example';
const PRICE = 'ext.market.price';
const YOU = { writer: 'app', actor: 'you', scope: 'you' };
const AGENT = { writer: 'hook', actor: 'you', scope: 'you', session: 's1' };
const FRESH = 60_000;

/** A release package of `code`, its manifest's fields given, its digest stamped. */
function pkgOf(id: string, code: string, fields: Record<string, unknown>): { folder: string; digest: string } {
  const folder = temp();
  writeFileSync(join(folder, 'index.ts'), code);
  const manifest = { id, version: '1.0.0', digest: '', ...fields };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  return { folder, digest: packageDigest(folder) };
}
/** The price source: the market key as X-Api-Key, or as a bearer token signed in through `oauth`. */
const market = (auth: Record<string, unknown> = { header: 'X-Api-Key' }) => pkgOf('deepbuild/market', `export default async function (deep) {
  const handle = await deep.secret('market_key');
  await deep.registerSource('ext.market.price', {
    variant: 'polled', host: 'api.market.example', path: '/q', secret: handle, ...${JSON.stringify(auth)},
    quota: { per_minute: 100, per_day: 1000 }, timeout: 300, freshFor: ${FRESH},
    parse(answer) {
      if (answer.status !== 200) throw Error('no price in a ' + answer.status + ' answer');
      return { value: Number(JSON.parse(answer.body).price), unit: 'USD' };
    },
  });
}
`, {
  secrets: [{ name: 'market_key', for: 'the market data API\'s key' }], sources: [{ name: PRICE, variant: 'polled' }],
  requires: { preview: ['deep.registerSource', 'deep.secret'] },
});

/** A store in memory, standing in for the OS one. */
function memory(): SecretStore & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return { entries, get: async (k) => entries.get(k), set: async (k, v) => { entries.set(k, v); }, delete: async (k) => { entries.delete(k); } };
}
/** The provider, answering each call through `answer`; `asked` keeps every call. */
function provider(answer: (r: HttpRequest) => HttpAnswer | Promise<HttpAnswer>): { client: HttpClient; asked: HttpRequest[] } {
  const asked: HttpRequest[] = [];
  return { asked, client: async (r) => { asked.push(structuredClone(r)); return answer(r); } };
}
const price = (p: number): HttpAnswer => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ price: p }) });
const status = (s: number): HttpAnswer => ({ status: s, headers: {}, body: '' });

interface World { h: ExtensionHost; record: RecordStore; store: ReturnType<typeof memory>; again(): Promise<ExtensionHost>; events(kind: string): Promise<Event[]> }
async function world(pkg: { folder: string; digest: string }, options: { client: HttpClient; now?: () => number; browse?: (url: string) => Promise<void>; grant?: string[] }): Promise<World> {
  const dir = temp();
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  closing.push(record, supervisor);
  const trust = await openTrust({ record, now: Date.now });
  const home = join(dir, 'home');
  mkdirSync(home);
  const store = memory();
  const manifest = JSON.parse(readFileSync(join(pkg.folder, 'deepbuild.json'), 'utf8')) as { id: string };
  const open = async (): Promise<ExtensionHost> => {
    const h = await openExtensionHost({
      record, supervisor, trust, home, now: options.now ?? Date.now, release: [{ id: manifest.id, version: '1.0.0', digest: pkg.digest }],
      secrets: store, http: options.client, ...(options.browse ? { browse: options.browse } : {}),
    });
    closing.push(h);
    await h.ready();
    return h;
  };
  /** A host on this home, as after a restart of the hub, loading what is installed. */
  const again = async (): Promise<ExtensionHost> => {
    const h = await open();
    for (const p of await h.installed()) expect((await h.load(p)).status).toBe('loaded');
    return h;
  };
  const h = await open();
  const p = await h.install({ from: pkg.folder, builtBy: null, grant: { hosts: (options.grant ?? [MARKET]).map((host) => ({ host, quota: { calls: 1000, per_ms: 3_600_000 } })) } });
  expect((await h.check(p)).passed).toBe(true);
  expect((await h.load(p)).status).toBe('loaded');
  const events = async (kind: string) => (await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === kind);
  return { h, record, store, again, events };
}

describe('#364 back-off, cost and readings', () => {
  it('a call the provider fails backs off: no call until its gap passes, each failure doubles it, and an answer resets it', async () => {
    let now = 1_760_000_000_000;
    const answers = [status(503), status(503), price(187.25), status(429)];
    const p = provider(() => answers.shift() ?? price(1));
    const w = await world(market(), { client: p.client, now: () => now });
    await w.h.enterSecret(YOU, 'deepbuild/market', 'market_key', KEY);
    expect((await w.h.readSource(PRICE)).status).toBe('failed');
    now += 500;
    expect(await w.h.readSource(PRICE)).toMatchObject({ status: 'failed', cause: expect.stringMatching(/backing off/) });
    expect(p.asked.length, 'no call while it backs off').toBe(1);
    now += 500;
    expect((await w.h.readSource(PRICE)).status).toBe('failed');
    expect(p.asked.length).toBe(2);
    now += 1_500;
    expect(await w.h.readSource(PRICE), 'the gap doubled to 2 s').toMatchObject({ status: 'failed', cause: expect.stringMatching(/backing off/) });
    now += 500;
    expect(await w.h.readSource(PRICE)).toMatchObject({ status: 'reading', reading: { value: 187.25 } });
    now += FRESH;
    expect((await w.h.readSource(PRICE)).status, 'a rate limit backs off too').toBe('failed');
    now += 1_000;
    expect(p.asked.length).toBe(4);
    await w.h.readSource(PRICE);
    expect(p.asked.length, 'after an answer the gap starts again at 1 s').toBe(5);
  });

  it('each live call records its cost as source.called by the core, naming no URL, header or value; a timeout records no status', async () => {
    const answers: (HttpAnswer | 'hang')[] = [price(187.25), 'hang'];
    let now = 1_760_000_000_000;
    const p = provider(() => { const a = answers.shift(); return a === 'hang' ? new Promise<HttpAnswer>(() => undefined) : a ?? price(1); });
    const w = await world(market(), { client: p.client, now: () => now });
    await w.h.enterSecret(YOU, 'deepbuild/market', 'market_key', KEY);
    await w.h.readSource(PRICE);
    now += FRESH;
    expect(await w.h.readSource(PRICE)).toMatchObject({ status: 'failed', cause: expect.stringMatching(/timeout/) });
    const called = await w.events('source.called');
    expect(called.map((e) => e.writer)).toEqual(['core', 'core']);
    expect(called.map((e) => e.data)).toMatchObject([
      { source: PRICE, host: MARKET, outcome: 'answered', status: 200, bytes: Buffer.byteLength(price(187.25).body) },
      { source: PRICE, host: MARKET, outcome: 'timeout', bytes: 0 },
    ]);
    expect(called[1]!.data).not.toHaveProperty('status');
    const text = JSON.stringify(called);
    for (const s of [KEY, '/q', 'X-Api-Key']) expect(text).not.toContain(s);
  });

  it('each reading the hub makes is recorded once by the core, and readings(source, window) gives those in the window in as-of order', async () => {
    const t0 = 1_760_000_000_000;
    let now = t0;
    const prices = [101, 102, 103];
    const p = provider(() => price(prices.shift() ?? 0));
    const w = await world(market(), { client: p.client, now: () => now });
    await w.h.enterSecret(YOU, 'deepbuild/market', 'market_key', KEY);
    for (const at of [t0, t0 + FRESH / 2, t0 + 2 * FRESH, t0 + 4 * FRESH]) { now = at; await w.h.readSource(PRICE); }
    const recorded = await w.events('reading.recorded');
    expect(recorded.map((e) => [e.writer, (e.data as { value: number }).value]), 'the cached read records nothing').toEqual([['core', 101], ['core', 102], ['core', 103]]);
    expect(await w.h.readings(PRICE, { from: t0 + FRESH, to: t0 + 4 * FRESH })).toEqual([
      { source: PRICE, value: 102, unit: 'USD', as_of: t0 + 2 * FRESH },
      { source: PRICE, value: 103, unit: 'USD', as_of: t0 + 4 * FRESH },
    ]);
    expect(await w.h.readings('ext.market.other', { from: t0, to: t0 + 4 * FRESH })).toEqual([]);
  });
});

describe('#364 secrets on the trusted path', () => {
  it('removing a secret lists the sources that go BLOCKED, and removes it only on your yes naming that list', async () => {
    const p = provider(() => price(187.25));
    const w = await world(market(), { client: p.client });
    await w.h.enterSecret(YOU, 'deepbuild/market', 'market_key', KEY);
    expect((await w.h.readSource(PRICE)).status).toBe('reading');
    await expect(w.h.removeSecret(AGENT, 'deepbuild/market', 'market_key', { yes: [PRICE] }), 'an agent removes nothing').rejects.toThrow(/trusted path/);
    expect(await w.h.removeSecret(YOU, 'deepbuild/market', 'market_key')).toEqual({ removed: false, blocked: [PRICE] });
    expect(await w.h.removeSecret(YOU, 'deepbuild/market', 'market_key', { yes: [] }), 'a yes to another list').toEqual({ removed: false, blocked: [PRICE] });
    expect([...w.store.entries.values()]).toEqual([KEY]);
    expect(await w.h.removeSecret(YOU, 'deepbuild/market', 'market_key', { yes: [PRICE] })).toEqual({ removed: true, blocked: [PRICE] });
    expect([...w.store.entries.values()]).toEqual([]);
    expect(await w.h.readSource(PRICE), 'its cached reading goes with it').toMatchObject({ status: 'BLOCKED', cause: expect.stringMatching(/missing secret market_key/) });
  });

  it.runIf(process.platform === 'darwin')('the Keychain store keeps, reads and deletes a value in its keychain', async () => {
    const keychain = join(temp(), 'test.keychain-db');
    execFileSync('/usr/bin/security', ['create-keychain', '-p', 'test', keychain]);
    try {
      const store = keychainStore(keychain);
      const value = `${KEY} "quoted" and \\ spaced`;
      expect(await store.get('deepbuild/deepbuild/market/market_key')).toBeUndefined();
      await store.set('deepbuild/deepbuild/market/market_key', value);
      expect(await store.get('deepbuild/deepbuild/market/market_key')).toBe(value);
      await store.set('deepbuild/deepbuild/market/market_key', KEY);
      expect(await store.get('deepbuild/deepbuild/market/market_key'), 'set again replaces it').toBe(KEY);
      await store.delete('deepbuild/deepbuild/market/market_key');
      expect(await store.get('deepbuild/deepbuild/market/market_key')).toBeUndefined();
    } finally {
      execFileSync('/usr/bin/security', ['delete-keychain', keychain]);
    }
  });

  it('sign-in through an OAuth loopback: the browser goes to the source\'s host with PKCE and a state, the code comes back to 127.0.0.1, and the token is saved as the secret', async () => {
    const seen: { challenge?: string } = {};
    const p = provider((r) => {
      if (r.url === `https://${MARKET}/oauth/token` && r.method === 'POST') {
        const form = new URLSearchParams(r.body ?? '');
        const verified = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === seen.challenge;
        if (form.get('code') !== 'c0de' || !verified || form.get('grant_type') !== 'authorization_code') return { status: 400, headers: {}, body: '{"error":"invalid_grant"}' };
        return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"access_token":"tok-123","token_type":"Bearer"}' };
      }
      return r.headers.authorization === 'Bearer tok-123' ? price(187.25) : status(401);
    });
    let wrongState = false;
    const browse = async (url: string): Promise<void> => {
      const u = new URL(url);
      expect([u.origin, u.pathname]).toEqual([`https://${MARKET}`, '/oauth/authorize']);
      expect(u.searchParams.get('code_challenge_method')).toBe('S256');
      seen.challenge = u.searchParams.get('code_challenge') ?? undefined;
      const back = new URL(u.searchParams.get('redirect_uri')!);
      expect(back.hostname).toBe('127.0.0.1');
      back.searchParams.set('code', 'c0de');
      back.searchParams.set('state', wrongState ? 'not-the-state' : u.searchParams.get('state')!);
      await fetch(back);
    };
    const w = await world(market({ bearer: true, oauth: { authorize: '/oauth/authorize', token: '/oauth/token', client: 'deepbuild-test' } }), { client: p.client, browse });
    wrongState = true;
    await expect(w.h.signIn(YOU, 'deepbuild/market', 'market_key'), 'a callback with another state').rejects.toThrow(/state/);
    expect(w.store.entries.size).toBe(0);
    wrongState = false;
    expect(await w.h.signIn(YOU, 'deepbuild/market', 'market_key')).toEqual({ saved: true });
    expect([...w.store.entries.values()]).toEqual(['tok-123']);
    expect(await w.h.readSource(PRICE)).toMatchObject({ status: 'reading', reading: { value: 187.25 } });
    expect(JSON.stringify(w.h.recording())).not.toContain('tok-123');
  });
});

describe('#364 stream sources at run time', () => {
  // A source no HTTP call feeds: its upstream is its own list of pushes. The kit hands it its own stream at install.
  const pushes = (n: number) => Array.from({ length: n }, (_, i) => ({ seq: i + 1, kind: 'push', data: { commit: String(i + 1).repeat(40).slice(0, 40), pusher: i % 2 ? null : 'maya' } }));
  const forge = () => pkgOf('deepbuild/forge', `const UPSTREAM = { events: [...${JSON.stringify(pushes(4))}, { seq: 5, kind: 'push', data: { commit: 'not-a-sha', pusher: 'maya' } }] };
export default function (deep) {
  deep.registerSource('ext.forge.pushes', {
    variant: 'stream',
    read(stream, cursor, limit) {
      const all = (stream ?? UPSTREAM).events;
      const start = cursor === null ? 0 : Number(cursor);
      const events = all.slice(start, start + limit);
      return { events, cursor: String(start + events.length) };
    },
  });
}
`, { sources: [{ name: 'ext.forge.pushes', variant: 'stream', reading: 'push.record@1' }], requires: { preview: ['deep.registerSource'] } });

  it('reads on from the cursor the hub keeps, across a restart, and refuses a page with an event that isn\'t its reading type, the cursor kept', async () => {
    const w = await world(forge(), { client: provider(() => status(500)).client, grant: [] });
    expect(await w.h.readStream('ext.forge.pushes', 2)).toEqual({ status: 'events', source: 'ext.forge.pushes', events: pushes(2) });
    const h = await w.again();
    expect((await h.loaded()).map((l) => l.id)).toContain('deepbuild/forge');
    expect(await h.readStream('ext.forge.pushes', 2), 'after a restart, the next page').toEqual({ status: 'events', source: 'ext.forge.pushes', events: pushes(4).slice(2) });
    for (let i = 0; i < 2; i++) {
      expect(await h.readStream('ext.forge.pushes', 2), 'the bad event stays unread').toMatchObject({ status: 'failed', cause: expect.stringMatching(/event 5 isn't push\.record@1/) });
    }
  });
});
