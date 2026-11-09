// AC4: "With the library turned off, the same search returns installed packs' rows only, and a fetch by its old id is
// refused, naming the library."
//
// asserts: with the fill on, the search returns the library's rows (the control); after library.off {library}, the
// same search returns no row that names no pack (so none from the library), a fetch of oak-chair, an id the search
// returned before, is refused naming ext.shelf.library, no ask is raised, and no request reaches the library.
import { describe, expect, it } from 'vitest';
import { LIB, asks, fetchArgs, kinds, libraryRows, must, onWorld, proof, refusal, search } from './helpers.ts';

describe('#1731.826a5cb7 With the library turned off, the same search returns installed packs\' rows only, and a fetch by its old id is refused, naming the library.', () => {
  it('turned off, the library leaves the search and a fetch by an id it gave is refused, naming it, with no request to it', async () => {
    const w = await onWorld();
    const on = libraryRows((await search(w)).rows);
    expect(on.map((r) => r.id), 'with the library on, the search has its rows').toContain('oak-chair');

    await must(w, 'library.off', { library: LIB });
    const asked = (await asks(w)).length;
    const from = w.library.log.length;
    const { rows } = await search(w);
    const o = await kinds(w, fetchArgs('oak-chair'));
    proof('ac4-off.json', { rows, fetch: o.value, text: o.text, requests: w.library.log.slice(from) });
    expect(rows.filter((r) => typeof r.from?.pack !== 'string'), 'the search returns installed packs\' rows only').toEqual([]);
    expect(refusal(o), `the fetch by its old id is refused: ${o.text.slice(0, 800)}`).toBeDefined();
    expect(refusal(o), 'the refusal names the library').toContain(LIB);
    expect((await asks(w)).length, 'nothing was asked').toBe(asked);
    expect(w.library.quote(from), 'no request reached the library once it was off').toBe('(no requests)');
  }, 900_000);
});
