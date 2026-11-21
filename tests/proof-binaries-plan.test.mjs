// #2820: a test's own `cargo build --bin <variable>` is built before the test grant once for each workspace binary the
// test's source names by its own name (docs/parallel-proof.md, section 5), never for every binary of a package whose
// name the source writes, which would build, and could BLOCK on, binaries the test never runs.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { binaryPlan } from '../scripts/proof-binaries.mjs';

test('a --bin whose name is a variable is filled with the binaries the test names, not every binary of the package it names', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-plan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = {
    'Cargo.toml': '[workspace]\nmembers = ["tool"]\nresolver = "2"\n',
    'tool/Cargo.toml': '[package]\nname = "tool"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n\n[[bin]]\nname = "alpha"\npath = "src/alpha.rs"\n\n[[bin]]\nname = "beta"\npath = "src/beta.rs"\n',
    'tool/src/alpha.rs': 'fn main() {}\n',
    'tool/src/beta.rs': 'fn main() {}\n',
    'tests/uses-alpha.test.mjs': `import { spawnSync } from 'node:child_process';
const bin = 'alpha';
spawnSync('cargo', ['build', '--locked', '-p', 'tool', '--bin', bin], { encoding: 'utf8' });
`,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const { builds } = binaryPlan(dir, ['tests/uses-alpha.test.mjs']);
  assert.deepEqual(builds.map(({ args }) => args), [['--locked', '-p', 'tool', '--bin', 'alpha']]);
});
