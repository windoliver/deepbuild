// The packs the #3611 acceptance tests give a core: the release's own, read from this checkout's `packs/` at test time,
// and test packs written into a test's own folder, since a test changes their bytes under the same folder. A test pack
// is #306's bar-chart fixture under a name of its own: one recipe, one input. Its check passes while the input's
// default is inside its range and refuses it, `out_of_range`, once the default is outside.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, blocked } from './core.mjs';

/** The owner the test packs are published under, as #306's are. */
const OWNER = 'test';
const VERSION = '1.0.0';

/**
 * Writes one test pack's folder, or writes it again with other bytes: `default` is the recipe's one input's default
 * (its range is 1 to 12: 3 passes the pack check, 0 is refused), `width` the bars' width (16, or 18 for other bytes
 * that pass too), `requires` the versions it requires, each `owner/name@version`.
 */
export function writePack(dir, name, { fallback = 3, width = 16, requires = [] } = {}) {
  mkdirSync(dir, { recursive: true });
  const pack = {
    name,
    version: VERSION,
    license: 'MIT',
    description: `A test pack of the #3611 acceptance suite: bar charts laid out from a count.`,
    requires: { core: '>=0.0.0', modules: { marks2d: '>=0.0.0' }, ...(requires.length ? { packs: requires } : {}) },
    recipes: { [`${name}.bars@1`]: 'bars@1.json' },
  };
  const recipe = {
    id: `${name}.bars`,
    version: '1.0',
    title: 'Bars',
    license: 'MIT',
    author: 'the #3611 acceptance suite',
    description: `n rects of rising height, 24 units apart and ${width} wide, left to right from the instance's origin.`,
    inputs: { n: { type: 'integer', default: fallback, min: 1, max: 12, about: 'how many bars' } },
    steps: { bars: { op: 'mark', kind: 'rect@1', repeat: { count: 'n', as: 'i' }, params: { box: [0, 0, width, '40 + 8 * i'], paint: { fill: { role: 'muted' } } }, at: { pos: ['24 * i', 0, 0] } } },
    outputs: { parts: ['bars'] },
  };
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
  writeFileSync(join(dir, 'bars@1.json'), `${JSON.stringify(recipe, null, 2)}\n`);
}

/**
 * A test pack in `at`'s folders, written now: `{name, id, version, ref, dir, offer}`, `offer` being the `{id, dir}` a
 * world's `packs` holds, and `rewrite(options)` writing its folder again with other bytes.
 */
export function testPack(at, name, options = {}) {
  const dir = join(at.folders, name);
  writePack(dir, name, options);
  const id = `${OWNER}/${name}`;
  return { name, id, version: VERSION, ref: `${id}@${VERSION}`, dir, offer: { id, dir }, rewrite: (other) => writePack(dir, name, other) };
}

/**
 * The packs the release ships, as the hub reads them (packages/hub/src/packs.ts `releasePacks`, `readPack`): each
 * folder of the checkout's `packs/` that holds a `pack.json`, in order, as `deepbuild/<name>` at its version.
 * `provider` says its manifest carries a provider: such a version keeps no row (the design step).
 */
export function shippedPacks() {
  const root = join(REPO, 'packs');
  if (!existsSync(root)) throw blocked(`the checkout holds no packs/ folder at ${root}`);
  const found = readdirSync(root).sort().filter((folder) => existsSync(join(root, folder, 'pack.json'))).map((folder) => {
    const dir = join(root, folder);
    let manifest;
    try { manifest = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')); } catch (error) { throw blocked(`${folder}/pack.json can't be read: ${error.message}`); }
    const id = `deepbuild/${String(manifest.name)}`;
    const version = String(manifest.version);
    const provider = typeof manifest.providers === 'object' && manifest.providers !== null && Object.keys(manifest.providers).length > 0;
    return { folder, name: String(manifest.name), id, version, ref: `${id}@${version}`, dir, offer: { id, dir }, provider };
  });
  if (!found.length) throw blocked(`no folder of ${root} holds a pack.json`);
  return found;
}

/** One shipped pack by its name; BLOCKED when the release ships none of that name. */
export function shippedPack(name) {
  const pack = shippedPacks().find((p) => p.name === name);
  if (!pack) throw blocked(`the release ships no pack named ${name}`);
  return pack;
}
