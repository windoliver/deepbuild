// Criterion 4 of #3402: the threats test passes unchanged on the change, and on the merge base it fails, naming the
// row for another machine's connection. "Unchanged" is held by the SHA-256 of #1352's first-draft file and of the
// helpers it imports, as the base holds them; the test is then run as it is, as a child with `node --test` in this
// checkout. When it fails, this test's own assertion shows the rows its failure names (README.md, AC4).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORIGINAL, oldBaseMissing, runFiles, sha256Of, shown } from './helpers.mjs';

// The two files at the base commit c60215952 (`shasum -a 256`).
const UNCHANGED = {
  [`${ORIGINAL}ac2-privacy-threats.test.mjs`]: '955ef90bf72aac9e44136fb6193b25883539b31252e19181b9e35dd3df60cdb6',
  [`${ORIGINAL}helpers.mjs`]: '43af4c0b4d24bf61720bbba28a01d5b6ec228900bee6f2ec944d486f7e8f4cdf',
};
const THREATS = '#1352.7a887cd4 criterion 2: the threats table has a row in which a web client reaches only the person\'s own hub';

test('#3402.131135a1 #1352\'s threats test, its file and helpers byte for byte as main holds them, passes: no row of the threats table refuses browsers without naming the web client, the row for another machine\'s connection included', (t) => {
  assert.deepEqual(Object.fromEntries(Object.keys(UNCHANGED).map((path) => [path, sha256Of(path)])), UNCHANGED, 'the threats test is not unchanged: its file or its helpers differ from main\'s');
  const missing = oldBaseMissing();
  if (missing) return t.skip(missing);
  const { tests, stderr } = runFiles([`${ORIGINAL}ac2-privacy-threats.test.mjs`]);
  const threats = tests.filter((r) => r.name.startsWith(THREATS));
  assert.equal(threats.length, 1, `the file's run reported the threats test ${threats.length} times:\n${shown(tests)}\n${stderr}`);
  // The first draft's failure holds each refusing row, cut to 300 characters; a row is named by its first cell.
  const rows = (threats[0].actual ?? []).map((row) => row.split('|')[1]?.trim() ?? row);
  assert.deepEqual(rows, [], `the threats test fails, naming these rows of the threats table: ${threats[0].message}`);
  assert.ok(threats[0].passed && !threats[0].skipped, `the threats test did not pass:\n${shown(threats)}\n${stderr}`);
});
