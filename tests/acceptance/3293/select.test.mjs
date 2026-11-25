// Acceptance tests for #3293, written blind on c1a98fec9: a test that runs other test files in a child Vitest gets the
// hub's binaries from `selectBinaries` when one of those files reaches the hub's or the CLI's package, and none when
// none does. See README.md for the criteria, the fixtures and the base run.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectBinaries } from '../../../scripts/proof-binaries.mjs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const HUB = ['deep-hook', 'deep-show'];

/** A scratch checkout with a Cargo workspace whose binaries include the hub's two, plus `files`. */
function repo(t, files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3293-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const crate = (name) => ({
    [`crates/${name}/Cargo.toml`]: `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\n`,
    [`crates/${name}/src/main.rs`]: 'fn main() {}\n',
  });
  const all = {
    'Cargo.toml': '[workspace]\nmembers = ["crates/deep-hook", "crates/deep-show", "crates/deep-other"]\nresolver = "2"\n',
    ...crate('deep-hook'), ...crate('deep-show'), ...crate('deep-other'),
    ...files,
  };
  for (const [path, bytes] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  return dir;
}

// Row files. A hub-reaching one reaches the CLI through a helper it imports, as #27's redrafts do through world.ts; a
// plain one imports a helper that names neither package.
const hubRow = {
  'tests/acceptance/27/world.ts': "import { join } from 'node:path';\nexport const CLI = join(process.cwd(), 'packages', 'cli', 'dist', 'main.js');\nexport const setupHome = () => CLI;\n",
  'tests/acceptance/27/repeat.test.ts': "import { expect, it } from 'vitest';\nimport { setupHome } from './world.ts';\nit('#27.6e863673 repeats', () => { expect(setupHome()).toBeTruthy(); });\n",
};
const plainRows = {
  'tests/acceptance/111/helpers.ts': "export const revive = (text: string) => text.trim();\n",
  'tests/acceptance/111/revive.test.ts': "import { expect, it } from 'vitest';\nimport { revive } from './helpers.ts';\nit('#111.ddf55f68 revives', () => { expect(revive(' a ')).toBe('a'); });\n",
  'tests/acceptance/112/other.test.ts': "import { expect, it } from 'vitest';\nit('#112.00000001 adds', () => { expect(1 + 1).toBe(2); });\n",
};

/**
 * A meta-test shaped as tests/acceptance/3178/suites.test.ts is: it names each row's file as a string in ROWS, imports
 * nothing from them, and runs them through `node_modules/vitest/vitest.mjs run` in a child process. It names neither the
 * hub's nor the CLI's package itself.
 */
const metaTest = (files) => `import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VITEST = join(REPO, 'node_modules/vitest/vitest.mjs');
const ROWS: { suite: string; file: string }[] = [
${files.map((file) => `  { suite: '${file.split('/')[2]}', file: '${file}' },`).join('\n')}
];

function runFiles(files: readonly string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VITEST, 'run', ...files, '--reporter=json'], { cwd: REPO, stdio: 'ignore' });
    child.on('close', resolve);
  });
}

for (const row of ROWS) it(\`#9000.aaaaaaaa \${row.file} passes\`, async () => { expect(await runFiles([row.file])).toBe(0); });
`;

const META = 'tests/acceptance/9000/suites.test.ts';

test('#3293.0c0bfd7c a 3178-shaped meta-test whose ROWS name a hub-reaching test file, run through vitest.mjs run, gets deep-hook and deep-show and is in hub', (t) => {
  const dir = repo(t, { ...hubRow, ...plainRows, [META]: metaTest(['tests/acceptance/111/revive.test.ts', 'tests/acceptance/27/repeat.test.ts']) });
  // The row file itself reaches the hub, as on main (#27's repeat.test.ts does in the issue's listing).
  assert.deepEqual(selectBinaries(dir, ['tests/acceptance/27/repeat.test.ts']).target, HUB, 'fixture: the row file reaches the hub');
  const selected = selectBinaries(dir, [META]);
  assert.deepEqual(selected.target, HUB);
  assert.ok(selected.hub.includes(META), `hub holds the meta-test: ${JSON.stringify(selected.hub)}`);
});

test('#3293.0c0bfd7c a node:test file that names a hub-reaching test file in its own vitest.mjs run arguments gets deep-hook and deep-show and is in hub', (t) => {
  const meta = 'tests/acceptance/9001/child.test.mjs';
  const dir = repo(t, {
    ...hubRow,
    [meta]: "import { spawnSync } from 'node:child_process';\nimport test from 'node:test';\nconst VITEST = 'node_modules/vitest/vitest.mjs';\ntest('#9001.bbbbbbbb child run', () => { spawnSync(process.execPath, [VITEST, 'run', 'tests/acceptance/27/repeat.test.ts']); });\n",
  });
  const selected = selectBinaries(dir, [meta]);
  assert.deepEqual(selected.target, HUB);
  assert.ok(selected.hub.includes(meta), `hub holds the meta-test: ${JSON.stringify(selected.hub)}`);
});

test('#3293.da71fe1c a 3178-shaped meta-test whose ROWS name only test files reaching neither package gets no hub binaries, though a hub-reaching test sits beside them', (t) => {
  const dir = repo(t, {
    ...plainRows,
    // Beside the named rows, not named by the meta-test: one in the same folder as a named row, one in another suite.
    'tests/acceptance/111/hub.test.ts': "import { expect, it } from 'vitest';\nit('#111.ffffffff hub', () => { expect('packages/hub/src/core.ts').toBeTruthy(); });\n",
    ...hubRow,
    [META]: metaTest(['tests/acceptance/111/revive.test.ts', 'tests/acceptance/112/other.test.ts']),
  });
  // Fixture controls: the unnamed neighbours do reach the hub, the named rows don't.
  assert.deepEqual(selectBinaries(dir, ['tests/acceptance/111/hub.test.ts']).target, HUB, 'fixture: the unnamed neighbour reaches the hub');
  assert.deepEqual(selectBinaries(dir, ['tests/acceptance/111/revive.test.ts', 'tests/acceptance/112/other.test.ts']).target, [], 'fixture: the named rows reach neither package');
  const selected = selectBinaries(dir, [META]);
  assert.deepEqual(selected.target, []);
  assert.deepEqual(selected.hub, []);
});

test('#3293.5e7eda0a this checkout\'s tests/acceptance/3178/suites.test.ts gets deep-hook and deep-show and is in hub, as the before lane selects it', () => {
  const file = 'tests/acceptance/3178/suites.test.ts';
  const selected = selectBinaries(REPO, [file]);
  assert.deepEqual(selected.target, HUB);
  assert.ok(selected.hub.includes(file), `hub holds ${file}: ${JSON.stringify(selected.hub)}`);
});
