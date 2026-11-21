// #1898 AC1: the static import closure of the `deep lease` path holds no `yaml` and no SQLite addon. The path starts
// at the built CLI, packages/cli/dist/main.js, whose own static imports load for every command, and goes on through
// the module its lease branch (`args[0] === 'lease'`) imports, as the CLI's package resolves that specifier. The walk
// (walk.ts) follows every static edge from there, through workspace packages and third-party ones, and a failure names
// each chain from the entry to the module it shouldn't reach.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { REPO, resolveFrom, shown, walk } from './walk.ts';

const MAIN = join(REPO, 'packages/cli/dist/main.js');
const blocked = (why: string): never => { throw new Error(`BLOCKED: ${why}`); };

it('#1898.ff1558c5 the static import closure of the deep lease path, from the CLI\'s entry through its lease branch\'s module, reaches no yaml and no SQLite addon', () => {
  if (!existsSync(MAIN)) blocked(`${shown(MAIN)} is missing: run npm run build --workspaces`);
  // The walk sees what it's asked about: the product store's module, which reads YAML and writes through SQLite, reaches
  // both. A walk that can't see them proves nothing about the lease path.
  const store = join(REPO, 'packages/hub/dist/vfs.js');
  const yamlUser = join(REPO, 'packages/hub/dist/yaml.js');
  if (!existsSync(store) || !existsSync(yamlUser)) blocked('packages/hub/dist/vfs.js or yaml.js is missing, so the walk has nothing to show it sees yaml and SQLite with');
  const seen = walk([{ file: store, via: 'control' }, { file: yamlUser, via: 'control' }]).hits.map((h) => h.what);
  if (!seen.includes('yaml') || !seen.some((w) => w.startsWith('the SQLite addon'))) blocked(`the walk doesn't see yaml and better-sqlite3 from the hub's vfs.js and yaml.js (it saw: ${seen.join(', ') || 'nothing'})`);

  // The lease branch's module, as the built CLI names it.
  const source = readFileSync(MAIN, 'utf8');
  const branch = source.match(/args\[0\] === 'lease'\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? blocked(`${shown(MAIN)} has no \`args[0] === 'lease'\` branch`);
  const spec = branch.match(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/)?.[1] ?? blocked(`the lease branch of ${shown(MAIN)} imports no module by name`);
  const entry = resolveFrom(spec, MAIN, 'import') ?? blocked(`'${spec}', the lease branch's module, doesn't resolve from ${shown(MAIN)}`);

  const lease = walk([{ file: MAIN, via: 'entry' }, { file: entry, via: `packages/cli/dist/main.js's lease branch, import('${spec}') →` }]);
  expect(lease.parent.size, 'the walk reached more than the two roots').toBeGreaterThan(2);
  expect(lease.unresolved, 'every static import on the lease path resolves').toEqual([]);
  expect(lease.hits.map((h) => `${h.what}: ${h.chain.join(' → ')}`), 'modules on the lease path\'s static closure that are yaml or the SQLite addon, each with its chain').toEqual([]);
});
