// AC3 #194.3e12aff1: "A recipe naming plank_oak, which no item holds, fails catalog.refs, naming the recipe, the column
// and plank_oak, and passes once the item is added"
//
// The fixture with one recipe more, oak_panel, whose inputs are plank_oak and plank (fixtures.ts `OAK_PANEL`), packed by
// `deep-catalog pack`: its record lists the ref no row holds and its bytes hold 0xFFFFFFFF there. catalog.refs through
// the hub (the plug-in installed from packages/checks/catalog, the catalog inline in the spec as the hub fills it) fails
// with one failure, `recipes.oak_panel`, whose message starts catalog.ref_missing and names oak_panel, inputs and
// plank_oak, and finds `{code: catalog.ref_missing, table: recipes, row: oak_panel, column: inputs, ref: plank_oak}`.
// With the item plank_oak added (`PLANK_OAK`) the record lists nothing and catalog.refs passes, its evidence the
// catalog's asset ID.
// The wrong programs: the base (no plug-in), a refs check that passes whatever the record lists, one that fails a
// catalog whose refs all resolve, and one that names the row by its position.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, catalogOf, failuresOf, foundOf, layoutOf, names, openHub, packAll, packCall, passes, prebuildCatalog, rowValues, runCheck, scratch, shown, specOf,
} from './helpers.ts';
import { OAK_PANEL, PLANK_OAK, SCHEMA, catalog, withRow } from './fixtures.ts';

prebuildCatalog();

describe(`${AC[3]} catalog.refs finds a recipe naming an item no row holds`, () => {
  it(`${AC[3]} a recipe naming plank_oak, which no item holds, fails catalog.refs naming the recipe, the column and plank_oak; with the item added it passes`, async () => {
    const twin = withRow(catalog(), 'recipes', OAK_PANEL);
    const fixed = withRow(twin, 'items', PLANK_OAK);
    const dir = scratch('ac03');
    const [broken, whole] = packAll([packCall(dir, twin, SCHEMA), packCall(dir, fixed, SCHEMA)], 'the plank_oak twin and its fix');
    expect(broken!.record['missing'], 'the record lists the ref no row holds').toEqual([{ table: 'recipes', id: 'oak_panel', column: 'inputs', ref: 'plank_oak' }]);
    const l = layoutOf(broken!.bytes, 'the twin');
    expect((rowValues(broken!.bytes, l, 'recipes', SCHEMA, 'oak_panel')['inputs'] as number[])[0], 'the ref is packed as 0xFFFFFFFF').toBe(0xffffffff);
    expect(whole!.record['missing'], 'with the item added, nothing is missing').toEqual([]);

    const hub = await openHub();
    const r = await runCheck(hub, specOf('catalog.refs', { catalog: broken!.sha256 }, [broken!]));
    expect(r.outcome, `catalog.refs fails the twin: ${shown(r)}`).toBe('failed');
    const f = failuresOf(r, 'catalog.ref_missing');
    expect(f.map((x) => x.test), `one failure, the recipe's: ${shown(r)}`).toEqual(['recipes.oak_panel']);
    for (const w of ['oak_panel', 'inputs', 'plank_oak']) expect(names(f[0]!.message, w), `its message names ${w}: ${f[0]!.message}`).toBe(true);
    expect(foundOf(r, 'catalog.refs', 'catalog.ref_missing'), 'it finds the missing ref, by the row\'s ID').toMatchObject([{ code: 'catalog.ref_missing', table: 'recipes', row: 'oak_panel', column: 'inputs', ref: 'plank_oak' }]);
    expect(catalogOf(r, 'catalog.refs').found.length, 'and nothing else').toBe(1);
    passes(await runCheck(hub, specOf('catalog.refs', { catalog: whole!.sha256 }, [whole!])), 'catalog.refs', whole!, 'catalog.refs with plank_oak added');
  }, TIMEOUT);
});
