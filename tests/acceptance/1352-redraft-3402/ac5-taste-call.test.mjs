// Criterion 5 of #1352, redrafted blind for #3402: one taste call on the text, by any one person on the project; the
// others are told and can overrule it. Code can't judge the text, so this checks only the record of the call, as the
// first draft does: it exists, names this criterion and a person, says the text reads right, is bound by SHA-256 to the
// section's text as it is now, and says the others were told and can overrule it. The section is found by its anchor,
// `cloud-hub`; its text is the first draft's: from the heading up to and without the closing blank and `<a id>` lines
// (README.md). Offline: it reads docs/technical-design.md and docs/evidence/1352/taste-call.json in this checkout.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, RECORD, readDesign, tasteCallCheck } from './helpers.mjs';

test("#1352.28fd1eed criterion 5 (redraft): docs/evidence/1352/taste-call.json records one person's taste call that the section anchored cloud-hub reads right, bound to its current text, with the others told and able to overrule it", () => {
  const path = join(CHECKOUT, RECORD);
  const { sha256, problems } = tasteCallCheck(readDesign(), existsSync(path) ? readFileSync(path, 'utf8') : null);
  // No message of its own, so the failure prints each problem: no section, no record, or the field that is wrong.
  assert.deepEqual(problems, []);
  assert.match(sha256 ?? '', /^[0-9a-f]{64}$/, 'the section\'s text has no SHA-256');
});
