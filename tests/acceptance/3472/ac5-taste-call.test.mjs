// Criterion 5: one taste call on the text and the sentences, recorded. Offline: it reads the record,
// docs/evidence/3472/taste-call.json, and docs/technical-design.md here and at the base commit. Code can't make the
// call, so this checks only its record (README.md, The taste call): it names this criterion, a person and a time, says
// the text reads right, and names by SHA-256 the sentences and table cells it judged. Each has to be in the design
// still, so the call can't outlive an edit to what it judged, and together they have to hold the decisions, each state
// word and the plain-words line, so a call on part of the text isn't a call on the text.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECORD, fileHere, judgeCall, read } from './helpers.mjs';

const ID = '#3472.822bbdc5';
const CRITERION = `AC5 ${ID}`;

test(`${CRITERION} ${RECORD} records one person's call that the text reads right, naming by SHA-256 the sentences and table cells it judged: all still in the design, and holding the decisions, each state word and the plain-words line`, () => {
  const record = fileHere(RECORD);
  let call = null;
  if (record !== null) {
    try {
      call = JSON.parse(record);
    } catch (error) {
      assert.fail(`${RECORD} isn't JSON: ${error.message}`);
    }
    assert.ok(call !== null, `${RECORD} holds null, not a record`);
  }
  assert.deepEqual(judgeCall(call, read(), ID), [], 'no taste call on the text and the sentences as they are now is recorded');
});
