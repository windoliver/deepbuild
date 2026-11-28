import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { binaryNames, placeHubBinaries, selectBinaries } from '../scripts/proof-binaries.mjs';

const CRATES = ['deep-hook', 'deep-show', 'deep-app'];
function repo(t, files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3720-select-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const crate = (name) => ({ [`crates/${name}/Cargo.toml`]: `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\n`, [`crates/${name}/src/main.rs`]: 'fn main() {}\n' });
  const cargo = `[workspace]\nmembers = [${CRATES.map((name) => `"crates/${name}"`).join(', ')}]\nresolver = "2"\n`;
  for (const [path, bytes] of Object.entries({ 'Cargo.toml': cargo, ...Object.assign({}, ...CRATES.map(crate)), ...files })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  return dir;
}
const start = "import { spawnSync } from 'node:child_process';\nimport { join } from 'node:path';\nimport test from 'node:test';\n";
const APP_HELPER = "import { join } from 'node:path';\nexport const APP = process.env.DEEP_APP_BIN || join(process.cwd(), 'target/debug/deep-app');\n";

test('a test whose helper reads target/debug/deep-app gets that binary in the copy, and runs with it placed (#3720)', (t) => {
  const dir = repo(t, {
    'tests/acceptance/1/helpers.mjs': APP_HELPER,
    'tests/acceptance/1/app.test.mjs': `${start}import { APP } from './helpers.mjs';\ntest('app', () => spawnSync(APP, ['check']));\n`,
    'tests/acceptance/2/plain.test.mjs': `${start}test('plain', () => spawnSync('git', ['status']));\n`,
  });
  const selected = selectBinaries(dir, ['tests/acceptance/1/app.test.mjs', 'tests/acceptance/2/plain.test.mjs']);
  assert.deepEqual(selected.target, ['deep-app']);
  assert.deepEqual(selected.hub, ['tests/acceptance/1/app.test.mjs']);
  assert.deepEqual(selected.bin, []);
});

test('a path joined from pieces names the binary too, beside the hub\'s own', (t) => {
  const dir = repo(t, {
    'tests/acceptance/3/pieces.test.mjs': `${start}const APP = join(process.cwd(), 'target', 'debug', 'deep-app');\ntest('app', () => spawnSync(APP, []));\n`,
    'tests/acceptance/4/hub.test.mjs': `${start}test('hub', () => spawnSync(process.execPath, ['packages/cli/dist/main.js', 'hub', 'run']));\n`,
  });
  assert.deepEqual(selectBinaries(dir, ['tests/acceptance/3/pieces.test.mjs']).target, ['deep-app']);
  const both = selectBinaries(dir, ['tests/acceptance/3/pieces.test.mjs', 'tests/acceptance/4/hub.test.mjs']);
  assert.deepEqual(both.target, ['deep-hook', 'deep-show', 'deep-app']);
  assert.deepEqual(both.hub.toSorted(), ['tests/acceptance/3/pieces.test.mjs', 'tests/acceptance/4/hub.test.mjs']);
});

test('a test that builds its binary itself, in its own call or a helper\'s, names no workspace binary, or names a path in another machine gets none', (t) => {
  const dir = repo(t, {
    'tests/acceptance/5/builds.test.mjs': `${start}const APP = join(process.cwd(), 'target/debug/deep-app');\ntest('app', () => { spawnSync('cargo', ['build', '--locked', '-p', 'deep-app']); spawnSync(APP, []); });\n`,
    'tests/acceptance/9/helpers.mjs': "import { spawnSync } from 'node:child_process';\nimport { join } from 'node:path';\nconst run = (command, args) => spawnSync(command, args);\nexport const APP = join(process.cwd(), 'target/debug/deep-app');\nexport const built = () => run('cargo', ['build', '--locked', '-p', 'deep-app']);\n",
    'tests/acceptance/9/wrapped.test.mjs': `${start}import { APP, built } from './helpers.mjs';\ntest('app', () => { built(); spawnSync(APP, []); });\n`,
    'tests/acceptance/6/unknown.test.mjs': `${start}test('other', () => spawnSync(join(process.cwd(), 'target/debug/greet'), []));\n`,
    'tests/acceptance/7/container.test.mjs': `${start}test('container', () => spawnSync('docker', ['run', 'image', '/target/debug/deep-app']));\n`,
  });
  for (const file of ['tests/acceptance/5/builds.test.mjs', 'tests/acceptance/9/wrapped.test.mjs', 'tests/acceptance/6/unknown.test.mjs', 'tests/acceptance/7/container.test.mjs']) {
    const selected = selectBinaries(dir, [file]);
    assert.deepEqual([selected.target, selected.hub], [[], []], file);
  }
});

test('a run in the checkout itself, which keeps its own target/, is asked for none', (t) => {
  const dir = repo(t, { 'tests/acceptance/8/app.test.mjs': `${start}test('app', () => spawnSync(join(process.cwd(), 'target/debug/deep-app'), []));\n` });
  assert.deepEqual(binaryNames(dir, ['tests/acceptance/8/app.test.mjs']), []);
  assert.deepEqual(selectBinaries(dir, ['tests/acceptance/8/app.test.mjs'], false).target, []);
});

test('a binary placed for one use of a bay is gone for the next use that needs none', (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3720-place-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'), bay = join(dir, 'bay'), placed = (name) => join(bay, 'target', 'debug', name);
  mkdirSync(bin);
  for (const name of ['deep-app', 'deep-hook']) { writeFileSync(join(bin, name), `#!/bin/sh\necho ${name}\n`); chmodSync(join(bin, name), 0o755); }
  mkdirSync(join(bay, 'target', 'debug', 'deps'), { recursive: true });
  writeFileSync(placed('deps/kept'), 'intermediate');
  placeHubBinaries(bay, bin, ['deep-app', 'deep-hook']);
  assert.equal(readFileSync(placed('deep-app'), 'utf8'), '#!/bin/sh\necho deep-app\n');
  placeHubBinaries(bay, bin, ['deep-hook']);
  assert.deepEqual([existsSync(placed('deep-app')), existsSync(placed('deep-hook'))], [false, true]);
  placeHubBinaries(bay, bin, []);
  assert.deepEqual([existsSync(placed('deep-app')), existsSync(placed('deep-hook')), existsSync(placed('deps/kept'))], [false, false, true]);
});
