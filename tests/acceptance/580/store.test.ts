// #580 AC4: a claim's stack on the sample app runs no install step when the product store (#1017) already holds
// node_modules for its lockfile, and the run's record names that store entry and its key. A planted environment that
// keeps installs in a second store of its own fails this test, naming the duplicate folder. The sample lists
// `environment.products` and has an origin, so the hub builds the entry from the default branch at the first session.
// The duplicate is found on disk: a folder of the hub's own, outside the store and the run's checkouts, holding an npm
// install.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Bench, failureOf, passed, stepOf, type Done } from './helpers.ts';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 300_000);

/** Every npm install under the hub's folder but the store's and the run's checkout. */
function duplicates(root: string, checkouts: string[]): string[] {
  const found: string[] = [];
  const walk = (at: string, depth: number): void => {
    if (depth > 8 || checkouts.includes(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(at, entry.name);
      if (path === join(root, 'products')) continue;
      if (entry.name === 'node_modules') { if (existsSync(join(path, '.package-lock.json'))) found.push(path); continue; }
      walk(path, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}
async function scenario(plant?: string): Promise<{ b: Bench; d: Done; key: string; installsBefore: number }> {
  const b = bench = await Bench.open({ products: true, ...(plant ? { plant } : {}) });
  const s = await b.session();
  const built = await b.until(async () => (await b.events()).find((e) => e.kind === 'product.built' && e.data.product === 'node_modules'), 300_000, 'the store to build node_modules for the lockfile (product.built)');
  const installsBefore = b.stepLog().filter((l) => l.step === 'install').length;
  const d = await b.whole(s);
  return { b, d, key: String(built.data.key), installsBefore };
}
function criterion({ b, d, key, installsBefore }: Awaited<ReturnType<typeof scenario>>): void {
  const duplicate = duplicates(b.w.root, [d.served.checkout]);
  expect(duplicate, `a second store of installs beside the product store: ${duplicate.join(', ')}`).toEqual([]);
  const install = stepOf(d.served, 'install');
  expect(install.status, 'no install step ran').toBe('reused');
  expect(b.stepLog().filter((l) => l.step === 'install').length, 'the sample logged no install').toBe(installsBefore);
  expect(install.product?.name, 'the run\'s record names the store\'s entry').toBe('node_modules');
  expect(install.product?.key, 'and its key').toBe(key);
  passed(d);
  expect(d.app?.linked, 'the entry is cloned into the checkout, never linked').toBe(false);
}

describe('AC4 #580 a check\'s install and a worktree\'s come from the same kept copy', () => {
  it('AC4 with node_modules for the lockfile in the product store, a claim\'s stack runs no install and its record names the entry and its key', async () => {
    criterion(await scenario());
  }, 1_500_000);

  it('AC4 (wrong program) an environment that keeps installs in a second store of its own (DEEP_HUB_PLANT=env-second-install-store) fails this test, naming the duplicate folder', async () => {
    let seen: Awaited<ReturnType<typeof scenario>> | undefined;
    const failure = await failureOf(async () => { seen = await scenario('env-second-install-store'); criterion(seen); });
    expect(failure, 'the planted environment passed').not.toBeNull();
    expect(failure, 'naming the duplicate folder').toContain(`${seen!.b.w.root}/`);
    expect(failure, 'naming the duplicate folder').toContain('node_modules');
  }, 1_500_000);
});
