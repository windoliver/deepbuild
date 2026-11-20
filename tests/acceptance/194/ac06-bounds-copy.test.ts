// AC6 #194.248f0bd0: "A creature with hp 400 against the brief's range [1, 200] fails catalog.bounds, naming the
// creature and hp; and an item name key with English copy and no French fails catalog.copy for locales [en, fr], naming
// the key and fr"
//
// Through the hub, on the fixture (fixtures.ts):
// - catalog.bounds {ranges: {creatures.hp: [1, 200]}}, the schema's own ranges (weight, value, damage, time) held too:
//   the fixture passes; the twin whose golem has hp 400 fails with one failure `creatures.golem`, its message starting
//   catalog.out_of_range and naming golem and hp; found `{code: catalog.out_of_range, table: creatures, row: golem,
//   column: hp, value: 400, range: [1, 200]}`.
// - catalog.copy {shown: [items.name, creatures.name], locales: [en, fr], copy: data.copy}: with every key in both
//   locales it passes; with lantern's key 1011 missing from fr's items table it fails with one failure `items.lantern`,
//   its message starting catalog.copy_missing and naming 1011 and fr; found `{code: catalog.copy_missing, table: items,
//   row: lantern, column: name, key: 1011, locale: fr, copy: items}`.
// The wrong programs: the base (no plug-in), a bounds check that reads the agent's range or only the schema's, one that
// skips a column; a copy check that reads one locale, or looks keys up by row position.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, catalogOf, failuresOf, foundOf, names, openHub, packAll, packCall, passes, prebuildCatalog, runCheck, scratch, shown, specOf, type Packed,
} from './helpers.ts';
import { HP_RANGE, SCHEMA, catalog, copy, withCell, type Copy } from './fixtures.ts';

prebuildCatalog();

const bounds = (c: Packed): ReturnType<typeof specOf> => specOf('catalog.bounds', { catalog: c.sha256, ranges: { 'creatures.hp': HP_RANGE } }, [c]);
const copied = (c: Packed, data: Copy): ReturnType<typeof specOf> =>
  specOf('catalog.copy', { catalog: c.sha256, shown: ['items.name', 'creatures.name'], locales: ['en', 'fr'], copy: data }, [c]);

describe(`${AC[6]} catalog.bounds holds the brief's ranges, and catalog.copy every shown key in every locale`, () => {
  it(`${AC[6]} hp 400 against [1, 200] fails catalog.bounds naming the creature and hp; a name key with English copy and no French fails catalog.copy naming the key and fr`, async () => {
    const t = catalog();
    const lantern = t['items']!.rows.find((r) => r['id'] === 'lantern')!['name'] as number;
    expect(lantern, 'lantern\'s name key').toBe(1011);
    const dir = scratch('ac06');
    const [clean, strong] = packAll([packCall(dir, t, SCHEMA), packCall(dir, withCell(t, 'creatures', 'golem', 'hp', 400), SCHEMA)], 'the fixture and its hp 400 twin');

    const hub = await openHub();
    passes(await runCheck(hub, bounds(clean!)), 'catalog.bounds', clean!, 'catalog.bounds on the fixture');
    const b = await runCheck(hub, bounds(strong!));
    expect(b.outcome, `catalog.bounds fails the golem with hp 400: ${shown(b)}`).toBe('failed');
    const f = failuresOf(b, 'catalog.out_of_range');
    expect(f.map((x) => x.test), `one failure, the creature's: ${shown(b)}`).toEqual(['creatures.golem']);
    for (const w of ['golem', 'hp']) expect(names(f[0]!.message, w), `its message names ${w}: ${f[0]!.message}`).toBe(true);
    expect(foundOf(b, 'catalog.bounds', 'catalog.out_of_range'), 'it finds the row, the column, the value and the range').toMatchObject([{ code: 'catalog.out_of_range', table: 'creatures', row: 'golem', column: 'hp', value: 400, range: HP_RANGE }]);
    expect(catalogOf(b, 'catalog.bounds').found.length, 'and nothing else').toBe(1);

    const full = copy();
    passes(await runCheck(hub, copied(clean!, full)), 'catalog.copy', clean!, 'catalog.copy with every key in en and fr');
    const noFrench: Copy = JSON.parse(JSON.stringify(full)) as Copy;
    delete noFrench['fr']!['items']![String(lantern)];
    expect(noFrench['en']!['items']![String(lantern)], 'the key keeps its English copy').toBe('Lantern');
    const c = await runCheck(hub, copied(clean!, noFrench));
    expect(c.outcome, `catalog.copy fails the key with no French: ${shown(c)}`).toBe('failed');
    const g = failuresOf(c, 'catalog.copy_missing');
    expect(g.map((x) => x.test), `one failure, the item's: ${shown(c)}`).toEqual(['items.lantern']);
    for (const w of [lantern, 'fr']) expect(names(g[0]!.message, w), `its message names ${w}: ${g[0]!.message}`).toBe(true);
    expect(foundOf(c, 'catalog.copy', 'catalog.copy_missing'), 'it finds the key, the locale and the copy table').toMatchObject([{ code: 'catalog.copy_missing', table: 'items', row: 'lantern', column: 'name', key: lantern, locale: 'fr', copy: 'items' }]);
    expect(catalogOf(c, 'catalog.copy').found.length, 'and nothing else').toBe(1);
  }, TIMEOUT);
});
