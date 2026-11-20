// AC5 #194.eeff314c: "A recipe making 1 board from 2 planks with an uncraft giving back 3 planks fails catalog.economy,
// naming the cycle and plank, and passes with the uncraft giving back 2; and with a value column, a recipe whose outputs
// are worth 30 from inputs worth 10, past a margin of 5, fails, naming it"
//
// catalog.economy {makes: the recipes table's inputs, tools and outputs} through the hub. The fixture's make_board takes
// plank, plank and makes board; its uncraft_board takes board and gives plank, plank, the one cycle of its recipes
// (fixtures.ts), so it passes. The twin's uncraft_board gives plank × 3: made once around, the cycle gains one plank, one
// failure whose test is the cycle's recipes joined by ` → ` and whose message starts catalog.gain_cycle and names both
// recipes and plank; found `{code: catalog.gain_cycle, cycle: [both, in order], row: plank, gain: 1}`.
// With `value: {table: items, column: value}` and margin 5: the fixture passes (no recipe gains more than 2); the twin
// whose gem is worth 30 makes cut_gem's outputs (gem 30, gem_dust 0) worth 30 from its input rough_gem's 10: one
// failure `recipes.cut_gem`, its message starting catalog.gain_cycle and naming cut_gem; found `{code:
// catalog.gain_cycle, recipe: cut_gem, inputs: 10, outputs: 30, margin: 5}`.
// The wrong programs: the base (no plug-in), an economy that sums tools as inputs, ignores an uncraft's counts, misses a
// cycle, or compares values without the margin.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, catalogOf, failuresOf, foundOf, names, openHub, packAll, packCall, passes, prebuildCatalog, runCheck, scratch, shown, specOf, type Packed,
} from './helpers.ts';
import { MAKES, MARGIN, SCHEMA, catalog, withCell } from './fixtures.ts';

prebuildCatalog();

const economy = (c: Packed, valued = false): ReturnType<typeof specOf> =>
  specOf('catalog.economy', { catalog: c.sha256, makes: MAKES, ...(valued ? { value: { table: 'items', column: 'value' }, margin: MARGIN } : {}) }, [c]);

describe(`${AC[5]} catalog.economy finds a cycle that makes something from nothing, and a recipe past its margin`, () => {
  it(`${AC[5]} the uncraft giving back 3 planks fails naming the cycle and plank, and 2 passes; outputs worth 30 from inputs worth 10 past a margin of 5 fail, naming the recipe`, async () => {
    const t = catalog();
    expect(t['recipes']!.rows.find((r) => r['id'] === 'make_board'), 'the fixture\'s board takes 2 planks').toMatchObject({ inputs: ['plank', 'plank'], outputs: ['board'] });
    expect(t['recipes']!.rows.find((r) => r['id'] === 'uncraft_board'), 'and its uncraft gives back 2').toMatchObject({ inputs: ['board'], outputs: ['plank', 'plank'] });
    const three = withCell(t, 'recipes', 'uncraft_board', 'outputs', ['plank', 'plank', 'plank']);
    const pricey = withCell(t, 'items', 'gem', 'value', 30);
    const dir = scratch('ac05');
    const [clean, gaining, valued] = packAll([packCall(dir, t, SCHEMA), packCall(dir, three, SCHEMA), packCall(dir, pricey, SCHEMA)], 'the fixture and its economy twins');

    const hub = await openHub();
    passes(await runCheck(hub, economy(clean!)), 'catalog.economy', clean!, 'catalog.economy with the uncraft giving back 2 planks');
    const r = await runCheck(hub, economy(gaining!));
    expect(r.outcome, `catalog.economy fails the uncraft giving back 3: ${shown(r)}`).toBe('failed');
    const f = failuresOf(r, 'catalog.gain_cycle');
    expect(f.length, `one failure, the cycle's: ${shown(r)}`).toBe(1);
    expect(f[0]!.test.split(' → ').sort(), `its test is the cycle's recipes joined by → : ${f[0]!.test}`).toEqual(['make_board', 'uncraft_board']);
    for (const w of ['make_board', 'uncraft_board', 'plank']) expect(names(f[0]!.message, w), `its message names ${w}: ${f[0]!.message}`).toBe(true);
    const cycles = foundOf(r, 'catalog.economy', 'catalog.gain_cycle');
    expect(cycles, 'it finds the cycle, the row it gains and the gain').toMatchObject([{ code: 'catalog.gain_cycle', row: 'plank', gain: 1 }]);
    expect([...(cycles[0]!['cycle'] as string[])].sort(), 'the cycle names both recipes').toEqual(['make_board', 'uncraft_board']);
    expect(catalogOf(r, 'catalog.economy').found.length, 'and nothing else').toBe(1);

    passes(await runCheck(hub, economy(clean!, true)), 'catalog.economy', clean!, 'catalog.economy with the value column and a margin of 5');
    const v = await runCheck(hub, economy(valued!, true));
    expect(v.outcome, `catalog.economy fails the recipe whose outputs are worth 30 from inputs worth 10: ${shown(v)}`).toBe('failed');
    const g = failuresOf(v, 'catalog.gain_cycle');
    expect(g.map((x) => x.test), `one failure, the recipe's: ${shown(v)}`).toEqual(['recipes.cut_gem']);
    expect(names(g[0]!.message, 'cut_gem'), `its message names cut_gem: ${g[0]!.message}`).toBe(true);
    expect(foundOf(v, 'catalog.economy', 'catalog.gain_cycle'), 'it finds the recipe, its inputs\' and outputs\' worth and the margin').toMatchObject([{ code: 'catalog.gain_cycle', recipe: 'cut_gem', inputs: 10, outputs: 30, margin: MARGIN }]);
  }, TIMEOUT);
});
