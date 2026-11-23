// The lab's bundle on the wire: criteria 2, 4 and 5 of #2892, each read from the bytes of body a test server logs it
// sent on a first visit in a fresh headless Chrome profile (README: The test servers, A first visit).
//
// AC2 #2892.bce8437b: "The lab's bundle, fetched from a test server that sends every file as stored with no content
// encoding, puts at most 11,976,000 B of player on the wire with gzip (drafted from 11,907,342 B on main at `5f5791e2d`:
// the WebAssembly's 11,778,841 B at level 9 and the page glue's 128,501 B as it is), or at most 8,121,000 B with Brotli,
// the glue and the inflater included (drafted from 7,639,854 B). On the merge base the same server sends 37,402,728 B,
// and this fails"
// asserts: the lab exported (#172's lab), its files on disk as its receipt gives them, served by the `stored` server to
// a first visit that reaches `ready`; every response went with no content encoding and with the file's bytes as stored;
// the bytes of body sent for the player (the receipt's player file and each module the index page's import map names,
// the page glue; with Brotli also every other script the page loads, where the inflater would be), each file counted
// once as the issue's sums count it, are at most the decided form's ceiling (PLAYER_ON_WIRE). Wrong program: the merge
// base, whose export stores the player as it is (the issue's 37,402,728 B: its WebAssembly and its glue as stored).
//
// AC4 #2892.667e03e0: "The same bundle fetched from a server that also compresses as it sends differs by under 2% in
// bytes on the wire. A planted export that stores the player as it is fails, naming both sums"
// asserts: the lab's bundle on two first visits, one from the `stored` server and one from the `compressing` server
// (which did compress what it sent), each reaching `ready`: the two visits' sums of body bytes differ by under 2% of the
// first; the planted export `web_stores_player_as_is` fails the same comparison, and the failure names both sums.
//
// AC5 #2892.79918bc3: "`ship.bytes` for the lab equals the bytes of body that server sent on a first visit, to the
// byte. A planted measure that sums inflated bytes fails, naming both sums"
// asserts: the lab's bundle stores the player compressed (else stored and inflated sums are one and the plant can't
// be told apart), and each file the receipt marks stored compressed inflates to the receipt's inflated bytes; the
// `ship` call's `bytes` for the bundle equals the sum of body bytes the `stored` server sent on a first visit, to the
// byte; the ship checks' test server's own record says every response went with no content encoding and with the
// file's bytes as stored; the planted measure `ship_bytes_sums_inflated` fails the equality, naming both sums.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL, TIMEOUT, exportLab, filesUnder, none, useShow, useTemp } from '../172/helpers.ts';
import {
  AC, COMPRESSING_APART, DECIDED, PLAYER_ON_WIRE, asStoredFailures, describeLog, diskFailures, indexScripts, inflatedFailures, playerFile, sent,
  ship, storedFiles, storedPlayerFailures, visit,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const STORES_PLAYER_AS_IS = 'web_stores_player_as_is';
const SUMS_INFLATED = 'ship_bytes_sums_inflated';

/** The two visits' sums against AC4's 2%; a failure names both sums. */
function apart(stored: number, compressing: number): string[] {
  const d = Math.abs(stored - compressing) / stored;
  return d < COMPRESSING_APART ? [] : [`the bundle on the wire is ${stored} B from the server that sends every file as stored and ${compressing} B from the one that compresses as it sends: ${(d * 100).toFixed(2)}% apart, not under ${COMPRESSING_APART * 100}%`];
}
/** ship.bytes against the bytes of body the server sent; a failure names both sums. */
function equalToTheByte(shipBytes: number, body: number): string[] {
  return shipBytes === body ? [] : [`ship.bytes is ${shipBytes} B; the server that sends every file as stored sent ${body} B of body on a first visit`];
}

describe(`${AC[2]} the player on the wire from a server that sends every file as stored`, () => {
  it(`${AC[2]} the lab's bundle, from a server that sends every file as stored with no content encoding, puts at most ${PLAYER_ON_WIRE} B of player on the wire (${DECIDED})`, async () => {
    const what = 'the lab exported to the web';
    const lab = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), what);
    none(diskFailures(lab.out, lab.receipt, what), 'the bundle holds every file its receipt names, as stored');
    const player = playerFile(lab.receipt, what);
    const scripts = indexScripts(lab.out);
    const paths = new Set(DECIDED === 'gzip' ? [player.path, ...scripts.importMap] : [player.path, ...scripts.importMap, ...scripts.src]);
    expect(scripts.importMap.length, 'the index page\'s import map names the page glue').toBeGreaterThan(0);
    const v = await visit(lab.out, 'stored', `${what}, from the server that sends every file as stored`, { mustBeReady: true });
    none(asStoredFailures(v.log, lab.out), 'the test server sent every file as stored, with no content encoding');
    const on = [...paths].map((p) => v.log.find((l) => l.status === 200 && l.path === p));
    [...paths].forEach((p, i) => expect(on[i], `the page loaded the player's file ${p}`).toBeTruthy());
    const bytes = on.reduce((s, l) => s + l!.bytes, 0);
    const parts = on.map((l) => `${l!.path} ${l!.bytes} B`).join(', ');
    console.log(`${AC[2]} the player on the wire: ${bytes} B (${parts}); the whole visit ${sent(v.log)} B: ${describeLog(v.log)}`);
    expect(bytes, `the player on the wire is at most ${PLAYER_ON_WIRE} B (${DECIDED}): ${bytes} B in ${parts}`).toBeLessThanOrEqual(PLAYER_ON_WIRE);
  }, TIMEOUT);
});

