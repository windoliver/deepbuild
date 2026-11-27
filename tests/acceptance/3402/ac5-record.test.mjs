// Criterion 5 of #3402: #1352's criterion 5 test passes, with docs/evidence/1352/taste-call.json byte for byte as main
// holds it. A redraft that passes only with a new record fails this test. "As main holds it" is the record at the base
// commit, read through git and held by its SHA-256: criterion 5's redrafted check must pass on main's design with
// main's record, so a redraft that needs a new record fails here. On this checkout, the redrafted test passes with the
// record the checkout holds, and while the section's text is still main's, that record is main's, byte for byte
// (README.md, AC5).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANCHOR, findSection, readDesign, sectionSha256, tasteCallCheck } from '../1352-redraft-3402/helpers.mjs';
import { DESIGN, RECORD, REDRAFT, baseBytes, baseMissing, runFiles, sha256, sha256Of, shown } from './helpers.mjs';

// docs/evidence/1352/taste-call.json at the base commit c60215952 (`shasum -a 256`): 1,000 bytes.
const AS_MAIN_HOLDS_IT = '64a443bae2f045cd18e5f0158c157f71411ca2ad94d29b6751833caf2a6d2595';
const fields = (problems) => problems.map((problem) => problem.match(/taste-call\.json(?:'s)? (text\.sha256|[\w.]+)/)?.[1] ?? problem);

test('#3402.a95fc369 criterion 5\'s redrafted check passes on main\'s design with the record byte for byte as main holds it, and criterion 5\'s redrafted test passes on this checkout with the record the checkout holds', (t) => {
  const missing = baseMissing();
  if (missing) return t.skip(missing);
  const record = baseBytes(RECORD);
  assert.equal(sha256(record), AS_MAIN_HOLDS_IT, `${RECORD} at the base commit is not the record this test was drafted on`);
  // No new record: the redraft's finder returns, on main's design, the text main's record was made on.
  assert.deepEqual(tasteCallCheck(baseBytes(DESIGN).toString('utf8'), record.toString('utf8')).problems, []);
  const { tests, stderr } = runFiles([`${REDRAFT}ac5-taste-call.test.mjs`]);
  assert.deepEqual(tests.map((r) => `${r.name.match(/^#\d+\.[0-9a-f]{8}/)?.[0] ?? r.name} ${r.skipped ? 'skipped' : r.passed ? 'passed' : 'failed'}`), ['#1352.28fd1eed passed'], `criterion 5's redrafted test did not pass on this checkout:\n${shown(tests)}\n${stderr}`);
});

// A planted finder that takes the section from its anchor line, not from its heading: the same section by other text.
function findFromAnchorLine(text) {
  const found = findSection(text);
  return found.section ? { section: { ...found.section, body: `<a id="${ANCHOR}"></a>\n\n${found.section.body}` } } : found;
}

test('#3402.a95fc369 a planted finder that returns other text for the section fails criterion 5\'s check on main\'s design with main\'s record, at the text\'s SHA-256 alone, so it would pass only with a new record; and while this checkout\'s section is main\'s text, its record is main\'s, byte for byte', (t) => {
  const missing = baseMissing();
  if (missing) return t.skip(missing);
  const main = baseBytes(DESIGN).toString('utf8'), record = baseBytes(RECORD).toString('utf8');
  assert.deepEqual(fields(tasteCallCheck(main, record, findFromAnchorLine).problems), ['text.sha256']);
  // This checkout: a section edited since needs a new call and so a new record; an unedited one keeps main's.
  const here = findSection(readDesign()).section, there = findSection(main).section;
  assert.ok(here, `this checkout's design has no section anchored ${ANCHOR}`);
  const held = sha256Of(RECORD);
  assert.equal(sectionSha256(here) === sectionSha256(there) ? held : AS_MAIN_HOLDS_IT, AS_MAIN_HOLDS_IT, `the section's text is main's, but ${RECORD} is not the record main holds: a new record, or none`);
});
