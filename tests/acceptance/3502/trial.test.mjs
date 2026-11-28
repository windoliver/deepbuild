// #3502, ninth criterion: the Rebase trial names the versions moved to, the result of each suite it lists, and the
// outcome; a trial with a suite unrun leaves this open (README: The Rebase trial).
//
// The record's words are an agent's, so what the tree can answer is held against the tree: the versions against the
// manifests and Cargo.lock, the outcome against whether they moved, and the suites it must list against the rows
// the moved trees still carry. Whether each suite passes is rows.test.mjs's run, and #1426's own record test's.
// Run: node --test tests/acceptance/3502/trial.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocked, carriedRows, read, REPO, TABLE } from './common.mjs';
import { HEADING, judgeTrial, NAMED, pinsAt } from './trial.mjs';

test('AC9 #3502.16dea0e8 the Rebase trial names the versions moved to, as the tree holds them, a result for each suite it lists, and the outcome', () => {
  const text = read(REPO, TABLE);
  const rows = carriedRows(text);
  if (!rows) blocked(`${TABLE} holds no carried-patch table under "## Carried patches"`);
  assert.deepEqual(judgeTrial(text, pinsAt(REPO), rows), []);
});

// Made-up records over a made-up tree: three trees moved from 1.2.3 to 1.2.5, the toolkit from 0.4.0 to 0.5.0, and
// two rows still carried in them.
const PINS = { 'gpui-pre': '1.2.5', 'gpui-pre-apple': '1.2.5', 'gpui-pre-macos': '1.2.5', 'gpui-kit': '0.5.0' };
const ROWS = [
  { behavior: 'A carried surface', issue: '#901', files: ['vendor/gpui-pre-apple/src/metal_renderer.rs'] },
  { behavior: 'A carried hook', issue: '#902', files: ['vendor/gpui-pre-macos/src/window.rs'] },
  { behavior: 'Another crate', issue: '#903', files: ['vendor/accesskit_macos/src/node.rs'] },
];
const SUITES = [...NAMED, '#901', '#902'];
const record = ({ tried = 'gpui-pre 1.2.3 -> 1.2.5, gpui-pre-apple 1.2.3 -> 1.2.5, gpui-pre-macos 1.2.3 -> 1.2.5, gpui-kit 0.4.0 -> 0.5.0', outcome = 'Outcome: pin moved', results = {} } = {}) =>
  `# The patches\n\n${HEADING}\n\nTried: ${tried}\n${outcome}\n\n| Suite | Result |\n|---|---|\n${SUITES.filter((suite) => results[suite] !== null).map((suite) => `| ${suite} | ${results[suite] ?? 'pass'} |`).join('\n')}\n\n## What was offered\n`;

test('AC9 #3502.16dea0e8 a trial with a suite unrun leaves this open: a suite not run, a carried row\'s suite unlisted, a version the tree doesn\'t hold or no outcome each fail, naming it', () => {
  assert.deepEqual(judgeTrial(record(), PINS, ROWS), [], 'a whole record passes');
  const fails = (text, pattern) => assert.match(judgeTrial(text, PINS, ROWS).join('\n'), pattern);
  fails(record({ results: { '#391': 'not run' } }), /^the suite #391 reads "not run": a trial with a suite unrun leaves this open$/m);
  fails(record({ results: { '#901': '' } }), /^the suite #901 reads "nothing": a trial with a suite unrun leaves this open$/m);
  fails(record({ results: { '#902': null } }), /^the record lists no result for the suite #902, whose row #902 A carried hook the moved trees still carry/m);
  fails(record({ results: { '#140': null } }), /^the record lists no result for the suite #140, which #1426 names for a moved pin$/m);
  fails(record({ results: { '#377': 'fail: the handoff reads black' } }), /^the pin moved and the suite #377 reads "fail: the handoff reads black"$/m);
  fails(record({ results: { '#390': 'fine' } }), /^the suite #390 reads "fine", which is no result/m);
  fails(record({ tried: 'gpui-pre 1.2.3 -> 1.2.5, gpui-pre-apple 1.2.3 -> 1.2.5, gpui-kit 0.4.0 -> 0.5.0' }), /^the record's Tried line names no version gpui-pre-macos moved to$/m);
  fails(record({ tried: 'gpui-pre 1.2.3 -> 1.2.4, gpui-pre-apple 1.2.3 -> 1.2.5, gpui-pre-macos 1.2.3 -> 1.2.5, gpui-kit 0.4.0 -> 0.5.0' }), /^the record says gpui-pre moved to 1\.2\.4, and the tree holds 1\.2\.5$/m);
  fails(record({ outcome: '' }), /^the record names no outcome: it has no Outcome line$/m);
  fails(record({ outcome: 'Outcome: pin left' }), /^the record ends "Outcome: pin left", and the tree holds gpui-pre 1\.2\.5/m);
  assert.match(judgeTrial('# The patches\n', PINS, ROWS).join('\n'), /the trial has no record, which leaves this open/);
});
