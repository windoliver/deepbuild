// AC2 (README, Criteria): "A weekly brief of my watchlist and CI status" builds with no new data code. The design
// spells the composition out: the stocks plug-in's readings plus the CI plug-in's readings, a schedule, the runner and
// a send to you. Read here as a package whose data comes only through its two uses: its manifest declares no source,
// store, secret or event kind, its grant names no record kind and no host but the mail host its one send goes to, and
// its code calls no deep.registerSource, deep.store*, deep.fetch, deep.secret or deep.record.*; it installs beside the
// two plug-ins, its uses wire to them, and one run sends you one brief holding both plug-ins' readings. The runner
// (a model job) isn't data code and needs a live agent here, so it is left out (README, Ambiguities).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  admitted, edgesOf, HOUR, ID, json, makePackage, openHost, openWorld, piece, provides, routedClient, server, shape, uses, YOU, type Json,
} from './helpers.ts';

const PRICES = 'ext.stocks.prices@1';
const CI = 'ext.ci.status@1';
const MAIL = 'api.mail.example';
const ME = 'you@example.test';
const text = { type: 'string' };
const PRICES_SHAPE = shape({ readings: { type: 'array', items: shape({ symbol: text, cents: { type: 'integer' } }) } });
const CI_SHAPE = shape({ checks: { type: 'array', items: shape({ name: text, state: text }) } });
const WATCHLIST = { readings: [{ symbol: 'ACME', cents: 12345 }, { symbol: 'INIT', cents: 6789 }] };
const CHECKS = { checks: [{ name: 'build', state: 'passed' }, { name: 'e2e', state: 'failed' }] };

/** The brief: two uses, one schedule, one send; nothing else. */
const BRIEF_INDEX = `// The weekly brief (#103 AC2): the stocks plug-in's readings plus the CI plug-in's, a schedule and a send to you.
const strict = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const runs: any[] = [];

export default async function (deep: any): Promise<void> {
  await deep.use('${PRICES}');
  await deep.use('${CI}');
  await deep.schedule('ext.brief.weekly', {
    cron: '0 9 * * 1', deadline: 120_000, declares: { readings: [], notices: [], stores: [], sends: ['email'], noop: false },
  }, async (ctx: { run: string; at: number }) => {
    const prices = await deep.read('${PRICES}');
    const ci = await deep.read('${CI}');
    const lines = [
      ...(prices.value?.readings ?? []).map((r: any) => r.symbol + ' ' + (r.cents / 100).toFixed(2)),
      ...(ci.value?.checks ?? []).map((c: any) => c.name + ': ' + c.state),
    ];
    const key = 'brief-' + new Date(ctx.at).toISOString().slice(0, 10) + '-' + ctx.run.toLowerCase().replace(/[^a-z0-9]/g, '');
    const sent = await deep.send({ kind: 'email', key, to: ['${ME}'], subject: 'Your weekly brief', body: lines.join('\\n'), host: '${MAIL}', path: '/send' });
    runs.push({ run: ctx.run, key, sent });
  });
}
`;
/** What "new data code" would call: a source, a store, an outside call of its own, a secret, the record. */
const DATA_CALLS = /deep\.(registerSource|store|fetch|secret|record)\b/;

describe(`${ID.ac2} "A weekly brief of my watchlist and CI status" builds with no new data code`, () => {
  it('AC2 the brief is two uses, a schedule and a send: it installs, wires to the stocks and CI plug-ins, and its run sends you a brief of both readings', async () => {
    const mail = await server((req) => (req.url.startsWith('/send') ? json({ accepted: true }, 202) : { status: 404 }));
    const w = await openWorld();
    const h = await openHost(w, { http: routedClient({ [MAIL]: mail }).client });
    await admitted(h, await piece({ id: 'acme/stocks', spec: { outputs: [{ interface: PRICES, kind: 'reading', schema: PRICES_SHAPE, value: WATCHLIST }] }, manifest: { provides: [provides(PRICES, [PRICES_SHAPE])] } }), 'the stocks plug-in');
    await admitted(h, await piece({ id: 'acme/ci', spec: { outputs: [{ interface: CI, kind: 'reading', schema: CI_SHAPE, value: CHECKS }] }, manifest: { provides: [provides(CI, [CI_SHAPE])] } }), 'the CI plug-in');
    const dir = await makePackage({
      id: 'acme/brief', index: BRIEF_INDEX,
      manifest: { access: { words: ['hosts'] }, uses: [uses(PRICES, 0, PRICES_SHAPE), uses(CI, 0, CI_SHAPE)] },
    });

    // No new data code: the package as written.
    const manifest = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as Json;
    for (const field of ['sources', 'stores', 'secrets', 'events', 'checks', 'provides']) expect(manifest[field], `the brief's manifest declares no ${field}`).toBeUndefined();
    expect(manifest.access.words, 'its only access word is hosts, for the send').toEqual(['hosts']);
    expect(readFileSync(join(dir, 'index.ts'), 'utf8').match(DATA_CALLS), 'its code calls no source, store, outside call, secret or record method').toBeNull();

    // Its grant: the mail host its send goes to, and nothing else.
    await admitted(h, dir, 'the brief', { hosts: [{ host: MAIL, quota: { calls: 100, per_ms: HOUR } }] });
    const edges = (await edgesOf(h)).filter((e) => e.user === 'acme/brief');
    expect(edges, 'its two uses are wired to the stocks and CI plug-ins').toEqual([
      { user: 'acme/brief', uses: CI, interface: CI, provider: 'acme/ci' },
      { user: 'acme/brief', uses: PRICES, interface: PRICES, provider: 'acme/stocks' },
    ]);

    await h.setSendRule(YOU, { sentence: 'Send me my weekly brief', piece: 'acme/brief', recipients: [ME], schedule: 'ext.brief.weekly' });
    await h.runNow(YOU, 'ext.brief.weekly');
    await h.idle();
    const posts = mail.seen.filter((s) => s.method === 'POST' && s.url.startsWith('/send'));
    expect(posts, 'one brief went out').toHaveLength(1);
    const body = JSON.parse(posts[0]!.body) as { to: string[]; body: string };
    expect(body.to, 'to you').toEqual([ME]);
    expect(body.body.split('\n'), 'it holds the watchlist\'s prices and the CI status, read through the two uses').toEqual(['ACME 123.45', 'INIT 67.89', 'build: passed', 'e2e: failed']);
    expect((await h.sends()).map((s) => s.outcome), 'the send is recorded as sent').toEqual(['sent']);
  }, 180_000);
});
