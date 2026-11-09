// AC1: "A fixture library server with 30 models, 5 HDRIs and 5 textures under CC0, CC-BY 4.0 and one unknown license
// answers `deep_kinds` asset searches through the slot. A search for "chair" with `size_m: [0.4, 1.2]` returns only
// chairs in that range, ranked as #979 ranks catalog rows, and fetches no file. A planted fill that downloads each hit
// to measure it fails, naming the request log."
//
// asserts: the hub-slot table has asset.library@1 on deep.registerSource (variant library, fills many); through a real
// hub with the test fill installed and turned on, deep_kinds {op: assets, query: chair, size_m: [0.4, 1.2], limit: 50}
// over deep mcp returns exactly the 9 chairs whose stated size is in range, in #979's order (words matched, then
// nearest the range's middle), each row as the library's own record says (README, How each criterion is read), and the
// library's request log holds no file request for the search. The same judge fails the planted fill
// `measures-by-download`, naming the request log.
import { describe, expect, it } from 'vitest';
import { hubSlots } from '../../../packages/contracts/src/index.ts';
import { judgeSearch, LIB, must, onWorld, openWorld, proof, search } from './helpers.ts';

describe('#1731.999d16ba A fixture library server with 30 models, 5 HDRIs and 5 textures under CC0, CC-BY 4.0 and one unknown license answers `deep_kinds` asset searches through the slot. A search for "chair" with `size_m: [0.4, 1.2]` returns only chairs in that range, ranked as #979 ranks catalog rows, and fetches no file. A planted fill that downloads each hit to measure it fails, naming the request log.', () => {
  it('a search for chair in [0.4, 1.2] through the asset.library@1 slot returns only the chairs in range, in #979\'s order, and the request log holds no file', async () => {
    const slot = hubSlots().find((r) => r.interface === 'asset.library@1');
    expect(slot, 'the hub-slot table has a row for asset.library@1').toBeDefined();
    expect({ method: slot!.method, variant: slot!.variant, fills: slot!.fills }, 'asset.library@1 is a deep.registerSource slot many fills fill').toEqual({ method: 'deep.registerSource', variant: 'library', fills: 'many' });
    const w = await onWorld();
    const from = w.library.log.length;
    const { rows } = await search(w);
    proof('ac1-search.json', { rows, requests: w.library.log.slice(from) });
    expect(w.library.log.slice(from).some((q) => q.path.startsWith('/api/search')), `the search reached the library through the fill: ${w.library.quote(from)}`).toBe(true);
    expect(judgeSearch(rows, w.library, from)).toEqual([]);
  }, 900_000);

  it('the planted fill that downloads each hit to measure it fails, naming the request log', async () => {
    const w = await openWorld('measures-by-download');
    // A hub whose own kit refused the plant at install has failed it too, if its reason names the request log.
    if (w.install.code !== 0) {
      expect(w.install.stderr, 'the install refused the planted fill, naming the request log').toMatch(/request log/i);
      return;
    }
    await must(w, 'library.on', { library: LIB });
    const from = w.library.log.length;
    const { rows } = await search(w);
    const failures = judgeSearch(rows, w.library, from);
    proof('ac1-planted-measures-by-download.json', { failures, requests: w.library.log.slice(from) });
    expect(failures.filter((f) => f.includes('request log')), `the judge fails the plant naming the request log: ${JSON.stringify(failures)}`).toHaveLength(1);
  }, 900_000);
});
