// Supplemental #2122 proof of keep's rename, not the separately covered ensure path.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openUnder } from '@deepbuild/supervisor';
import { Products } from '../src/products.js';
import { addGuards } from '../src/guards.js';
import { deepHook } from '../src/paths.js';
import { git, indexAt, productSpec } from './products-2122-fixture.js';

it('keep replaces a same-key orphan after index loss and serves an independent copy-on-write product', async () => {
  const home = realpathSync(mkdtempSync('/tmp/keep-2122-'));
  const root = join(home, 'store');
  const repo = join(home, 'repo');
  const src = join(repo, 'target');
  mkdirSync(root);
  mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  mkdirSync(src);
  writeFileSync(join(repo, '.deepbuild/done.yaml'), productSpec);
  writeFileSync(join(repo, 'lock'), 'one\n');
  git(repo, 'init', '-q', '-b', 'main');
  const unused = async (): Promise<never> => { throw Error('keep must not build or start a session'); };
  const open = async () => {
    const products = new Products({
      root, now: Date.now, openUnder, trusted: unused, build: unused, append: unused,
      guard: async given => {
        const result = await addGuards(root, given, { deepHook: deepHook(), classes: {} });
        expect(result.status).toBe('installed');
        return result;
      },
    });
    await products.open();
    return products;
  };
  let products: Products | undefined;
  try {
    products = await open();
    const [product] = await products.declared(repo, ['target']);
    expect(product).toBeDefined();
    const { name, path, key } = product!;
    writeFileSync(join(src, 'artifact'), 'old');
    writeFileSync(join(src, 'orphan-only'), 'must disappear');
    await products.keep(repo, name, path, key, src);
    expect(await products.holds(repo, name, key)).toBe(true);
    const entry = indexAt(root).entries[0]!;
    const kept = join(products.store, entry.repo, `${name}@${key}`, 'src', path);
    expect(readFileSync(join(kept, 'orphan-only'), 'utf8')).toBe('must disappear');
    products.close();
    rmSync(join(root, 'products.json'));
    rmSync(join(src, 'orphan-only'));
    writeFileSync(join(src, 'artifact'), 'replacement');

    products = await open();
    expect(await products.holds(repo, name, key)).toBe(false);
    await expect(products.keep(repo, name, path, key, src), 'keep must replace the unindexed non-empty target').resolves.toBeUndefined();
    expect(existsSync(join(kept, 'orphan-only'))).toBe(false);
    expect(indexAt(root).entries).toEqual([expect.objectContaining({ repo: entry.repo, name, path, key })]);
    expect(await products.holds(repo, name, key)).toBe(true);
    writeFileSync(join(src, 'artifact'), 'source edited after keep');
    const received = join(home, 'received');
    expect(await products.placeIn(repo, name, key, received)).toBeUndefined();
    expect(lstatSync(received).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(received, 'artifact')).ino).not.toBe(lstatSync(join(kept, 'artifact')).ino);
    expect(readFileSync(join(received, 'artifact'), 'utf8')).toBe('replacement');
    writeFileSync(join(received, 'artifact'), 'consumer edit');
    expect(readFileSync(join(kept, 'artifact'), 'utf8')).toBe('replacement');
  } finally {
    products?.close();
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);
