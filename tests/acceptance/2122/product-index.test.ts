import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { productWorld } from './products-helper.ts';

it('AC1: rebuilding the same commit replaces a product folder its lost index no longer names', async () => {
  const w = await productWorld();
  try {
    const first = await w.open();
    expect((await w.build(first)).map((e) => e.kind)).toContain('product.built');
    const initial = w.index().entries;
    expect(initial).toHaveLength(1);
    const entry = initial[0];
    expect(entry.commit).toBe(w.commit);
    const folder = join(first.store, entry.repo, `${entry.name}@${entry.key}`);
    expect(readFileSync(join(folder, 'src/out/value'), 'utf8')).toBe('fresh');
    first.close();
    rmSync(join(w.root, 'products.json'));
    // Distinguishes replacement by a new build from merely adopting the orphan.
    writeFileSync(join(folder, 'src/out/value'), 'orphan');
    writeFileSync(join(folder, 'orphan-only'), 'not in the next build');
    const reopened = await w.open();
    const terminal = await w.build(reopened);
    const readings = terminal.filter((e) => e.kind === 'session.reading').map((e) => e.data);
    console.log('AC1 rebuild readings:', JSON.stringify(readings));
    expect.soft(readings, 'the rebuilt key must not report a failed rename/build').toEqual([]);
    expect.soft(w.index().entries.map((e: { key: string; commit: string }) => ({ key: e.key, commit: e.commit })), 'the same key and commit must be indexed again').toEqual([{ key: entry.key, commit: w.commit }]);
    expect.soft(readFileSync(join(folder, 'src/out/value'), 'utf8'), 'new build bytes replace orphan bytes').toBe('fresh');
    expect.soft(existsSync(join(folder, 'orphan-only')), 'replacement removes files absent from the new build').toBe(false);
  } finally { await w.close(); }
}, 90_000);
