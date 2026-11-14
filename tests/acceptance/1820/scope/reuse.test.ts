// Scope bullet 4 (#1820; the design: "A document names pack@version, so a re-export uses the same bytes"), and the cached
// reuse of AC1 under the harshest condition: the network is gone. Supplements AC1/AC4, whose existing tests stop at one
// document check. Locator assumption (design names no field): a document lists `packs: ["owner/name@version"]` and an
// `asset.game@1` item `from: {asset: <sha256>}`, as the existing 1820 helpers do; `deep show --check` replies with
// `outcome` and `assets`.
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CC0 } from '../pack.ts';
import { asks, doc, kinds, newAsks, show, stored, until, yes } from '../helpers.ts';
import { addAsset, bytes, installOrBlock, LICENSE_TEXT, scopedWorld, sha, writePack, type Listed, type Scoped } from './world.ts';

const PACK = 'acme/reuse';
const V1 = '1.0.0'; const V2 = '1.1.0';
const same = 'r/a.bin';
const body1: Listed = { path: same, body: bytes('v1', 2000), license: CC0, licenseText: LICENSE_TEXT.cc0 };
const body2: Listed = { path: same, body: bytes('v2', 2000), license: CC0, licenseText: LICENSE_TEXT.cc0 };
let w: Scoped;
beforeAll(async () => {
  w = await scopedWorld();
  addAsset(w.srv, PACK, V1, body1, 'v1'); addAsset(w.srv, PACK, V2, body2, 'v2');
  await installOrBlock(w, writePack(join(w.tmp, 'p1'), w.srv, PACK, V1, [{ a: body1, tag: 'v1' }]));
  await installOrBlock(w, writePack(join(w.tmp, 'p2'), w.srv, PACK, V2, [{ a: body2, tag: 'v2' }]));
}, 600_000);

async function fetch(version: string) {
  const args = { op: 'fetch', pack: `${PACK}@${version}`, asset: same };
  const before = (await asks(w)).length;
  let o = await kinds(w, args);
  if (o.value.status === 'held') { const r = await newAsks(w, before, 'authority'); expect(r.length, 'one ask').toBe(1); await yes(w, r[0]!); o = await until(w, args); }
  return o;
}
const usable = (r: Awaited<ReturnType<typeof show>>) => r.reply?.outcome !== 'refused' && !JSON.stringify(r.reply).includes('BLOCKED') && r.ran.code === 0;

describe('#1820 (supplement) a document names pack@version, so a re-export uses the same bytes', () => {
  it('two versions list one path with different bytes: each fetch lands by its own sha256, and a document is bound to the version it names', async () => {
    const o1 = await fetch(V1); const o2 = await fetch(V2);
    expect(o1.value.asset?.sha256, o1.text).toBe(sha(body1.body));
    expect(o2.value.asset?.sha256, o2.text).toBe(sha(body2.body));
    expect(await stored(w, sha(body1.body))).toBeDefined();
    expect(await stored(w, sha(body2.body))).toBeDefined();
    const ok = await show(w, doc('p', sha(body1.body), `${PACK}@${V1}`));
    expect(usable(ok), JSON.stringify(ok.reply).slice(0, 500)).toBe(true);
    // The version-2 bytes are not version 1's: naming v1 with v2's hash is not accepted as that pack's asset.
    const wrong = await show(w, doc('p', sha(body2.body), `${PACK}@${V1}`));
    expect(usable(wrong), `${PACK}@${V1} served ${V2}'s bytes: ${JSON.stringify(wrong.reply).slice(0, 500)}`).toBe(false);
    // A version that was never installed is not stood in for by another.
    const missing = await show(w, doc('p', sha(body1.body), `${PACK}@9.9.9`));
    expect(usable(missing), JSON.stringify(missing.reply).slice(0, 500)).toBe(false);
  }, 600_000);

  it('a re-export with the network gone, and the upstream bytes changed, uses the same bytes: no request, no ask, no BLOCKED', async () => {
    // The listed url now answers other bytes (a moving upstream), then goes away.
    w.srv.routes.set(`/${PACK}@${V1}/${same}`, { body: bytes('moved-upstream', 2000) });
    const mark = w.srv.log.length; const asksBefore = (await asks(w)).length;
    await w.srv.close();
    const first = await show(w, doc('p', sha(body1.body), `${PACK}@${V1}`));
    const second = await show(w, doc('p', sha(body1.body), `${PACK}@${V1}`));
    for (const r of [first, second]) expect(usable(r), JSON.stringify(r.reply).slice(0, 500)).toBe(true);
    expect(JSON.stringify(first.reply?.assets), 'the two exports list the same assets').toBe(JSON.stringify(second.reply?.assets));
    const again = await kinds(w, { op: 'fetch', pack: `${PACK}@${V1}`, asset: same });
    expect(again.value.status, again.text).toBe('fetched');
    expect(again.value.asset?.sha256).toBe(sha(body1.body));
    expect(w.srv.since(mark), 'a use of a fetched asset went to the network').toEqual([]);
    expect((await asks(w)).length, 'a cached use asked').toBe(asksBefore);
  }, 600_000);
});
