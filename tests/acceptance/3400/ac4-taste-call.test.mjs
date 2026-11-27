// Criterion 4, the call: one taste call on the text, by any one person on the project. Code can't judge the text, so
// this reads only the record of the call (README.md, The taste call): it exists, names this criterion and a person,
// says the text reads right, and is bound by SHA-256 to the text as the design holds it now, so a call can't outlive
// an edit to a line it was made on. Offline. That the others are told is ac4-told.live.test.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECORD, callProblems, listed, readRecord, theText } from './helpers.mjs';

test("AC4 #3400.28fd1eed docs/evidence/3400/taste-call.json records one person's taste call that the text reads right, bound to the text as the design holds it now", () => {
  const record = readRecord();
  assert.ok(record.call, record.why);
  const problems = callProblems(record.call, theText());
  assert.ok(!problems.length, `${RECORD} isn't a call that the text, as it is now, reads right:${listed(problems)}`);
});
