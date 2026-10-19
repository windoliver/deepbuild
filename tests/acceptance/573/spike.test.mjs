// Acceptance tests for issue #573, the definition-drafting spike, on its public record alone
// (docs/spikes/573/record.json) and this repo's own history. Nothing runs a model.
// Run: node --test tests/acceptance/573/spike.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  draftingDecisionProblems, goalStepsDecisionProblems, loadRecord, publicCommitProblems, readingProblems, structureProblems, uiProblems,
} from './validate.mjs';

const DRAFTED = '#573.01642c85';
const READINGS = '#573.4b1e1e2b';
const DECISION = '#573.1e6abfca';
const GOAL_STEPS = '#573.0753f49f';

const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);

test(`${DRAFTED} 20 closed issues from this repo and the pilot repos each get one counted draft, and every other run is discarded and named with why`, () => {
  holds(structureProblems(loadRecord()));
});

test(`${DRAFTED} this repo's issues name a base and a merged fix that are in this repo, the base before the fix`, () => {
  const record = loadRecord();
  holds(structureProblems(record));
  holds(publicCommitProblems(record));
});

test(`${READINGS} each issue's criteria coverage and drafted checks are readings, recomputed from its counted draft: shares over every drafted check, drops for passing on the base and for failing elsewhere counted apart`, () => {
  holds(readingProblems(loadRecord(), ['coverage:', 'checks:']));
});

test(`${DECISION} the decision names what week 5's drafting job changes, or says it stands, citing readings the record holds`, () => {
  holds(draftingDecisionProblems(loadRecord()));
});

test(`${GOAL_STEPS} five UI issues are each drafted twice, with goal steps and without`, () => {
  holds(uiProblems(loadRecord()));
});

test(`${GOAL_STEPS} each UI issue's share of drafted journeys that fail on the base on a named assertion and pass on the fix is a reading, with goal steps and without`, () => {
  holds(readingProblems(loadRecord(), ['journeys:']));
});

test(`${GOAL_STEPS} the decision says whether week 5 builds goal steps (#581), citing the journeys readings with and without them`, () => {
  holds(goalStepsDecisionProblems(loadRecord()));
});
