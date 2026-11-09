// AC2: "Fetching a CC-BY chair raises one authority ask naming the library, its bytes and CC-BY 4.0. After the yes,
// the asset is in the store by hash, with its license and upstream URL, and an `asset.game@1` `from: {asset}` names it
// with that license (#1066). The same fetch under a standing rule for that library and CC0 only is refused, naming the
// license."
//
// asserts: deep_kinds {op: fetch, library, id: oak-chair} (CC-BY-4.0) answers held and raises exactly one ask, an
// authority ask whose data names ext.shelf.library, the bytes (the file's, or the file's and its sidecar's together)
// and CC-BY 4.0, with no file fetched before your yes; after `deep inbox answer` with its allow option, the fetch answers
// fetched with the asset's SHA-256, license and upstream as the library's own record has them, no second ask is
// raised, evidence.read finds the file and its sidecar by hash, the file's entry with license CC-BY-4.0 and source the
// upstream URL, and `deep show --check` of an asset.game@1 item `from: {asset: <sha256>}` refuses nothing and lists
// the item's asset with license CC-BY-4.0. In a new world, under the standing rule library.rule {library, licenses:
// [CC0-1.0]}, a CC0 chair fetches with no ask (the rule's control), and the same CC-BY fetch is refused naming
// CC-BY 4.0, with no ask, no file request and nothing stored.
import { describe, expect, it } from 'vitest';
import {
  CC_BY_WORDS, LIB, asks, fetchArgs, fetchUntilDone, filesFetched, gameDoc, kinds, must, namesNumber, onWorld, proof, refusal, refusedItem, show, shown, stored, yes,
  type Line,
} from './helpers.ts';
import { asset, fileHash, totalBytes } from './library.ts';

const ID = 'oak-chair';

describe('#1731.e4d0ddba Fetching a CC-BY chair raises one authority ask naming the library, its bytes and CC-BY 4.0. After the yes, the asset is in the store by hash, with its license and upstream URL, and an `asset.game@1` `from: {asset}` names it with that license (#1066). The same fetch under a standing rule for that library and CC0 only is refused, naming the license.', () => {
  it('fetching the CC-BY oak chair raises one authority ask naming the library, its bytes and CC-BY 4.0; after the yes it is stored by hash with its license and upstream, and an asset.game@1 item names it with that license', async () => {
    const w = await onWorld();
    const rec = asset(ID).record;
    const sha = fileHash(ID);
    const before = (await asks(w)).length;
    const from = w.library.log.length;

    const first = await kinds(w, fetchArgs(ID));
    expect(first.value.status, `the fetch waits on your answer: ${first.text.slice(0, 800)}`).toBe('held');
    const raised = (await asks(w)).slice(before);
    proof('ac2-ask.json', raised);
    expect(raised.map((a) => a.kind), 'the fetch raised one ask, an authority ask').toEqual(['authority']);
    const ask = raised[0]!;
    expect(ask.text, 'the ask names the library').toContain(LIB);
    expect(namesNumber(ask.text, rec.files[0]!.bytes) || namesNumber(ask.text, totalBytes(ID)), `the ask names the bytes, ${rec.files[0]!.bytes} or ${totalBytes(ID)} with the sidecar: ${ask.text.slice(0, 800)}`).toBe(true);
    expect(ask.text, 'the ask names CC-BY 4.0').toMatch(CC_BY_WORDS);
    expect(filesFetched(w, from), 'nothing was downloaded before your yes').toEqual([]);

    const answered = await yes(w, ask);
    expect(answered.code, `deep inbox answer: ${shown(answered)}`).toBe(0);
    const done = await fetchUntilDone(w, ID);
    proof('ac2-fetched.json', { reply: done.value, requests: w.library.log.slice(from) });
    expect(done.value.status, `after the yes the fetch is done: ${done.text.slice(0, 800)}`).toBe('fetched');
    const got = done.value.asset as Line;
    expect({ sha256: got?.sha256, license: got?.license?.id, upstream: got?.upstream }, 'the asset by hash, with the license and upstream of the library\'s own record')
      .toEqual({ sha256: sha, license: 'CC-BY-4.0', upstream: { url: rec.url, version: rec.version, modified: rec.modified } });
    expect((await asks(w)).length - before, 'the fetch asked once in all').toBe(1);

    const entry = await stored(w, sha);
    proof('ac2-store.json', entry ?? null);
    expect(entry, `the store holds ${rec.files[0]!.path} by its hash`).toBeDefined();
    expect({ license: entry!.license?.name, source: entry!.source }, 'the stored file keeps its license and upstream URL').toEqual({ license: 'CC-BY-4.0', source: rec.url });
    for (const f of rec.files.slice(1)) expect(await stored(w, f.sha256), `the store holds the sidecar ${f.path} by its hash`).toBeDefined();

    const { ran, reply } = await show(w, gameDoc('chair', sha));
    proof('ac2-show.json', reply ?? { ran });
    expect(reply, `deep show --check --json printed a reply: ${shown(ran)}`).toBeDefined();
    expect(refusedItem(reply, 'chair'), `the asset.game@1 item naming ${sha} isn't refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBe(false);
    const named = ((reply!.assets as Line[] | undefined) ?? []).find((a) => a.item === 'chair');
    expect({ asset: named?.asset, license: named?.license?.id }, `the checked document's assets name the item's asset with its license: ${JSON.stringify(reply!.assets)}`).toEqual({ asset: sha, license: 'CC-BY-4.0' });
  }, 900_000);

  it('under a standing rule for the library and CC0 only, the same fetch is refused naming CC-BY 4.0, while a CC0 chair fetches under it with no ask', async () => {
    const w = await onWorld();
    await must(w, 'library.rule', { library: LIB, licenses: ['CC0-1.0'] });
    const before = (await asks(w)).length;

    const cc0 = await fetchUntilDone(w, 'pine-chair');
    expect(cc0.value.status, `the rule lets a CC0 chair fetch: ${cc0.text.slice(0, 800)}`).toBe('fetched');
    expect(await stored(w, fileHash('pine-chair')), 'the CC0 chair is in the store').toBeDefined();

    const from = w.library.log.length;
    const o = await kinds(w, fetchArgs(ID));
    proof('ac2-rule-refusal.json', { reply: o.value, text: o.text, requests: w.library.log.slice(from) });
    expect(refusal(o), `the CC-BY fetch is refused: ${o.text.slice(0, 800)}`).toBeDefined();
    expect(refusal(o), 'the refusal names the license').toMatch(CC_BY_WORDS);
    expect((await asks(w)).slice(before), 'nothing was asked under the rule').toEqual([]);
    expect(filesFetched(w, from), 'no byte of the refused chair was downloaded').toEqual([]);
    expect(await stored(w, fileHash(ID)), 'the refused chair is not in the store').toBeUndefined();
  }, 900_000);
});
