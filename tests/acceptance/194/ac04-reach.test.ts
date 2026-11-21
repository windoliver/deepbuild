// AC4 #194.d88ec4fa: "With the start kit and the loot table as roots, catalog.reach over every item and recipe passes; a
// recipe needing nails, which nothing yields, fails, naming the recipe and nails; and a planted reach that counts a
// recipe as reachable once any one input is passes that twin and fails the conformance kit"
//
// catalog.reach {roots: [{table: items, ids: the start kit}, {table: creatures, column: drops}], makes: [the recipes
// table's inputs, tools and outputs], every: [items, recipes]} through the hub on the fixture (fixtures.ts): every one
// of the 40 items and 15 recipes is reachable, so it passes. The twin adds nail_board, whose inputs are plank, plank and
// nails, an ID no row holds, so nothing yields it; its output, board, is made elsewhere, so nail_board is the one row
// left unreachable: one failure `recipes.nail_board`, its message starting catalog.unreachable and naming nail_board and
// nails, and `found` `{code: catalog.unreachable, table: recipes, row: nail_board, input: nails}`.
// The plug-in's kit (README: The surface, `catalogKit`): its planted runner `reach_any_input` passes that twin; its
// reference fill fails it the same way; and the kit's fixed part, run on `reach_any_input`, reads FAIL at a case raising
// catalog.unreachable, while on the reference fill it reads PASS.
// The wrong programs: the base (no plug-in), a reach that takes any one input, one that ignores tools or roots by
// column, and a kit that admits the any-input runner.
import { describe, expect, it } from 'vitest';
import { runKit } from '../../../packages/conformance/src/index.ts';
import {
  AC, TIMEOUT, catalogKit, catalogOf, failuresOf, fillOf, foundOf, names, openHub, packAll, packCall, passes, prebuildCatalog, runCheck, runFill, scratch, show,
  shown, specOf, type Packed,
} from './helpers.ts';
import { MAKES, NAIL_BOARD, ROOTS, SCHEMA, catalog, withRow } from './fixtures.ts';

prebuildCatalog();

const reach = (c: Packed): ReturnType<typeof specOf> => specOf('catalog.reach', { catalog: c.sha256, roots: ROOTS, makes: MAKES, every: ['items', 'recipes'] }, [c]);

describe(`${AC[4]} catalog.reach from the start kit and the loot table`, () => {
  it(`${AC[4]} every item and recipe is reachable; a recipe needing nails fails naming the recipe and nails; the any-input runner passes that twin and fails the kit`, async () => {
    const dir = scratch('ac04');
    const [clean, twin] = packAll([packCall(dir, catalog(), SCHEMA), packCall(dir, withRow(catalog(), 'recipes', NAIL_BOARD), SCHEMA)], 'the fixture and its nails twin');
    expect(twin!.record['missing'], 'nothing holds nails').toEqual([{ table: 'recipes', id: 'nail_board', column: 'inputs', ref: 'nails' }]);

    const hub = await openHub();
    passes(await runCheck(hub, reach(clean!)), 'catalog.reach', clean!, 'catalog.reach over every item and recipe');
    const r = await runCheck(hub, reach(twin!));
    expect(r.outcome, `catalog.reach fails the nails twin: ${shown(r)}`).toBe('failed');
    const f = failuresOf(r, 'catalog.unreachable');
    expect(f.map((x) => x.test), `one failure, the recipe's: ${shown(r)}`).toEqual(['recipes.nail_board']);
    for (const w of ['nail_board', 'nails']) expect(names(f[0]!.message, w), `its message names ${w}: ${f[0]!.message}`).toBe(true);
    expect(foundOf(r, 'catalog.reach', 'catalog.unreachable'), 'it finds the recipe and the input nothing yields').toMatchObject([{ code: 'catalog.unreachable', table: 'recipes', row: 'nail_board', input: 'nails' }]);
    expect(catalogOf(r, 'catalog.reach').found.length, 'and nothing else').toBe(1);

    const kit = await catalogKit();
    const anyInput = fillOf(kit, 'reach_any_input');
    const wrong = await runFill(anyInput, reach(twin!));
    expect(wrong.outcome, `the planted reach_any_input passes the nails twin: ${shown(wrong)}`).toBe('passed');
    const reference = await runFill(fillOf(kit, 'clean'), reach(twin!));
    expect(failuresOf(reference, 'catalog.unreachable').map((x) => x.test), `the kit's reference fill fails it, naming the recipe: ${shown(reference)}`).toEqual(['recipes.nail_board']);
    const caught = await runKit(kit as never, anyInput as never, { parts: ['fixed'] });
    expect(caught.verdict, `the kit catches reach_any_input: ${show(caught.cases.filter((c) => c.outcome !== 'PASS'))}`).toBe('FAIL');
    expect(caught.cases.some((c) => c.outcome === 'FAIL' && c.codes.includes('catalog.unreachable')), `a failed case raises catalog.unreachable: ${show(caught.cases.map((c) => [c.id, c.outcome, c.codes, c.message]))}`).toBe(true);
    const held = await runKit(kit as never, fillOf(kit, 'clean') as never, { parts: ['fixed'] });
    expect(held.verdict, `the kit's fixed part passes its reference fill: ${show(held.cases.filter((c) => c.outcome !== 'PASS'))}`).toBe('PASS');
  }, TIMEOUT);
});
