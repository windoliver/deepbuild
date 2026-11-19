// #2817 regression: a test reaches this checkout's hub through a helper's re-export, a path in pieces or a template, and
// a type-only import reaches none. binaryNames, for runs in the checkout itself, never asks cargo for the hub's sake.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { binaryNames, selectBinaries } from '../scripts/proof-binaries.mjs';

function repo(t, files, cargo = '[workspace]\nmembers = ["crates/deep-hook", "crates/deep-show"]\nresolver = "2"\n') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2817-select-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const crate = (name) => ({ [`crates/${name}/Cargo.toml`]: `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\n`, [`crates/${name}/src/main.rs`]: 'fn main() {}\n' });
  for (const [path, bytes] of Object.entries({ 'Cargo.toml': cargo, ...crate('deep-hook'), ...crate('deep-show'), ...files })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  return dir;
}
const start = "import { spawnSync } from 'node:child_process';\nimport test from 'node:test';\n";

test('a test reaching the CLI through a helper\'s re-export gets the hub\'s binaries', (t) => {
  const dir = repo(t, {
    'tests/acceptance/1/helpers.mjs': "export const CLI = 'packages/cli/dist/main.js';\n",
    'tests/acceptance/2/helpers.mjs': "export { CLI } from '../1/helpers.mjs';\n",
    'tests/acceptance/2/hub.test.mjs': `${start}import { CLI } from './helpers.mjs';\ntest('hub', () => spawnSync(process.execPath, [CLI, 'hub', 'run']));\n`,
  });
  assert.deepEqual(selectBinaries(dir, ['tests/acceptance/2/hub.test.mjs']).target, ['deep-hook', 'deep-show']);
});

test('a CLI path joined from pieces, or in a template, gets the hub\'s binaries', (t) => {
  const dir = repo(t, {
    'tests/acceptance/3/joined.test.mjs': `${start}import { join } from 'node:path';\nconst CLI = join(process.cwd(), 'packages', 'cli', 'dist', 'main.js');\ntest('hub', () => spawnSync(process.execPath, [CLI, 'hub', 'run']));\n`,
    'tests/acceptance/4/template.test.mjs': `${start}const root = process.cwd();\ntest('hub', () => spawnSync(process.execPath, [\`\${root}/packages/cli/dist/main.js\`, 'hub', 'run']));\n`,
  });
  for (const file of ['tests/acceptance/3/joined.test.mjs', 'tests/acceptance/4/template.test.mjs']) assert.deepEqual(selectBinaries(dir, [file]).target, ['deep-hook', 'deep-show'], file);
});

test('a type-only import of the hub reaches no hub', (t) => {
  const dir = repo(t, { 'tests/acceptance/5/types.test.ts': "import type { Core } from '../../../packages/hub/src/core.js';\nimport { test } from 'vitest';\ntest('types', () => { const core: Core | null = null; void core; });\n" });
  assert.deepEqual(selectBinaries(dir, ['tests/acceptance/5/types.test.ts']).target, []);
});

test('binaryNames never runs cargo for a selection that only reaches the hub', (t) => {
  const dir = repo(t, { 'tests/acceptance/6/hub.test.mjs': `${start}test('hub', () => spawnSync(process.execPath, ['packages/cli/dist/main.js', 'hub', 'run']));\n` }, 'not a manifest [\n');
  assert.deepEqual(binaryNames(dir, ['tests/acceptance/6/hub.test.mjs']), []);
});

test('a test starting the hub with one command string gets the hub\'s binaries, and a longer package name gets none', (t) => {
  const exec = "import { execSync } from 'node:child_process';\nimport test from 'node:test';\n";
  const dir = repo(t, {
    'tests/acceptance/7/hub.test.mjs': `${exec}test('hub', () => execSync('node packages/cli/dist/main.js hub run'));\n`,
    'tests/acceptance/8/scoped.test.mjs': `${exec}test('hub', () => execSync('npx @deepbuild/cli hub run'));\n`,
    'tests/acceptance/9/other.test.mjs': `${exec}test('other', () => execSync('node mypackages/cli/main.js && node packages/client/main.js'));\n`,
  });
  for (const file of ['tests/acceptance/7/hub.test.mjs', 'tests/acceptance/8/scoped.test.mjs']) assert.deepEqual(selectBinaries(dir, [file]).target, ['deep-hook', 'deep-show'], file);
  assert.deepEqual(selectBinaries(dir, ['tests/acceptance/9/other.test.mjs']).target, []);
});
