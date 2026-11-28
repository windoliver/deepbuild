import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC1, TABLE, cargoCheck, carriedRows, judgeRun, judgeVendorCheck, pristineReleases, redact, repoRoot, runVendorCheck, scratchWorkspace, touchedFastFiles } from './vendored.mjs';

test(`AC1 ${AC1} cargo check -p gpui-fast -p gpui-fast-apple -p gpui-fast-macos --all-targets passes on the vendored 0.1.19 trees with default and test-support features enabled`, { timeout: 60 * 60_000 }, () => {
  const work = scratchWorkspace(repoRoot);
  const run = cargoCheck(work);
  console.log(`# ${run.tail.split('\n')[0]}`);
  assert.deepEqual(judgeRun(run, work).map(redact), []);
});

test(`AC1 ${AC1} node scripts/vendor-rebase.mjs check passes on every touched src/fast/ file of the three vendored trees`, { timeout: 40 * 60_000 }, async () => {
  const touched = touchedFastFiles(repoRoot, await pristineReleases());
  console.log(`# touched src/fast/ files: ${touched.length}`);
  const { status, out } = runVendorCheck(repoRoot);
  console.log(`# check exit ${status}`);
  assert.deepEqual(judgeVendorCheck(out, touched, carriedRows(readFileSync(join(repoRoot, TABLE), 'utf8'))).map(redact), []);
});