describe(`${AC[4]} the same bundle from a server that compresses as it sends differs by under 2% on the wire`, () => {
  it(`${AC[4]} the lab's bundle from a server that compresses as it sends differs by under 2% in bytes on the wire from one that sends every file as stored`, async () => {
    const what = 'the lab exported to the web';
    const lab = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), what);
    const a = await visit(lab.out, 'stored', `${what}, from the server that sends every file as stored`, { mustBeReady: true });
    const b = await visit(lab.out, 'compressing', `${what}, from the server that compresses as it sends`, { mustBeReady: true });
    expect(b.log.some((l) => l.encoding !== null), `the compressing server compressed what it sent: ${describeLog(b.log)}`).toBe(true);
    console.log(`${AC[4]} as stored: ${sent(a.log)} B (${describeLog(a.log)}); compressing as it sends: ${sent(b.log)} B (${describeLog(b.log)})`);
    none(apart(sent(a.log), sent(b.log)), 'the two servers put the bundle on the wire within 2% of each other');
  }, TIMEOUT);

  it(`${AC[4]} the planted ${STORES_PLAYER_AS_IS} fails the comparison, naming both sums`, async () => {
    const what = `the lab exported by the planted ${STORES_PLAYER_AS_IS}`;
    const lab = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), what, STORES_PLAYER_AS_IS);
    const a = await visit(lab.out, 'stored', `${what}, from the server that sends every file as stored`, { mustBeReady: true });
    const b = await visit(lab.out, 'compressing', `${what}, from the server that compresses as it sends`, { mustBeReady: true });
    const f = apart(sent(a.log), sent(b.log));
    console.log(`${AC[4]} planted ${STORES_PLAYER_AS_IS}: ${f.join(' | ') || `within 2%: ${sent(a.log)} B and ${sent(b.log)} B`}`);
    expect(f.length, `the planted ${STORES_PLAYER_AS_IS} fails the 2% comparison`).toBeGreaterThan(0);
    expect(f[0]!.includes(`${sent(a.log)} B`) && f[0]!.includes(`${sent(b.log)} B`), `the failure names both sums: ${f[0]}`).toBe(true);
  }, TIMEOUT);
});

describe(`${AC[5]} ship.bytes is the bytes of body a first visit fetches`, () => {
  it(`${AC[5]} ship.bytes for the lab equals, to the byte, the bytes of body the server that sends every file as stored sent on a first visit; the ship checks' test server's record says it sent every file as stored`, async () => {
    const what = 'the lab exported to the web';
    const evidence = temp();
    const lab = exportLab(shows(FULL), evidence, join(temp(), 'bundle'), what);
    none(diskFailures(lab.out, lab.receipt, what), 'the bundle holds every file its receipt names, as stored');
    none(storedPlayerFailures(lab.out, lab.receipt, what), 'the bundle stores the player compressed, as the decision says');
    none(inflatedFailures(lab.out, lab.receipt, what), 'each file the receipt marks stored compressed inflates to the receipt\'s inflated bytes');
    const files = storedFiles(lab.receipt, what);
    console.log(`${AC[5]} the receipt: ${files.reduce((s, f) => s + f.stored, 0)} B stored, ${files.reduce((s, f) => s + f.inflated, 0)} B inflated, over ${files.length} files`);
    const v = await visit(lab.out, 'stored', `${what}, from the server that sends every file as stored`, { mustBeReady: true });
    none(asStoredFailures(v.log, lab.out), 'the test server sent every file as stored, with no content encoding');
    const measured = ship(shows(FULL), evidence, lab.out, `${what}: the ship checks`);
    console.log(`${AC[5]} ship.bytes ${measured.bytes} B; the first visit ${sent(v.log)} B: ${describeLog(v.log)}`);
    none(equalToTheByte(measured.bytes, sent(v.log)), 'ship.bytes equals the bytes of body sent on a first visit');

    const disk = filesUnder(lab.out);
    const record: string[] = [];
    if (!measured.responses.some((r) => r.status === 200 && r.path.replace(/^\//, '') === 'index.html')) record.push('the record holds no response for index.html');
    for (const r of measured.responses) {
      const path = r.path.replace(/^\//, '');
      if (r.encoding !== null) record.push(`${path} was sent with content encoding ${JSON.stringify(r.encoding)}`);
      if (r.status === 200 && disk.get(path)?.length !== r.bytes) record.push(`${path} was sent as ${r.bytes} B; it is ${String(disk.get(path)?.length)} B as stored`);
    }
    none(record, 'the ship checks\' test server\'s record says it sent every file as stored, with no content encoding');
  }, TIMEOUT);

  it(`${AC[5]} the planted ${SUMS_INFLATED} fails, naming both sums`, async () => {
    const what = 'the lab exported to the web';
    const evidence = temp();
    const lab = exportLab(shows(FULL), evidence, join(temp(), 'bundle'), what);
    none(storedPlayerFailures(lab.out, lab.receipt, what), 'the bundle stores the player compressed, as the decision says');
    const v = await visit(lab.out, 'stored', `${what}, from the server that sends every file as stored`, { mustBeReady: true });
    const measured = ship(shows(FULL), evidence, lab.out, `${what}: the planted ${SUMS_INFLATED}`, SUMS_INFLATED);
    const f = equalToTheByte(measured.bytes, sent(v.log));
    console.log(`${AC[5]} planted ${SUMS_INFLATED}: ${f.join(' | ') || `equal: ${measured.bytes} B`}`);
    expect(f.length, `the planted ${SUMS_INFLATED} fails the equality`).toBeGreaterThan(0);
    expect(f[0]!.includes(`${measured.bytes} B`) && f[0]!.includes(`${sent(v.log)} B`), `the failure names both sums: ${f[0]}`).toBe(true);
  }, TIMEOUT);
});
