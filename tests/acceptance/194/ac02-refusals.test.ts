// AC2 #194.55eeae36: "Two IDs built to share a u32 hash are refused, naming both, and two rows that inherit from each
// other are refused, naming both"
//
// `deep-catalog pack` on twins of the fixture (fixtures.ts), each answered by a refusal `{ok: false, code, …}` that names
// what it refuses (Asset: tables: catalogs, As built):
// - the items table with two rows more, costarring and liquid, whose FNV-1a 32 hashes are both 0x5e4daa9d (checked here
//   first, a fixture's own truth): `hash_collision {table: items, ids: [costarring, liquid], hash}`;
// - cudgel's base set to spiked_cudgel, whose base is cudgel: `inherit_cycle {table: items, rows: [both]}`.
// The clean fixture packs, so neither refusal is the probe refusing everything.
// The wrong programs: the base (no deep-catalog), a probe that keeps the first of two colliding rows or the last, one
// that names one ID of the two, one that resolves a cycle by stopping at the first row it meets again.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, blocked, fnv32a, packCall, prebuildCatalog, runPack, scratch, show } from './helpers.ts';
import { COLLIDING, INHERITS, SCHEMA, catalog, withCell, withRow } from './fixtures.ts';

prebuildCatalog();

describe(`${AC[2]} colliding IDs and an inheritance cycle are refused, naming both`, () => {
  it(`${AC[2]} two IDs built to share a u32 hash are refused naming both; two rows that inherit from each other are refused naming both`, () => {
    const [x, y] = COLLIDING;
    if (fnv32a(x) !== fnv32a(y)) blocked(`the fixture's two IDs ${x} and ${y} don't share an FNV-1a 32 hash (${fnv32a(x)}, ${fnv32a(y)})`);
    const item = (id: string, name: number) => ({ id, base: null, name, weight: 1, value: 1, stack: true, damage: null });
    const colliding = withRow(withRow(catalog(), 'items', item(x, 1050)), 'items', item(y, 1051));
    const cycle = withCell(catalog(), 'items', INHERITS.from, 'base', INHERITS.id);
    const dir = scratch('ac02');
    const [clean, collided, cycled] = runPack([packCall(dir, catalog(), SCHEMA), packCall(dir, colliding, SCHEMA), packCall(dir, cycle, SCHEMA)]);
    expect(clean!['ok'], `the clean fixture packs: ${show(clean)}`).toBe(true);

    expect([collided!['ok'], collided!['code']], `the colliding IDs are refused as a hash collision: ${show(collided)}`).toEqual([false, 'hash_collision']);
    expect(collided!['table'], 'naming the table').toBe('items');
    expect(collided!['ids'], 'naming both IDs, sorted').toEqual([x, y].sort());
    expect(collided!['hash'], 'and the hash they share').toBe(fnv32a(x));

    expect([cycled!['ok'], cycled!['code']], `the two rows that inherit from each other are refused as a cycle: ${show(cycled)}`).toEqual([false, 'inherit_cycle']);
    expect(cycled!['table'], 'naming the table').toBe('items');
    expect([...(cycled!['rows'] as string[])].sort(), 'naming both rows').toEqual([INHERITS.from, INHERITS.id].sort());
  }, TIMEOUT);
});
