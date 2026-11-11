// #202.5ad3e3f5: "A test outside pack shelf@1.0.0 declares shelf.bookcase@1, backed by a recipe with inputs width (0.4
// to 3.0 m, default 1.2), levels (1 to 8, default 4) and dividers (0 to 3, default 1); an item {width: 2.0, levels: 4}
// expands into the recipe's 2 sides, 4 boards and 1 divider; width 3.5 is refused with out_of_range, naming width; a
// param depth the kind doesn't declare is refused with unknown_field, naming it; and deep_kinds lists shelf.bookcase@1
// with its schema, its example by hash, its kit result and its cost at defaults"
//
// asserts: in `r1`, acme/shelf@1.0.0 (fixtures/packs/shelf-1.0.0) installs; a board naming it with b1 {width: 2.0,
// levels: 4} expands b1 through the kind into exactly b1.sides.0–1, b1.boards.0–3 and b1.dividers.0, each a rect@1;
// b2 {width: 3.5} is refused with an out_of_range error at items/b2/params/width; b3 {depth: 0.3} with an
// unknown_field error at items/b3/params/depth; deep_kinds' kind@1 lists shelf.bookcase@1 with each input's range and
// default in its schema, an example whose hash is one of the kind's examples, a kit result PASS with its defaults,
// determinism, cost and rules parts PASS, and its cost at defaults (cpu_ms, gpu_ms, items: 7).
// Wrong program: the merge base, whose pack check refuses `kinds` as unknown_field, so the board names a missing pack.

import { expect, it } from 'vitest';
import {
  BOOKCASE, DOC, PACKS, R1, SHELF, board, declared, derivedIds, errors, expansionOf, isObject, issues, item, kindEntry, kitOf, listed, num, obj,
  packAt, packRow, present, run, scenario, schemaParam, show, sorted, strs, useBuilds, useEvidence,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();

it('#202.5ad3e3f5 shelf.bookcase@1 from an outside pack expands {width 2.0, levels 4} into 2 sides, 4 boards and 1 divider, refuses width 3.5 and depth by name, and deep_kinds lists its schema, example, kit result and cost at defaults', () => {
  const bin = builds.bin(R1);
  const at = [packAt(SHELF)];
  const [packs, shown, wide, deep] = run(bin, scenario(evidence(), [
    PACKS,
    present(DOC.a, board('A bookcase 2 m wide', at, [item('b1', BOOKCASE, { width: 2.0, levels: 4 }, 'a0')])),
    present(DOC.b, board('A bookcase 3.5 m wide', at, [item('b2', BOOKCASE, { width: 3.5 }, 'a0')])),
    present(DOC.c, board('A bookcase with a depth', at, [item('b3', BOOKCASE, { depth: 0.3 }, 'a0')])),
  ], { packs: [SHELF] }));
  expect(packRow(packs!, SHELF).state, `acme/shelf@1.0.0 installs: ${show(packs!)}`).toBe('installed');

  const e = expansionOf(shown!, 'b1');
  expect(e.kind, 'b1 expands as the kind shelf.bookcase@1').toBe(BOOKCASE);
  const expected = sorted([...derivedIds('b1', 'sides', 2), ...derivedIds('b1', 'boards', 4), ...derivedIds('b1', 'dividers', 1)]);
  expect(sorted(Object.keys(e.derived)), 'b1 {width: 2.0, levels: 4} expands into the recipe\'s 2 sides, 4 boards and 1 divider').toEqual(expected);
  for (const id of expected) expect(e.derived[id]!['kind'], `${id} is a 2D rect`).toBe('rect@1');

  const range = errors(issues(wide!)).filter((i) => i.code === 'out_of_range' && i.ids.includes('b2') && i.path.endsWith('/params/width'));
  expect(range.length, `width 3.5 is refused with out_of_range naming width: ${show(wide!['issues'] ?? null)}`).toBeGreaterThan(0);
  const unknown = errors(issues(deep!)).filter((i) => i.code === 'unknown_field' && i.ids.includes('b3') && i.path.endsWith('/params/depth'));
  expect(unknown.length, `depth is refused with unknown_field naming it: ${show(deep!['issues'] ?? null)}`).toBeGreaterThan(0);

  const entry = listed(kindEntry(bin, evidence(), BOOKCASE, { packs: [SHELF] }), BOOKCASE);
  const ranges: [string, number, number, number][] = [['width', 0.4, 3.0, 1.2], ['levels', 1, 8, 4], ['dividers', 0, 3, 1]];
  for (const [name, min, max, def] of ranges) {
    const p = schemaParam(entry['schema'], name);
    expect(p, `deep_kinds lists ${name} in shelf.bookcase@1's schema: ${show(entry['schema'] ?? null)}`).toBeDefined();
    expect([p!.min, p!.max, p!.default], `${name}'s range and default in the listed schema`).toEqual([min, max, def]);
  }
  const examples = strs(declared(SHELF, BOOKCASE)['examples'], 'the kind\'s examples');
  expect(examples, `deep_kinds lists an example of shelf.bookcase@1 by hash: ${show(entry['example'] ?? null)}`).toContain(entry['example']);
  const kit = kitOf(entry, BOOKCASE);
  expect(kit.verdict, `deep_kinds lists the kind's kit result: ${show(kit.raw)}`).toBe('PASS');
  for (const part of ['defaults', 'determinism', 'cost', 'rules']) expect(kit.parts[part], `the kit result lists its ${part} part as PASS: ${show(kit.raw)}`).toBe('PASS');
  const cost = obj(entry['cost'], `${BOOKCASE}'s cost`);
  const atDefaults = obj(cost['at_defaults'], `${BOOKCASE}'s cost.at_defaults`);
  for (const field of ['cpu_ms', 'gpu_ms']) expect(num(atDefaults[field], `cost.at_defaults.${field}`), `cost.at_defaults.${field} is a time`).toBeGreaterThanOrEqual(0);
  expect(num(atDefaults['items'], 'cost.at_defaults.items'), 'at its defaults the kind makes 2 sides, 4 boards and 1 divider').toBe(7);
  expect(isObject(cost) && typeof cost['class'] === 'string', `the cost names its class: ${show(cost)}`).toBe(true);
}, 1_800_000);
