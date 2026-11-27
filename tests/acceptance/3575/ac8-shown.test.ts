import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { AC, FIRST, Replica, SECOND, TIMEOUT, assetsOf, figure, isLine, list, openFiles, openWorld, piece, proof, sessionsOfFixture, sha256, show, str, type Line, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(await openFiles()); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

const TASTE = fileURLToPath(new URL('./TASTE.json', import.meta.url));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const LINE = 'sum of 4 rows';

describe(`${AC[8]} shown to you: the list in the app, and a number with its source line open`, () => {
  it(`${AC[8]} the run takes both pictures from the fixture piece in the replica and writes them to the proof folder; whether they look right is one recorded taste call, INCONCLUSIVE without it`, async (ctx) => {
    const world = must(w, 'a hub with the table import and the table.derive tools');
    const p = must(await piece(world), 'three files fetched after one yes each, imported, and the first two derived into one table');
    const doc = figure([FIRST({ show: { source: true } }), SECOND(), list({ of: 'document', fields: ['title', 'publisher', 'edition', 'license', 'url'], group: 'none' })], assetsOf(p));
    const r = must(await Replica.launch(world.evidence), 'the app\'s replica over a copy of the hub\'s evidence store');
    const [session] = sessionsOfFixture();
    expect(await r.page(session!), 'the session\'s page opens').toBe('');
    must(await r.must('showing the piece on the session\'s page', { call: 'show', show: { session, document: doc } }), 'the replica shows the fixture piece');
    const picture = async (what: string): Promise<Buffer> => readFileSync(str(must(await r.must(what, { call: 'screenshot', screenshot: { target: 'window' } }), what).path));
    const snapshot = async (): Promise<string> => JSON.stringify(must(await r.must('reading the snapshot', { call: 'see' }), 'the replica\'s snapshot').snapshot);
    const listed = await picture('the picture of the list in the app');
    const closed = await snapshot();
    const at = must(await r.must('finding the first label\'s number', { call: 'probe', locator: { item: 'first' } }), 'where the first label is drawn').point;
    must(await r.must('the pointer over the first label\'s number', { call: 'act', act: { kind: 'hover', point: at } }), 'the hover');
    must(await r.wait(1000), 'a second of the replica\'s clock');
    const open = await snapshot();
    expect([closed.includes(LINE), open.includes(LINE)], `the pointer over the number opens its source line, which reads ${LINE}`).toEqual([false, true]);
    const lined = await picture('the picture of the number with its source line open');
    await r.stop();
    expect([listed.subarray(0, 8).equals(PNG), lined.subarray(0, 8).equals(PNG), listed.equals(lined)], 'two pictures, both PNGs, and not the same one').toEqual([true, true, false]);
    const pictures = { 'ac8-list-in-app.png': listed, 'ac8-number-source-line.png': lined };
    const hashes = Object.fromEntries(Object.entries(pictures).map(([name, bytes]) => [name, sha256(bytes)]));
    for (const [name, bytes] of Object.entries(pictures)) proof(name, bytes);
    proof('ac8-pictures.json', hashes);

    let call: Line | undefined;
    if (existsSync(TASTE)) { const read: unknown = JSON.parse(readFileSync(TASTE, 'utf8')); if (isLine(read)) call = read; }
    const judged = isLine(call?.files) ? call.files : {};
    if (!call || Object.keys(judged).length !== 2 || Object.entries(hashes).some(([name, hash]) => judged[name] !== hash)) ctx.skip(`INCONCLUSIVE: no taste call is recorded in TASTE.json on these two pictures (${show(hashes, 400)}); this is not a pass`);
    expect(call!.verdict, `the recorded taste call on these two pictures: ${show(call, 900)}`).toBe('looks_right');
  }, TIMEOUT);
});
