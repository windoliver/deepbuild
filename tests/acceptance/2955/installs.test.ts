// #2955: the gate@1 kit's player copies a case's setup.installs into each world's repo. Its one criterion:
// "On Linux, `makeWorld` copies a case's installs into its world's repo byte for byte. On macOS the call stays
// `/bin/cp -cR`, unchanged." Both tests call `makeWorld` from packages/conformance/src/gate-play.ts (the module the
// issue names; the package's entry doesn't export it) with the installs of the corpus's own cases plus a fixture
// tree, and compare each copy with its source in this checkout: same entries, same bytes, same link targets.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeWorld, Owned, REPO, type World } from '../../../packages/conformance/src/gate-play.ts';

const ID = '#2955.a3f66150';
const TIMEOUT = 60_000;
/** Installs as packages/conformance/fixtures/gate/manifest.json's cases name them, and a tree with binary bytes. */
const INSTALLS = [
  'node_modules/@jridgewell/resolve-uri',
  'node_modules/@jridgewell/sourcemap-codec',
  'node_modules/@jridgewell/trace-mapping',
  'tests/acceptance/2955/fixtures/install-tree',
];

/** Every entry under root, path → what it is: a file's bytes, a link's target, or a folder. */
function tree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const rel = p.slice(root.length + 1);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out.set(rel, `link ${readlinkSync(p)}`);
      else if (st.isDirectory()) { out.set(rel, 'folder'); walk(p); }
      else out.set(rel, `file ${readFileSync(p).toString('base64')}`);
    }
  };
  walk(root);
  return out;
}

/** A case's base folder with one file, as a corpus case's base/ holds. */
function baseFolder(owned: Owned): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'b2955-')));
  owned.dirs.push(dir);
  writeFileSync(join(dir, 'README.md'), '# a case\n');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/index.ts'), 'export const x = 1;\n');
  return dir;
}

function expectCopied(w: World): void {
  for (const path of INSTALLS) {
    const source = tree(join(REPO, path));
    expect(source.size, `this checkout has ${path} with entries (npm ci, then the suite)`).toBeGreaterThan(0);
    const copy = tree(join(w.repo, path));
    expect([...copy.keys()], `${path} in the world's repo has the same entries as in the checkout`).toEqual([...source.keys()]);
    for (const [rel, what] of source) expect(copy.get(rel), `${path}/${rel} is the same, byte for byte`).toBe(what);
  }
}

/** makeWorld with the installs; what it threw, if anything, comes back rather than ending the test before its assertion. */
function play(owned: Owned): { w?: World; error: string } {
  const base = baseFolder(owned);
  try { return { w: makeWorld(owned, base, { installs: INSTALLS }), error: '' }; }
  catch (e) { const x = e as { message?: string; stderr?: Buffer | string }; return { error: `${x.message ?? String(e)} ${x.stderr ? String(x.stderr) : ''}`.trim() }; }
}

describe("makeWorld copies a case's installs into its world's repo", () => {
  const owned = new Owned();
  afterEach(async () => { await owned.stop(); });

  test(`${ID} on Linux, makeWorld copies a case's installs into its world's repo byte for byte`, (ctx) => {
    if (process.platform !== 'linux') ctx.skip(`Linux only (this is ${process.platform})`);
    const { w, error } = play(owned);
    expect(error, 'makeWorld copies the installs without an error').toBe('');
    expectCopied(w!);
  }, TIMEOUT);

  test(`${ID} on macOS, makeWorld still copies a case's installs into its world's repo byte for byte (the /bin/cp -cR call, unchanged)`, (ctx) => {
    if (process.platform !== 'darwin') ctx.skip(`macOS only (this is ${process.platform})`);
    const { w, error } = play(owned);
    expect(error, 'makeWorld copies the installs without an error').toBe('');
    expectCopied(w!);
  }, TIMEOUT);
});
