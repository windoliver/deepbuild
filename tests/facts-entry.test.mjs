// #1686: the agents' facts are read through @deepbuild/adapters' entry, never by a path into the repo's adapters/ folder, so
// one place decides where the facts live and a package that R2 installs alone finds them. Two places reach the folder
// itself, each named in its card's Deviations: the adapters package, which owns the facts engine and the files, and
// the CLI, which replays a recorded session through the engine before any heavy import loads.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const OWNERS = new Set(['adapters', 'cli']);
const sources = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : sources(path);
  return /\.(ts|mts|mjs|js)$/.test(name) && !/\.test\.[mc]?[jt]s$/.test(name) ? [path] : [];
});
// A literal that names the folder from a package's source: '../../../adapters/…', or join(REPO, 'adapters', …).
const REACH = /['"`](?:\.\.\/)+adapters\/|join\([^)]*['"]adapters['"]/;

test("no package but adapters and the CLI reads the repo's adapters/ folder by path", () => {
  const found = [];
  for (const name of readdirSync(join(root, 'packages'))) {
    const src = join(root, 'packages', name, 'src');
    if (OWNERS.has(name) || !statSync(src, { throwIfNoEntry: false })) continue;
    for (const file of sources(src)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (REACH.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) found.push(`${relative(root, file)}:${index + 1}`);
      });
    }
  }
  assert.deepEqual(found, []);
});

test('readFacts reads a shipped facts file through the adapters entry, and refuses a name outside the folder', async () => {
  const { readFacts } = await import('@deepbuild/adapters');
  const onDisk = JSON.parse(readFileSync(join(root, 'adapters', 'loops.facts.json'), 'utf8'));
  assert.deepEqual(readFacts('loops.facts.json'), onDisk);
  assert.throws(() => readFacts('../package.json'), /facts file/);
});
