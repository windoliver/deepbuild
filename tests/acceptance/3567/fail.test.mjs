// #3567, criterion 3: a FAIL read before the bound is in the summary as FAIL, and the run's exit is a FAIL's. A planted
// run that ends INCONCLUSIVE alone fails, naming the test. The failing file is the parallel block's only one, so its
// job has ended, and its failure is read, before the alone block's file starts; that one never ends, so only the bound
// ends the run.
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, BOUND_MIN, BOUND_MS, BOUNDED, dump, expectEnded, FAILING, failing, noted, sandbox, stuck, tree } from './helpers.mjs';

const FAIL = 'tests/fixture-3567-fail.test.mjs';
const LANE = 'tests/acceptance/900003567/lane.json';
const STUCK = 'tests/acceptance/900003567/stuck.test.mjs';

test('#3567.02b8eb33 a FAIL read before the bound is in the summary as FAIL, and the run exits as it does for a FAIL, with 1', BOUNDED, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, {
    [FAIL]: failing(box),
    [LANE]: `${JSON.stringify({ alone: true, why: 'timing: a fixture of #3567, whose file must start after the parallel block' })}\n`,
    [STUCK]: stuck(box),
  });
  const run = await affected(box, fixture, [FAIL, STUCK], { env: { DEEP_AFFECTED_MIN: String(BOUND_MIN) } });
  const all = () => dump(box, run);
  const id = `${FAIL} › ${FAILING}`;

  const failed = noted(box).find(({ role }) => role === 'failing');
  assert.ok(failed && failed.at < run.began + BOUND_MS, `the test ${id} didn't fail within the run's ${BOUND_MIN * 60} s bound on this machine, so this run proves nothing about a FAIL read before it\n${all()}`);
  expectEnded(box, run, { state: 'FAIL', what: `though the test ${id} failed ${((failed.at - run.began) / 1000).toFixed(1)} s after the run's start, before its bound` });
  const lines = run.stdout.split('\n').filter((line) => /^(?:NEW )?FAIL\b/.test(line) && line.includes(FAIL) && line.includes(FAILING));
  assert.ok(lines.length, `no FAIL line names the test ${id}, which failed before the bound\n${all()}`);
});
