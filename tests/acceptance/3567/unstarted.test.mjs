// #3567, criterion 2: a file not yet started at the bound is named as not started, and no test of it reads PASS. A
// planted run that counts it as passed fails, naming the file. The Scope adds that at the bound the run starts nothing
// more. The file waits in the alone block (its folder's own lane.json), which starts once the parallel block has
// ended; the parallel block's one file never ends.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { affected, BOUND_MIN, BOUNDED, dump, expectEnded, inconclusive, NOT_STARTED, noted, passedCount, sandbox, stateLines, stuck, tree, unstarted } from './helpers.mjs';

const STUCK = 'tests/fixture-3567-stuck.test.mjs';
const LANE = 'tests/acceptance/900003567/lane.json';
const UNSTARTED = 'tests/acceptance/900003567/unstarted.test.mjs';

test('#3567.415647ec a file not yet started at the bound is named as not started, never starts, and no test of it reads PASS', BOUNDED, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, {
    [STUCK]: stuck(box),
    [LANE]: `${JSON.stringify({ alone: true, why: 'timing: a fixture of #3567, whose file must wait for the parallel block' })}\n`,
    [UNSTARTED]: unstarted(box),
  });
  const results = join(box.dir, 'results.json');
  const run = await affected(box, fixture, [`--results=${results}`, STUCK, UNSTARTED], { env: { DEEP_AFFECTED_MIN: String(BOUND_MIN) } });
  const all = () => dump(box, run);

  assert.match(run.stdout, new RegExp(`^alone node: ${UNSTARTED.replaceAll('.', '\\.')}$`, 'm'), `the scratch tree's lane file didn't put ${UNSTARTED} in the alone block, so it is no file that waits for the parallel block\n${all()}`);
  expectEnded(box, run, { what: `with ${STUCK} never ending and ${UNSTARTED} not yet started` });
  assert.ok(noted(box).some(({ role }) => role === 'stuck'), `${STUCK} never ran within the bound, so the parallel block wasn't what kept ${UNSTARTED} from starting\n${all()}`);

  const began = noted(box).find(({ role }) => role === 'unstarted');
  assert.equal(began, undefined, `${UNSTARTED} was started ${began ? ((began.at - run.began) / 1000).toFixed(1) : '?'} s after the run's start, though the parallel block never ended: at its ${BOUND_MIN * 60} s bound the run starts nothing more\n${all()}`);

  // No test of it reads PASS: the summary counts no pass (its tests are the only ones that could pass in this tree),
  // no line reads it as run, and its row in the --results file, when the run writes one, isn't PASS.
  const passed = passedCount(run.stdout);
  assert.ok(passed === null || passed === 0, `the summary counts ${passed} passed, though the only tests that could pass are those of ${UNSTARTED}, which never started: the run counts it as passed\n${all()}`);
  assert.deepEqual(stateLines(run.stdout, UNSTARTED).filter((line) => !/^(?:INCONCLUSIVE|BLOCKED|INVALID)\b/.test(line)), [], `${UNSTARTED} never started, yet a line reads it as run\n${all()}`);
  if (existsSync(results)) {
    const written = JSON.parse(readFileSync(results, 'utf8'));
    const row = (written.files ?? []).find(({ file }) => file === UNSTARTED);
    assert.notEqual(row?.state, 'PASS', `the --results file reads ${UNSTARTED} as PASS, though it never started\n${JSON.stringify(written)}\n${all()}`);
    assert.notEqual(written.state, 'PASS', `the --results file reads the run as PASS, though ${UNSTARTED} never started\n${JSON.stringify(written)}\n${all()}`);
  }

  const naming = inconclusive(run.stdout).filter((line) => line.includes(UNSTARTED));
  assert.ok(naming.length, `no INCONCLUSIVE line names ${UNSTARTED}, the file that never started\n${all()}`);
  assert.ok(naming.some((line) => NOT_STARTED.test(line)), `${UNSTARTED} is not named as not started: none of the INCONCLUSIVE lines that name it says so (${NOT_STARTED})\n${naming.join('\n')}\n${all()}`);
});
