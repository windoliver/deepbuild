import assert from 'node:assert/strict';
import test from 'node:test';
import { AC, checkVendoredTrees, copyTrees, judgeCheck, redact, releases, runCheck } from './support.mjs';

test(`AC1 ${AC[1]} cargo check -p gpui-fast -p gpui-fast-apple -p gpui-fast-macos --all-targets passes on the vendored 0.1.19 trees with default features and with test-support`, { timeout: 120 * 60_000 }, () => {
  assert.deepEqual(checkVendoredTrees(copyTrees()), []);
});

test(`AC1 ${AC[1]} node scripts/vendor-rebase.mjs check passes on every touched src/fast/ file of the vendored 0.1.19 trees`, { timeout: 30 * 60_000 }, async () => {
  const trees = copyTrees();
  const run = runCheck(trees, await releases());
  const refusals = run.out.split('\n').filter((line) => /^(?:FAIL|BLOCKED)\b/.test(line));
  console.log(`# vendor-rebase check exit ${run.status} in a copy holding only the three gpui-fast trees: ${refusals.length} FAIL or BLOCKED lines, read only where they name a src/fast/ file or block a gpui-fast tree; those naming a vendored gpui-fast file:`);
  console.log(redact(refusals.filter((line) => /vendor\/gpui-fast/.test(line)).map((line) => `#   ${line.slice(0, 200)}`).join('\n') || '#   none'));
  assert.deepEqual(judgeCheck(run.out), []);
});
