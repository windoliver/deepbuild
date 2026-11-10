// AC3 (#1820), the part tests/acceptance/1820/license.test.ts leaves open: the hub READS the license file, it does not
// trust the listing's `license.id`. Every asset here is listed as CC0-1.0 (so a hub that only reads the listing accepts
// it), while its license file reads CC BY-SA, NC or GPL. Locator (design leaves it undecided: "reads its license file"):
// the listing's `license.terms` url; the same text is also served beside the asset (`LICENSE`, `<file>.license`), and any
// of the three counts as the file. A CC0 file under a CC0 listing is the control, and its license file must be requested
// before the asset is reported fetched (a hub that never reads one fails the control's request check).
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CC0 } from '../pack.ts';
import { asks, blocked, doc, kinds, newAsks, show, stored, until, yes } from '../helpers.ts';
import { addAsset, bytes, installOrBlock, isLicenseRead, LICENSE_TEXT, scopedWorld, sha, writePack, type Listed, type Scoped } from './world.ts';

const PACK = 'acme/files'; const VERSION = '1.0.0';
const mk = (path: string, text: string): Listed => ({ path, body: bytes(path, 1800), license: CC0, licenseText: text });
const FILES = { ok: mk('f/ok.bin', LICENSE_TEXT.cc0), sa: mk('f/sa.bin', LICENSE_TEXT.sa), nc: mk('f/nc.bin', LICENSE_TEXT.nc), gpl: mk('f/gpl.bin', LICENSE_TEXT.gpl) };
let w: Scoped;
beforeAll(async () => {
  w = await scopedWorld();
  for (const [tag, a] of Object.entries(FILES)) addAsset(w.srv, PACK, VERSION, a, tag);
  await installOrBlock(w, writePack(join(w.tmp, 'files'), w.srv, PACK, VERSION, Object.entries(FILES).map(([tag, a]) => ({ a, tag }))));
}, 600_000);

async function fetched(path: string) {
  const args = { op: 'fetch', pack: `${PACK}@${VERSION}`, asset: path };
  const before = (await asks(w)).length;
  let o = await kinds(w, args);
  if (o.value.status === 'held') { const r = await newAsks(w, before, 'authority'); if (r[0]) await yes(w, r[0]); o = await until(w, args); }
  return o;
}
async function refusedByFile(tag: keyof typeof FILES, naming: RegExp) {
  const a = FILES[tag];
  const o = await fetched(a.path);
  expect(o.isError || o.value.status === 'refused', `${a.path}: listed CC0-1.0 but its license file reads otherwise: ${o.text}`).toBe(true);
  expect(o.value.status).not.toBe('fetched');
  expect(o.text, 'the refusal names the license the file reads').toMatch(naming);
  expect(w.srv.log.some((r) => isLicenseRead(r, `${PACK}@${VERSION}`, a, tag)), `no license file of ${a.path} was requested`).toBe(true);
  expect(await stored(w, sha(a.body)), `${a.path} was kept`).toBeUndefined();
  const used = await show(w, doc('item', sha(a.body), `${PACK}@${VERSION}`));
  expect(used.reply?.outcome === 'refused' || JSON.stringify(used.reply).includes('BLOCKED') || used.ran.code !== 0, JSON.stringify(used.reply).slice(0, 400)).toBe(true);
  expect(blocked(o) || o.isError || o.value.status === 'refused').toBe(true);
}

describe('#1820.a489b5cd (supplement) the license FILE is read, not just the listing\'s license id', () => {
  it('refuses an asset listed CC0 whose license file reads CC BY-SA, naming CC BY-SA', () => refusedByFile('sa', /CC[- ]BY[- ]SA/i), 300_000);
  it('refuses an asset listed CC0 whose license file reads CC BY-NC, naming NC', () => refusedByFile('nc', /CC[- ]BY[- ]NC|\bNC\b|NonCommercial/i), 300_000);
  it('refuses an asset listed CC0 whose license file reads GPL, naming GPL', () => refusedByFile('gpl', /GPL/i), 300_000);
  it('control: an asset whose license file reads CC0 is fetched, after its license file was requested', async () => {
    const a = FILES.ok;
    const o = await fetched(a.path);
    expect(o.value.status, o.text).toBe('fetched');
    expect(w.srv.log.some((r) => isLicenseRead(r, `${PACK}@${VERSION}`, a, 'ok')), 'fetched with no license file read').toBe(true);
    expect(await stored(w, sha(a.body))).toBeDefined();
  }, 300_000);
});
