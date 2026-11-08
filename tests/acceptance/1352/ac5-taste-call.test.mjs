// Criterion 5: one taste call on the text, by any one person on the project; the others are told and can overrule it.
// Code can't judge the text, so this checks only the record of the call (README.md, The taste call): it exists, names
// this criterion and a person, says the text reads right, is bound by SHA-256 to the section's text as it is now (so a
// call can't outlive an edit), and says the others were told and can overrule it. Offline.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, DESIGN, NO_SECTION, findSection, readDesign, sectionSha256 } from './helpers.mjs';

const RECORD = 'docs/evidence/1352/taste-call.json';
const CRITERION = '#1352.28fd1eed';

test(`${CRITERION} criterion 5: ${RECORD} records one person's taste call that the new section reads right, bound to its current text, with the others told and able to overrule it`, () => {
  const section = findSection(readDesign());
  assert.ok(section, NO_SECTION);
  const path = join(CHECKOUT, RECORD);
  assert.ok(existsSync(path), `no taste call is recorded: ${RECORD} doesn't exist`);
  const call = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(call.criterion, CRITERION, `${RECORD} names criterion ${call.criterion}`);
  assert.ok(typeof call.who === 'string' && call.who.trim(), `${RECORD} names no person in "who"`);
  assert.ok(typeof call.when === 'string' && !Number.isNaN(Date.parse(call.when)), `${RECORD} has no ISO 8601 time in "when"`);
  assert.equal(call.call, 'reads_right', `${RECORD}'s call is ${JSON.stringify(call.call)}, not "reads_right"`);
  assert.equal(call.text?.file, DESIGN, `${RECORD}'s text.file isn't ${DESIGN}`);
  assert.ok(section.anchors.includes(call.text?.anchor), `${RECORD}'s text.anchor ${JSON.stringify(call.text?.anchor)} isn't one of the section's anchors (${section.anchors.join(', ')})`);
  assert.equal(call.text?.sha256, sectionSha256(section), `${RECORD}'s text.sha256 isn't the section's text as it is now: the call was made on other text`);
  assert.ok(/\btold\b/i.test(call.note ?? '') && /\boverrul/i.test(call.note ?? ''), `${RECORD}'s note doesn't say the others on the project are told and can overrule the call`);
});
