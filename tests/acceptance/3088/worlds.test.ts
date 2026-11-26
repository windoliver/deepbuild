// #3088: the world `makeWorld` (packages/conformance/src/gate-play.ts, the module the issue names; the package's entry
// doesn't export it) builds from a case's installs gets the platform packages this checkout's npm chose. Criteria:
//   #3088.fa98a351 "A world built from a case whose installs list `node_modules/rolldown` holds every
//   `@rolldown/binding-*` folder this checkout's `node_modules` holds, byte for byte, and none it doesn't."
//   #3088.301242f7 "On macOS arm64, … the world's `node_modules` gets `@rolldown/binding-darwin-arm64`, `fsevents` and
//   `lightningcss-darwin-arm64` even though the manifest no longer lists them." (the plays half is in plays.test.ts)
// What makeWorld throws is caught and asserted to be nothing, so a failure shows the error, not a throw.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeWorld, Owned, type World } from '../../../packages/conformance/src/gate-play.ts';
import { CASES, DARWIN, REPO, clean, namesIn, readManifest, tempDir, tree } from './helpers.ts';

const TIMEOUT = 5 * 60_000;

/** A case's base folder with two files, as a corpus case's base/ holds. */
function baseFolder(): string {
  const dir = tempDir('b3088-base-');
  writeFileSync(join(dir, 'README.md'), '# a case\n');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/index.ts'), 'export const x = 1;\n');
  return dir;
}
function build(owned: Owned, installs: string[]): { w?: World; error: string } {
  try { return { w: makeWorld(owned, baseFolder(), { installs }), error: '' }; }
  catch (e) { const x = e as { message?: string; stderr?: Buffer | string }; return { error: `${x.message ?? String(e)} ${x.stderr ? String(x.stderr) : ''}`.trim() }; }
}
function expectSame(w: World, path: string): void {
  const source = tree(join(REPO, path));
  const copy = namesIn(join(w.repo, path)).length ? tree(join(w.repo, path)) : new Map<string, string>();
  expect([...copy.keys()], `${path} in the world's repo has the same entries as in this checkout`).toEqual([...source.keys()]);
  for (const [rel, what] of source) expect(copy.get(rel), `${path}/${rel} in the world is the checkout's, byte for byte`).toBe(what);
}
const bindings = (nodeModules: string): string[] => namesIn(join(nodeModules, '@rolldown')).filter((n) => n.startsWith('binding-'));

describe("a world built from a case's installs gets the checkout's platform packages", () => {
  const owned = new Owned();
  afterEach(async () => { await owned.stop(); clean(); });

  test("#3088.fa98a351 a world whose case installs node_modules/rolldown holds every @rolldown/binding-* folder this checkout's node_modules holds, byte for byte, and none it doesn't", () => {
    const held = bindings(join(REPO, 'node_modules'));
    expect(held.length, "this checkout's node_modules holds a @rolldown/binding-* folder (npm ci)").toBeGreaterThan(0);
    const { w, error } = build(owned, ['node_modules/rolldown']);
    expect(error, 'makeWorld builds the world without an error').toBe('');
    expectSame(w!, 'node_modules/rolldown');
    expect(bindings(join(w!.repo, 'node_modules')), "the world's node_modules/@rolldown holds exactly the checkout's binding-* folders").toEqual(held);
    for (const name of held) expectSame(w!, `node_modules/@rolldown/${name}`);
  }, TIMEOUT);

  test("#3088.301242f7 on macOS arm64 (macOS arm64 only), each case's world gets @rolldown/binding-darwin-arm64, fsevents and lightningcss-darwin-arm64 though the manifest no longer lists them", (ctx) => {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') ctx.skip(`macOS arm64 only (this is ${process.platform} ${process.arch})`);
    const m = readManifest();
    for (const id of CASES) {
      const c = m.cases.find((x) => x.id === id);
      expect(c, `the shipped manifest has the case ${id}`).toBeDefined();
      const installs = c!.setup?.installs ?? [];
      const { w, error } = build(owned, installs);
      expect(error, `makeWorld builds ${id}'s world without an error`).toBe('');
      for (const path of DARWIN) expectSame(w!, path);
      expect(installs.filter((p) => DARWIN.includes(p)), `${id}'s setup.installs no longer lists the macOS-only folders`).toEqual([]);
    }
  }, TIMEOUT);
});
