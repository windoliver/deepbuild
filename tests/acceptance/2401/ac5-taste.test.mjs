// #2401 AC5: "One taste call on the write-up, by you". This test judges nothing. It reads the owner's call, recorded in
// tests/acceptance/2401/TASTE.json (README: The taste call), on exactly the write-up and the record it reports.
// No write-up is BLOCKED; no call, or a call on other files, is INCONCLUSIVE; looks_wrong fails; never PASS without one.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AC, RECORD, TASTE, WRITE_UP, iso, loadRecord, obj, readText, root, sha256 } from './helpers.mjs';

test(`${AC[5]} the owner's taste call on exactly this write-up and record says it looks right; with none it reads INCONCLUSIVE, never PASS`, () => {
  loadRecord();
  readText(WRITE_UP, "the spike's write-up");
  const files = Object.fromEntries([WRITE_UP, RECORD].map((f) => [f, sha256(readFileSync(join(root, f)))]));
  const listed = Object.entries(files).map(([f, h]) => `  ${f}  ${h}`).join('\n');
  if (!existsSync(join(root, TASTE))) throw new Error(`INCONCLUSIVE: no taste call is recorded: show the owner\n${listed}\nand record the answer in ${TASTE} (tests/acceptance/2401/README.md: The taste call)`);
  let c;
  try {
    c = JSON.parse(readFileSync(join(root, TASTE), 'utf8'));
  } catch (e) {
    assert.fail(`${TASTE} is not JSON: ${e.message}`);
  }
  assert.ok(obj(c), `${TASTE} is an object`);
  assert.equal(c.issue, 2401, `${TASTE}: issue`);
  assert.equal(c.criterion, AC[5], `${TASTE}: criterion`);
  assert.ok(['looks_right', 'looks_wrong'].includes(c.verdict), `${TASTE}: verdict is looks_right or looks_wrong: ${JSON.stringify(c.verdict)}`);
  if (typeof c.who !== 'string' || !c.who.trim() || !iso(c.when)) throw new Error(`INCONCLUSIVE: ${TASTE} names no one or no ISO 8601 time`);
  assert.ok(obj(c.files), `${TASTE}: files, by path`);
  assert.deepEqual(Object.keys(c.files).sort(), Object.keys(files).sort(), `${TASTE} names the write-up and the record`);
  const other = Object.keys(files).filter((f) => c.files[f] !== files[f]);
  if (other.length) throw new Error(`INCONCLUSIVE: the recorded call (${c.who}, ${c.when}) was made on other files: ${other.map((f) => `${f} recorded ${c.files[f]}, on disk ${files[f]}`).join('; ')}`);
  if (c.verdict === 'looks_wrong') assert.fail(`the owner's taste call (${c.who}, ${c.when}) says the write-up doesn't look right${typeof c.note === 'string' ? `: ${c.note}` : ''}`);
});
