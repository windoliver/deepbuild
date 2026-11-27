// AC3: #3445's docs/spikes/3445/, from PR #3505, passes the lane: added to main as a change, every line of it is read.
// The folder comes from the checkout when main already holds it, else from origin into the copy's own git. A folder
// that can't be had leaves the test failing as INCONCLUSIVE, never passing.
import assert from 'node:assert/strict';
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, SPIKE, baseList, commit, fetchSpike, laneEnv, makeCopy, readList, runLane, withhold } from './helpers.mjs';

const ID = '#3533.cc941d25';
const LISTS = [baseList(), readList(CHECKOUT)];
const show = (text) => withhold(text, LISTS);

test(`${ID} AC3: the lane passes on a change that adds #3445's ${SPIKE}/ to main`, (t) => {
  const { sandbox, repo } = makeCopy(t, { skip: [SPIKE] });
  commit(repo, 'Main without the spike', { base: true });
  let source;
  if (existsSync(join(CHECKOUT, SPIKE))) {
    // Main holds it already (#3505 merged): the checkout's copy is the one to read.
    source = { ref: 'the checkout' };
    cpSync(join(CHECKOUT, SPIKE), join(repo, SPIKE), { recursive: true });
  } else {
    source = fetchSpike(repo);
    assert.ok(!source.missing, `INCONCLUSIVE: ${source.missing}`);
  }
  assert.ok(existsSync(join(repo, SPIKE)), `INCONCLUSIVE: no ${SPIKE}/ came from ${source.ref}`);
  commit(repo, "Add the spike's report and record");

  const run = runLane(repo, laneEnv(sandbox));
  assert.ok(run.status === 0 && run.states[0] === 'PASS', `the lane doesn't pass on ${SPIKE}/ from ${source.ref} (exit ${run.status}, ${run.states.join(' ') || 'no verdict'}):\n${show(run.output)}`);
});
