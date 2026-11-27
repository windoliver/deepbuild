// Criterion 1 of #3402: each of #1352's five criteria is held by a test that passes on the change: the four failing
// today at the finder and the Decided count pass in their redrafted form, and the two passing today still pass. On the
// merge base the four originals fail with the messages the issue gives. What is said of the merge base is judged on
// the design and the record as the base commit holds them, read through git; what must stay true is judged on this
// checkout (README.md, AC1). The threats test, the seventh, is criterion 4's (ac4-threats.test.mjs); #1352's criterion
// 4 has only a live test, which no lane runs (README.md, Not tested).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORIGINAL, REDRAFT, baseMissing, firstDraftsOnBase, oldBaseMissing, runFiles, sha256Of, shown } from './helpers.mjs';

// #1352's criteria by their tags, as tests/acceptance/1352/README.md lists them.
const C1 = '#1352.4c4e63a7', C2 = '#1352.7a887cd4', C3 = '#1352.fbaaa304', C5 = '#1352.28fd1eed';
const outcome = (t) => (t.skipped ? 'skipped' : t.passed ? 'passed' : 'failed');
const tagOf = (name) => name.match(/^#\d+\.[0-9a-f]{8}/)?.[0] ?? name;

// The first-draft files this test runs, as the base commit holds them (`shasum -a 256`): they stay as they are.
const FIRST_DRAFTS = {
  [`${ORIGINAL}ac1-section.test.mjs`]: '2de167aa376e584ace92c7cddd8090a21b0aed5df87ff8b28fc89c1d4cf926e4',
  [`${ORIGINAL}ac3-agent-routes.test.mjs`]: 'c2dcd65240432c80c7a8cb3ca0ce2012658ccf81d65e08547057cadd3f7bef9c',
  [`${ORIGINAL}ac5-taste-call.test.mjs`]: 'c1aec11c1d366b11baddee8ea6271735fac735936f5cd2d3060b7d75aa43bce2',
  [`${ORIGINAL}helpers.mjs`]: '43af4c0b4d24bf61720bbba28a01d5b6ec228900bee6f2ec944d486f7e8f4cdf',
};
// The issue's table, Fails with. The issue, written on an earlier main, gives the Decided count as 112 rows; the base
// commit's `### Decided` holds 99, so there the message reads 99. The rest of each message is the issue's.
const FINDER = 'more than one heading holds "hub" and "cloud" or "hosted": "A hub of your own in the cloud, for someone with no computer", "Decided for a hosted hub"';
const GAINED_NONE = 'the Decided table has 99 rows, and had 112 at 6aa228ce: it gained none';
const STARTS = [`${C1} criterion 1: the design holds one section`, `${C1} criterion 1: the Decided table has more rows than at 6aa228ce`, `${C3} criterion 3:`, `${C5} criterion 5:`];

test('#3402.bc48ab1e the four #1352 tests that fail on the merge base\'s design with the messages the issue gives, three at the finder naming both headings and one at the Decided count, pass in their redrafted form on this checkout, each under its own #1352 tag', (t) => {
  const missing = baseMissing() ?? oldBaseMissing();
  if (missing) return t.skip(missing);
  // On the merge base: the first-draft files, as they are, on the base commit's design and record.
  assert.deepEqual(Object.fromEntries(Object.keys(FIRST_DRAFTS).map((path) => [path, sha256Of(path)])), FIRST_DRAFTS, 'the first-draft files are not as main holds them');
  const first = firstDraftsOnBase(['ac1-section.test.mjs', 'ac3-agent-routes.test.mjs', 'ac5-taste-call.test.mjs']);
  const failures = first.tests.map((r) => [STARTS.find((start) => r.name.startsWith(start)) ?? r.name, outcome(r), r.message ?? '']).sort();
  assert.deepEqual(failures, [[STARTS[0], 'failed', FINDER], [STARTS[1], 'failed', GAINED_NONE], [STARTS[2], 'failed', FINDER], [STARTS[3], 'failed', FINDER]].sort(),
    `on the merge base's design the four first-draft tests did not fail with the issue's messages:\n${shown(first.tests)}\n${first.stderr}`);
  // On this checkout: the redraft's files, as they are.
  const { tests, stderr } = runFiles(['ac1-section', 'ac3-agent-routes', 'ac5-taste-call'].map((name) => `${REDRAFT}${name}.test.mjs`));
  const results = tests.map((r) => `${tagOf(r.name)} ${outcome(r)}`).sort();
  assert.deepEqual(results, [`${C1} passed`, `${C1} passed`, `${C3} passed`, `${C5} passed`].sort(), `the redraft's tests did not all pass on this checkout:\n${shown(tests)}\n${stderr}`);
});

test('#3402.bc48ab1e the two #1352 tests that pass today still pass, in the first draft\'s file as it is: the search for the old wording, and the privacy section', (t) => {
  const missing = oldBaseMissing();
  if (missing) return t.skip(missing);
  const { tests, stderr } = runFiles([`${ORIGINAL}ac2-privacy-threats.test.mjs`]);
  const two = [`${C2} criterion 2: a search of docs/ and README.md`, `${C2} criterion 2: the privacy section is changed`]
    .map((start) => [start, tests.filter((r) => r.name.startsWith(start)).map(outcome)]);
  assert.deepEqual(two, [[`${C2} criterion 2: a search of docs/ and README.md`, ['passed']], [`${C2} criterion 2: the privacy section is changed`, ['passed']]],
    `the two tests did not both pass:\n${shown(tests)}\n${stderr}`);
});
