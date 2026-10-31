// Each workspace package declares every @deepbuild package its source imports, so a package installed on its own,
// as R2's npm release installs it, finds what it imports; npm's workspace links otherwise hide a missing one. A
// package's source imports others only through their public entry, never by a path into another package; the
// repo's adapters/ folder, the agents' facts and their mapper that scripts and tests read too, is the one shared
// place it may reach, until R2's packaging gives those facts a package of their own.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = readdirSync(join(root, 'packages')).filter((name) => statSync(join(root, 'packages', name, 'package.json'), { throwIfNoEntry: false }));
const sources = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : sources(path);
  return /\.(ts|mts|mjs|js)$/.test(name) && !/\.test\.[mc]?[jt]s$/.test(name) ? [path] : [];
});
/** The @deepbuild packages a file imports, statically, dynamically or for types alone, and its relative imports. */
const importsOf = (text) => ({
  packages: [...text.matchAll(/(?:from|import\()\s*'@deepbuild\/([\w-]+)/g)].map((m) => m[1]),
  relative: [...text.matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)].map((m) => m[1]),
});

test('every @deepbuild package a package\'s source imports is in its package.json dependencies', () => {
  const missing = [];
  for (const name of packages) {
    const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
    const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }));
    const src = join(root, 'packages', name, 'src');
    const used = new Set(statSync(src, { throwIfNoEntry: false }) ? sources(src).flatMap((file) => importsOf(readFileSync(file, 'utf8')).packages) : []);
    for (const dep of [...used].sort()) if (dep !== name && !declared.has(`@deepbuild/${dep}`)) missing.push(`packages/${name} imports @deepbuild/${dep} but doesn't declare it`);
  }
  assert.deepEqual(missing, []);
});

test('no package\'s source imports another package\'s files by a relative path', () => {
  const outside = [];
  const shared = join(root, 'adapters') + sep;
  for (const name of packages) {
    const own = join(root, 'packages', name) + sep;
    const src = join(root, 'packages', name, 'src');
    if (!statSync(src, { throwIfNoEntry: false })) continue;
    for (const file of sources(src)) {
      for (const spec of importsOf(readFileSync(file, 'utf8')).relative) {
        const target = resolve(file, '..', spec);
        if (!target.startsWith(own) && !target.startsWith(shared)) outside.push(`${relative(root, file)} imports ${spec}, outside packages/${name}`);
      }
    }
  }
  assert.deepEqual(outside, []);
});
