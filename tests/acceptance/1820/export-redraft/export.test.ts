// #1820, scope 4: "A document names `pack@version`, so a re-export uses the same bytes", through the shipped
// `deep export --document <file> --still 0 --out <file.png>`; and AC4's "with no network, a document that uses an
// unfetched asset is BLOCKED with one unblock ask, never PASS, and no fetch starts without an answered ask".
//
// Fixtures: pack acme/pix lists one path, `p/pic.png`, in two versions: 1.0.0 serves a solid red 8×8 PNG, 2.0.0 a solid
// blue one (same size, different bytes). A pack acme/away lists a picture the hub never fetches. The expected values are
// the issue's: v1 exports red, v2 exports blue, a repeat of v1 is the same bytes with the network gone and the upstream
// changed, a pack that was never installed is refused with no file, an unfetched asset offline is BLOCKED twice with one
// unblock ask and no authority ask, and no PNG is ever written for it.
//
// Surface assumptions (the design names no field): the document lists `packs: ["owner/name@version"]` and an `image@1`
// item `params.asset: <sha256>` (as #499's image items); the packs are installed with `deep install <folder>` and fetched
// with `deep_kinds {op: "fetch", pack, asset: <listed path>}` after one authority ask, as #1731's library; if the base has
// no route that installs a url-listed pack, `installOrBlock` reads BLOCKED naming it.
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { yes } from '../../1731/helpers.ts';
import { BLUE, isBlue, isRed, mean, RED } from './png.ts';
import { addAsset, asks, CC0, exportStill, fetchAfterYes, installOrBlock, kinds, LICENSE_TEXT, pictureDoc, said, scopedWorld, writePack, type Scoped } from './world.ts';
import { createHash } from 'node:crypto';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const PIX = 'acme/pix'; const V1 = '1.0.0'; const V2 = '2.0.0';
const AWAY = 'acme/away'; const AWAY_V = '1.0.0';
const PATH = 'p/pic.png';
const red = RED(8); const blue = BLUE(8);
const awayPng = RED(9); // another picture, never fetched
const listed = (body: Buffer) => ({ path: PATH, body, license: CC0, licenseText: LICENSE_TEXT.cc0 });

let w: Scoped;
beforeAll(async () => {
  w = await scopedWorld();
  addAsset(w.srv, PIX, V1, listed(red), 'pix1'); addAsset(w.srv, PIX, V2, listed(blue), 'pix2'); addAsset(w.srv, AWAY, AWAY_V, listed(awayPng), 'away');
  await installOrBlock(w, writePack(join(w.tmp, 'pix1'), w.srv, PIX, V1, [{ a: listed(red), tag: 'pix1' }]));
  await installOrBlock(w, writePack(join(w.tmp, 'pix2'), w.srv, PIX, V2, [{ a: listed(blue), tag: 'pix2' }]));
  await installOrBlock(w, writePack(join(w.tmp, 'away'), w.srv, AWAY, AWAY_V, [{ a: listed(awayPng), tag: 'away' }]));
}, 600_000);

const colorOf = (r: Awaited<ReturnType<typeof exportStill>>) => (r.png ? mean(r.png) : 'no PNG written');
let first: Buffer | undefined;

