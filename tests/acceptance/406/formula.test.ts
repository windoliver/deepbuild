// AC4: A formula whose alt is `n = 1.33` fails honest numbers, naming 1.33 and the item, and passes once its vector maps
// `1.33` to `data/n_water` with a source; `a^2 + b^2 = c^2` passes with 2 listed as notation.
// The formula is the `vector@1` item `eq` over fixtures/formula.svg (three filled paths with ids, put in the check's
// store by sha256), its `alt` the formula's source text and, mapped, `numbers: {"1.33": "data/n_water"}` with the
// constant `n_water: {value: 1.33, source}`; checked by `deep-canvas-render check` with the store.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, check, envelope, fixtureBytes, listed, naming, put, shownErrors, shownListing, useBuilds, useTemp, type JsonObject } from './helpers.ts';

const bin = useBuilds(['deep-canvas-render']);
const temp = useTemp('formula');

const ITEM = 'eq';
const SOURCE = 'https://refractiveindex.info/?shelf=3d&book=liquids&page=water';

function formula(store: string, alt: string, extra: { numbers?: JsonObject; data?: JsonObject } = {}): JsonObject {
  const params: JsonObject = { src: put(store, fixtureBytes('formula.svg')), size: [300, 60], colors: { '#000000': 'ink' }, alt };
  if (extra.numbers) params['numbers'] = extra.numbers;
  const item: JsonObject = { id: ITEM, kind: 'vector@1', layer: 'main', name: 'Formula', order: 'a1', at: { pos: [24, 24, 0] }, params };
  return envelope(`formula-406-${alt.length}`, 'figure', [item], extra.data ? { data: extra.data } : {});
}

describe('AC4 a formula\'s integers are notation; a fractional or mapped number in its alt must trace to a source', () => {
  it('AC4 alt `n = 1.33` fails honest numbers naming 1.33 and eq, and passes once 1.33 maps to data/n_water with a source', () => {
    const render = bin('deep-canvas-render');
    const store = temp();
    const bare = check(render, formula(store, 'n = 1.33'), store);
    expect(bare.ok, `unmapped: the check fails: ${shownErrors(bare)}`).toBe(false);
    const named = naming(bare, 'number_unsourced', ITEM);
    expect(named.length, `unmapped: number_unsourced names ${ITEM}: ${shownErrors(bare)}`).toBeGreaterThan(0);
    expect(named.some((e) => { const { fix: _fix, ...rest } = e.raw; return JSON.stringify(rest).includes('1.33'); }), `unmapped: the issue names 1.33: ${shownErrors(bare)}`).toBe(true);
    const mapped = check(render, formula(store, 'n = 1.33', { numbers: { '1.33': 'data/n_water' }, data: { n_water: { value: 1.33, source: SOURCE } } }), store);
    expect(mapped.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `mapped: the formula passes: ${shownErrors(mapped)}`).toEqual([]);
    expect(mapped.ok, 'mapped: the check passes').toBe(true);
  }, TIMEOUT);

  it('AC4 alt `a^2 + b^2 = c^2` passes with 2 listed as notation', () => {
    const store = temp();
    const c = check(bin('deep-canvas-render'), formula(store, 'a^2 + b^2 = c^2'), store);
    expect(c.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `the formula passes: ${shownErrors(c)}`).toEqual([]);
    expect(c.ok, 'the check passes').toBe(true);
    expect(listed(c, ITEM, '2', /notation/i).length, `the check lists ${ITEM}'s 2 as notation: ${shownListing(c)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
