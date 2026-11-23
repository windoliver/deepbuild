// #1837.78b8f3bb, second part: each event kind the Scope names is in the event catalogue, so the catalogue drift lane,
// run over the checkout's design docs and a fixed open-issue list, names none of them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KINDS, catalogueKinds, makeFixture, naming, runLane } from './helpers.mjs';

test(`#1837.78b8f3bb each event kind named in the Scope is in the event catalogue: ${KINDS.join(', ')}`, (t) => {
  const { repo } = makeFixture(t);
  const kinds = catalogueKinds(repo);
  assert.ok(kinds.size > 0, 'the catalogue is empty');
  assert.deepEqual(KINDS.filter((kind) => !kinds.has(kind)), [], 'the catalogue lacks these Scope kinds');
});

test('#1837.78b8f3bb the catalogue drift lane passes over the design docs and a fixed open-issue list, naming none of the Scope kinds', (t) => {
  const run = runLane(t);
  assert.deepEqual(run.verdicts, ['PASS'], `the lane's verdict over the checkout's design docs and a clean open-issue list is PASS:\n${run.output}`);
  assert.equal(run.status, 0, `runLanes didn't return 0:\n${run.output}`);
  for (const kind of KINDS) assert.deepEqual(naming(run, kind), [], `the lane names ${kind}:\n${run.output}`);
});
