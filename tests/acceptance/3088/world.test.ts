// #3088 AC3 and the node_modules half of AC2: what makeWorld (packages/conformance/src/gate-play.ts) puts in a
// world's node_modules for a case's setup.installs. The kit adds, for each listed install, every optional dependency
// the lockfile marks with `os` or `cpu` that this checkout's node_modules holds, copied byte for byte.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeWorld, Owned } from '../../../packages/conformance/src/gate-play.ts';
import { CASES, CORPUS, DARWIN, REPO, caseOf, caught, platformMarked, readManifest, tempDir, tree } from './helpers.ts';

const BINDINGS = '#3088.fa98a351';
const MAC = '#3088.301242f7';
const TIMEOUT = 240_000;

/** The `binding-*` folders under a node_modules/@rolldown, sorted; none when it doesn't exist. */
function bindings(nodeModules: string): string[] {
  try { return readdirSync(join(nodeModules, '@rolldown')).filter((n) => n.startsWith('binding-')).sort(); } catch { return []; }
}

function expectSame(path: string, worldRepo: string): void {
  const source = tree(join(REPO, path));
  const copy = tree(join(worldRepo, path));
  expect([...copy.keys()], `${path} in the world's repo has the same entries as in this checkout`).toEqual([...source.keys()]);
  for (const [rel, what] of source) expect(copy.get(rel), `${path}/${rel} is the same, byte for byte`).toBe(what);
}

describe("a world's node_modules gets the platform packages npm installed for the case's installs", () => {
  const owned = new Owned();
  afterEach(async () => { await owned.stop(); });

  test(`${BINDINGS} a world built from a case whose installs list node_modules/rolldown holds every @rolldown/binding-* folder this checkout's node_modules holds, byte for byte, and none it doesn't`, () => {
    const here = bindings(join(REPO, 'node_modules'));
    expect(here.length, "this checkout's node_modules holds a @rolldown/binding-* folder (npm ci installs this platform's)").toBeGreaterThan(0);
    const base = tempDir('b3088-b-');
    owned.dirs.push(base);
    writeFileSync(join(base, 'README.md'), '# a case\n');
    mkdirSync(join(base, 'src'));
    writeFileSync(join(base, 'src/index.ts'), 'export const x = 1;\n');
    const { value: w, error } = caught(() => makeWorld(owned, base, { installs: ['node_modules/rolldown'] }));
    expect(error, 'makeWorld builds the world without an error').toBe('');
    expectSame('node_modules/rolldown', w!.repo);
    expect(bindings(join(w!.repo, 'node_modules')), `the world's node_modules/@rolldown holds exactly this checkout's binding folders (${here.join(', ')})`).toEqual(here);
    for (const name of here) expectSame(`node_modules/@rolldown/${name}`, w!.repo);
  }, TIMEOUT);

  test.skipIf(!(process.platform === 'darwin' && process.arch === 'arm64'))(`${MAC} on macOS arm64 (macOS arm64 only), the world's node_modules gets @rolldown/binding-darwin-arm64, fsevents and lightningcss-darwin-arm64 though the manifest no longer lists them`, () => {
    const m = readManifest();
    const marked = platformMarked();
    for (const path of DARWIN) expect(marked.has(path), `the lockfile marks ${path} with os or cpu`).toBe(true);
    for (const id of CASES) {
      const c = caseOf(m, id);
      const installs = c.setup?.installs ?? [];
      expect(installs.filter((p) => (DARWIN as readonly string[]).includes(p)), `${id}'s setup.installs no longer lists the darwin folders`).toEqual([]);
      const { value: w, error } = caught(() => makeWorld(owned, join(CORPUS, c.dir, 'base'), { installs }));
      expect(error, `makeWorld builds ${id}'s world without an error`).toBe('');
      for (const path of DARWIN) {
        expect(tree(join(REPO, path)).size, `this checkout holds ${path} (npm ci on macOS arm64)`).toBeGreaterThan(0);
        expectSame(path, w!.repo);
      }
    }
  }, TIMEOUT);
});
