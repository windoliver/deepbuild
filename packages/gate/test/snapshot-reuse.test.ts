// #2078: reading an unchanged tree must not rewrite the snapshot's objects or retention ref. The hub acceptance
// twin counts objects; this regression also sees writes to existing files and a ref moved to a new timestamp.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { makeRepo, openWorld, write } from '../../../tests/acceptance/31/helpers.ts';

/** Persistent files in the object store, including each file's last change time; not the temporary index holder. */
function stored(store: string): unknown[] {
  const files: unknown[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        const { size, mtimeNs, ctimeNs } = statSync(path, { bigint: true });
        files.push([relative(store, path), size, mtimeNs, ctimeNs]);
      }
    }
  };
  for (const folder of ['objects', 'refs']) walk(join(store, folder));
  return files;
}

it('an unchanged tree and HEAD reuse the snapshot without rewriting its objects or retention ref', async () => {
  const world = await openWorld();
  try {
    const repo = makeRepo({ 'value.txt': 'base\n' });
    write(repo, { 'value.txt': 'changed\n' });
    let now = 1_800_000_000_000;
    const checkouts = await world.service({ now: () => now });
    const first = await checkouts.snapshot(repo);
    expect(first.wrote).toBe(true);
    const before = stored(world.store);
    expect(before.length).toBeGreaterThan(0);
    now += 60_000;
    const second = await checkouts.snapshot(repo);
    expect(second).toEqual({ ...first, wrote: false });
    expect(stored(world.store), 'the unchanged snapshot writes neither objects nor a new retention ref').toEqual(before);
  } finally {
    await world.close();
  }
}, 120_000);
