import { beforeAll, describe, expect, it } from 'vitest';
import { AC, FIRST, NAMES, Replica, SECOND, TIMEOUT, assetsOf, dig, figure, lines, list, nodes, openFiles, openWorld, piece, proof, recorded, sessionsOfFixture, show, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(await openFiles()); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

const MARKER = 'dh3575 clipboard marker';

describe(`${AC[6]} in the app the list is text: its rows are in the accessibility tree, a URL copies whole, and nothing fetches`, () => {
  it(`${AC[6]} the replica's accessibility tree holds the list's three rows in order, a row's URL copies as the bytes of its record, and the record holds no source call from the piece's opening to its closing`, async () => {
    const world = must(w, 'a hub with the table import and the table.derive tools');
    const p = must(await piece(world), 'three files fetched after one yes each, imported, and the first two derived into one table');
    const urls = NAMES.map((n) => p.files[n].file.url);
    const doc = figure([FIRST(), SECOND(), list({ of: 'document', fields: ['title', 'publisher', 'edition', 'url'], group: 'none' })], assetsOf(p));
    const r = must(await Replica.launch(world.evidence), 'the app\'s replica over a copy of the hub\'s evidence store');
    const [session, another] = sessionsOfFixture();
    expect([typeof session, typeof another], 'the fixture: the replica\'s own record holds two sessions').toEqual(['string', 'string']);
    expect(await r.page(session!), 'the session\'s page opens').toBe('');
    const events = async (): Promise<unknown[]> => { const s = must(await r.must('reading the replica\'s record', { call: 'stored' }), 'the replica\'s record'); return Array.isArray(s.events) ? s.events : []; };
    const opened = (await events()).length;
    const asked = world.files.requests.length;
    must(await r.must('showing the piece on the session\'s page', { call: 'show', show: { session, document: doc } }), 'the replica shows the fixture piece');
    const seen = must(await r.must('reading the snapshot', { call: 'see' }), 'the replica\'s snapshot');
    const rows = nodes(dig(seen, 'snapshot', 'tree')).filter((n) => (n.role === 'row' || n.role === 'list_item') && urls.some((u) => n.text.includes(u)));
    expect(rows.map((n) => urls.filter((u) => n.text.includes(u))), `the accessibility tree holds three rows, each with its file's URL whole, in the list's order: ${show(rows, 1500)}`).toEqual(urls.map((u) => [u]));

    must(await r.must('putting a marker on the replica\'s own clipboard', { call: 'clipboard', clipboard: { write: MARKER } }), 'the marker');
    const [x, y, width, height] = rows[0]!.bounds;
    must(await r.hid('your drag with the option key across the first row', { kind: 'drag', point: [x + 1, y + 1], to_point: [x + width - 1, y + height - 1], mods: ['alt'] }), 'the drag');
    must(await r.hid('your copy', { kind: 'press', keys: 'cmd-c' }), 'the copy');
    const copied = await r.copied(MARKER);
    const url = must(recorded(p.files.counties), 'the record of the first fetched file').url ?? '';
    proof('ac6-replica.json', { rows, copied, record_url: url });
    expect(url, 'the record holds the URL the hub fetched').toBe(urls[0]);
    expect(copied !== null && Buffer.from(copied, 'utf8').includes(Buffer.from(url, 'utf8')), `the copy of the first row holds its URL as the bytes of its record, ${url}: ${JSON.stringify(copied)}`).toBe(true);

    expect(await r.page(another!), 'the piece closes when another session\'s page opens').toBe('');
    const since = lines((await events()).slice(opened));
    expect(since.filter((e) => e.kind === 'source.called' || dig(e, 'event', 'kind') === 'source.called'), 'the record holds no source call from the piece\'s opening to its closing').toEqual([]);
    expect(world.files.requests.slice(asked), 'and nothing asked the files\' server for anything').toEqual([]);
    await r.stop();
  }, TIMEOUT);
});
