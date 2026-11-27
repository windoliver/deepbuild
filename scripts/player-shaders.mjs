import { existsSync, globSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = 'crates/deep-player/web/dist';
export const SHADER_RECORD = 'shaders.json';

const shaderFiles = (root) => globSync('{crates,vendor}/**/*.wgsl', { cwd: root, exclude: (entry) => entry.name === 'target' || entry.name === 'node_modules' }).map((path) => path.split(sep).join(posix.sep)).sort();
const holds = (wasm, root, path) => wasm.includes(readFileSync(join(root, path)));

export function shaderRecord(root, dist) {
  const shaders = shaderFiles(root);
  const sets = readdirSync(dist, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  return Object.fromEntries(sets.map((set) => {
    const wasm = readFileSync(join(dist, set, 'player_bg.wasm'));
    return [set, shaders.filter((path) => holds(wasm, root, path))];
  }));
}

export function staleShaders(root) {
  const record = JSON.parse(readFileSync(join(root, DIST, SHADER_RECORD), 'utf8'));
  const stale = [];
  for (const [set, shaders] of Object.entries(record)) {
    const wasm = readFileSync(join(root, DIST, set, 'player_bg.wasm'));
    for (const path of shaders) {
      if (!existsSync(join(root, path))) stale.push({ set, path, why: 'which the checkout no longer has' });
      else if (!holds(wasm, root, path)) stale.push({ set, path, why: 'as an older text than the checkout\'s' });
    }
  }
  return stale;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--root');
  const root = at >= 0 ? process.argv[at + 1] : fileURLToPath(new URL('../', import.meta.url));
  let stale;
  try {
    stale = staleShaders(root);
  } catch (error) {
    console.log(`BLOCKED player-shaders: ${error.message}`);
    console.log(`  Fix: build the web player again with node scripts/player-wasm.mjs, which writes ${DIST}/${SHADER_RECORD}.`);
    process.exit(2);
  }
  for (const { set, path, why } of stale) console.log(`FAIL player-shaders: ${DIST}/${set}/player_bg.wasm was built with ${path} ${why}`);
  if (stale.length) console.log('  Fix: build the web player again with node scripts/player-wasm.mjs and commit crates/deep-player/web/dist.');
  else console.log(`PASS player-shaders: each committed set of the web player holds its shaders as the checkout has them`);
  process.exit(stale.length ? 1 : 0);
}