describe('#1820 scope: a document names pack@version, so a re-export uses the same bytes', () => {
  it('each pinned version exports its own bytes: the document naming v1 draws red, the one naming v2 draws blue', async () => {
    const answer = (a: Parameters<typeof yes>[1]) => yes(w, a);
    const f1 = await fetchAfterYes(w, `${PIX}@${V1}`, PATH, (a) => answer(a));
    expect(f1.value.status, f1.text).toBe('fetched');
    const f2 = await fetchAfterYes(w, `${PIX}@${V2}`, PATH, (a) => answer(a));
    expect(f2.value.status, f2.text).toBe('fetched');
    const one = await exportStill(w, pictureDoc(`${PIX}@${V1}`, sha(red)));
    const two = await exportStill(w, pictureDoc(`${PIX}@${V2}`, sha(blue)));
    expect(one.code, said(one)).toBe(0);
    expect(two.code, said(two)).toBe(0);
    const c1 = colorOf(one); const c2 = colorOf(two);
    expect(typeof c1 === 'string' ? c1 : isRed(c1), `v1 still is not red: ${JSON.stringify(c1)} ${said(one)}`).toBe(true);
    expect(typeof c2 === 'string' ? c2 : isBlue(c2), `v2 still is not blue: ${JSON.stringify(c2)} ${said(two)}`).toBe(true);
    expect(one.png!.equals(two.png!), 'the two versions drew the same bytes').toBe(false);
    first = one.png;
  }, 600_000);

  it('after v2 exists and the upstream changed and the network is gone, v1 re-exports the same bytes twice: no request, no ask', async () => {
    expect(first, 'the first test did not produce the v1 still').toBeDefined();
    // The upstream now answers other bytes at v1's url, then goes away.
    w.srv.routes.set(`/${PIX}@${V1}/${PATH}`, { body: blue });
    const mark = w.srv.log.length; const askedBefore = (await asks(w)).length;
    await w.srv.close();
    const again = await exportStill(w, pictureDoc(`${PIX}@${V1}`, sha(red)));
    const third = await exportStill(w, pictureDoc(`${PIX}@${V1}`, sha(red)));
    for (const r of [again, third]) {
      expect(r.code, said(r)).toBe(0);
      expect(r.png, said(r)).toBeDefined();
      expect(r.png!.equals(first!), `a re-export of ${PIX}@${V1} differs from the first export: ${said(r)}`).toBe(true);
    }
    expect(w.srv.since(mark), 'a re-export went to the network').toEqual([]);
    expect((await asks(w)).length, 'a re-export asked').toBe(askedBefore);
  }, 600_000);

  it('a document naming a pack version that is not installed is refused with no PNG, naming the pack, and no other version stands in', async () => {
    const r = await exportStill(w, pictureDoc(`${PIX}@9.9.9`, sha(red)));
    expect(r.code, said(r)).not.toBe(0);
    expect(r.png, `a PNG was written for a pack that is not installed: ${said(r)}`).toBeUndefined();
    expect(`${r.stdout}${r.stderr}`, said(r)).toContain(PIX);
  }, 300_000);
});

describe('#1820.09114f60 AC4: offline, a document that uses an unfetched asset is BLOCKED with one unblock ask, never PASS', () => {
  it('two exports are each BLOCKED with no PNG; together they raised exactly one unblock ask and no authority ask, and nothing was fetched', async () => {
    // The server is already closed by the test above: the network is gone, and the asset was never fetched.
    const before = (await asks(w)).length;
    const mark = w.srv.log.length;
    const doc = pictureDoc(`${AWAY}@${AWAY_V}`, sha(awayPng));
    const a = await exportStill(w, doc);
    const b = await exportStill(w, doc);
    for (const r of [a, b]) {
      expect(r.code, said(r)).not.toBe(0);
      expect(r.png, `a PNG was written for an unfetched asset: ${said(r)}`).toBeUndefined();
      expect(`${r.stdout}${r.stderr}`, said(r)).toMatch(/\bBLOCKED\b/);
      expect(`${r.stdout}${r.stderr}`, said(r)).not.toMatch(/\bPASS\b/);
    }
    const raised = (await asks(w)).slice(before);
    expect(raised.filter((x) => x.kind === 'unblock').length, JSON.stringify(raised.map((x) => x.text).slice(0, 3))).toBe(1);
    expect(raised.filter((x) => x.kind === 'authority').length, 'a fetch ask while offline').toBe(0);
    expect(w.srv.since(mark), 'a fetch started').toEqual([]);
    // The hub holds none of its bytes: its fetch is still BLOCKED, not fetched.
    const o = await kinds(w, { op: 'fetch', pack: `${AWAY}@${AWAY_V}`, asset: PATH });
    expect(o.value.status === 'fetched', `the unfetched asset reads fetched: ${o.text}`).toBe(false);
  }, 600_000);
});
