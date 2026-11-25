// #3478: a run whose stall bound is longer than a timed request's wait keeps its place in the build line through that
// request's drain and is served after it (docs/parallel-proof.md, section 6: Drain, a stuck drain). On a table of the
// test's own. Written blind from issue #3478 at base 1b4929ae7.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { THROTTLE } from '../1115/helpers.mjs';
import { affected, ended, evidence, fixture, grantOf, grants, holdEvery, launch, prints, record, RUN_MIN, resultsFile, sandbox, selfBuilding, stateOf, TEST, throttleLog, within, workspace } from './helpers.mjs';

const FILE = 'tests/fixture-3478/self-build.test.mjs';

test('#3478.b300c126 with DEEP_TEST_GRANT_STALL at 0.2, every build slot held for 8 s and a top-level timed --wait 0.05 request made after the run joined the line, the timed request ends INCONCLUSIVE no grant, and the run then gets its build grant and reads its tests\' own results', TEST, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box, {
    ...workspace(box, { 'fixture-a': prints('fixture-a') }),
    [FILE]: selfBuilding(FILE, 'fixture-a'),
  });
  // Other sessions hold every build slot until the test lets them go, 8 s after the run joined the line.
  const line = await holdEvery(box, 'build');
  assert.ok(line.holders.every(Boolean), `every holder took its build grant\n${line.holders.map((holder) => holder?.out()).join('\n')}`);

  const watch = line.watch();
  const run = affected(box, fx, [`--results=${resultsFile(box)}`, FILE], { DEEP_TEST_GRANT_STALL: '0.2' });
  const ending = ended(run);
  const joined = await Promise.race([watch.line(/^JOINED \d+$/), ending.then(() => null)]);
  // The holders let go 8 s after the run joined the line.
  line.releaseIn(8);
  // A top-level timed request, made once the run is in line: it drains for its 0.05 min behind the held build slots.
  const ran = join(box.dir, 'timed-ran');
  const timed = launch(box, [process.execPath, THROTTLE, 'timed', '--wait', '0.05', '--', '/bin/sh', '-c', ': > "$0"', ran]);
  const drained = await within(timed.done, 2);
  const result = await ending;
  const all = `${evidence(result, run, box, fx)}\nthe timed request: ${drained ? `exit ${drained.status}\n${drained.stdout}${drained.stderr}` : `still waiting\n${timed.out()}`}`;

  assert.ok(joined, `the run was never seen waiting in the build line behind the held slots, so no timed request came after it joined\n${all}`);
  assert.ok(drained, `the timed --wait 0.05 request was still waiting 2 min on\n${all}`);
  assert.ok(drained.stdout.split('\n').some((text) => text.startsWith('INCONCLUSIVE no grant')), `the timed request ends INCONCLUSIVE no grant\n${all}`);
  assert.equal(drained.status, 3, `the timed request with no grant exits 3\n${all}`);
  assert.ok(!existsSync(ran), `the timed request's command never ran\n${all}`);

  assert.ok(result, `the run was still going ${RUN_MIN} min after it started\n${all}`);
  assert.ok(!result.stdout.includes('INCONCLUSIVE no grant'), `the run keeps its place through the drain: it never reads INCONCLUSIVE no grant\n${all}`);
  const log = throttleLog(box);
  const build = grantOf(log, 'build', line.pids);
  assert.ok(build, `the run got no build grant\n${all}`);
  const timeout = log.find((entry) => entry.event === 'timeout' && entry.class === 'timed');
  assert.ok(timeout, `the log holds the timed request's timeout\n${all}`);
  assert.ok(log.indexOf(timeout) < log.indexOf(build), `the run got its build grant after the timed request ended\n${all}`);
  assert.ok(grants(log, 'test').length >= 1, `the run got no test grant\n${all}`);
  // Its tests' own results: the planted test ran, and the run's --results file reads its file PASS.
  assert.ok(record(fx).some((entry) => entry.event === 'built' && entry.status === 0), `the planted test never ran\n${all}`);
  assert.equal(stateOf(box, FILE), 'PASS', `the run's results read the planted file PASS, its own test's result\n${all}`);
});
