// Acceptance tests for issue #573 on the spike's private evidence: the pilot issues, the drafted
// definitions, their inputs and transcripts, and each drafted check's base and fix reports. The
// evidence lives outside this public repo; without it every test here fails BLOCKED.
// Run: DEEP_SPIKE_573_EVIDENCE=<folder> node --test tests/acceptance/573/spike.evidence.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkEvidenceProblems, criteriaProblems, evidenceDir, goalOfferProblems, issueEvidenceProblems, loadRecord, manifestProblems, privacyProblems,
} from './validate.mjs';

const DRAFTED = '#573.01642c85';
const READINGS = '#573.4b1e1e2b';
const GOAL_STEPS = '#573.0753f49f';

const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
// The evidence comes first, so a missing bundle is BLOCKED whatever the record holds.
const both = () => { const dir = evidenceDir(); return { dir, record: loadRecord() }; };
const issues = (record) => {
  assert.ok(Array.isArray(record?.issues) && record.issues.length, 'the record holds no issues');
  return record.issues;
};

test(`${DRAFTED} the private evidence is the bundle the public record hashes, every file listed by its hash, kept outside this repo`, () => {
  const { dir, record } = both();
  issues(record);
  holds(manifestProblems(dir, record));
});

test(`${DRAFTED} each run's recorded inputs are the issue and its base commit only; a run whose inputs hold the fix's diff or anything only the fix has, or whose transcript names the fix, isn't counted`, () => {
  const { dir, record } = both();
  holds(issues(record).flatMap((issue) => issueEvidenceProblems(dir, issue)));
});

test(`${DRAFTED} no pilot issue's repo, title or criteria is in this public repo`, () => {
  const { dir, record } = both();
  issues(record);
  holds(privacyProblems(dir, record));
});

test(`${READINGS} each issue's criteria are its own text's, every checkbox included`, () => {
  const { dir, record } = both();
  holds(issues(record).flatMap((issue) => criteriaProblems(dir, issue)));
});

test(`${READINGS} each drafted check's base and fix outcomes are what its reports show, failing on a named assertion as the design defines it, and no drafted check is left out`, () => {
  const { dir, record } = both();
  holds(issues(record).flatMap((issue) => checkEvidenceProblems(dir, issue, 'plain')));
});

test(`${GOAL_STEPS} each UI issue's goal-steps draft was offered goal steps: a prompt input its plain draft wasn't given`, () => {
  const { dir, record } = both();
  const ui = issues(record).filter((issue) => issue.ui === true);
  assert.ok(ui.length, 'the record holds no UI issues');
  holds(ui.flatMap((issue) => goalOfferProblems(dir, issue)));
});

test(`${GOAL_STEPS} each UI journey drafted with goal steps has the base and fix outcomes its reports show, and none is left out`, () => {
  const { dir, record } = both();
  const ui = issues(record).filter((issue) => issue.ui === true);
  assert.ok(ui.length, 'the record holds no UI issues');
  holds(ui.flatMap((issue) => checkEvidenceProblems(dir, issue, 'goal-steps')));
});
