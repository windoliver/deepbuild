// #3478: a run that needs a binary keeps its place in the build line for as long as build grants change hands, past
// its stall bound, then takes its test grant and runs its tests (docs/parallel-proof.md, section 6). The line is a
// test's own, on a table of its own (README: The moving line). Written blind from issue #3478 at base 1b4929ae7.
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, ended, evidence, fixture, grantOf, grants, movingLine, prints, record, RUN_MIN, resultsFile, sandbox, selfBuilding, stateOf, TEST, throttleLog, workspace } from './helpers.mjs';

const FILE = 'tests/fixture-3478/self-build.test.mjs';

test('#3478.ee81cf50 with DEEP_TEST_GRANT_STALL at 0.05, a run that needs a binary behind build holders whose grants change hands about every 2 s for 20 s gets its build grant, then its test grant, and reads its tests\' own results', TEST, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box, {
    ...workspace(box, { 'fixture-a': prints('fixture-a') }),
    [FILE]: selfBuilding(FILE, 'fixture-a'),
  });
  // Every build slot but one is held still; the last changes hands about every 2 s, five holders waiting for it at
  // every moment, each holding 1.5 s: at least 7.5 s of hand-overs ahead of a newcomer.
  const line = await movingLine(box, 'build', 5);
  assert.ok(line, 'the line of build holders never moved: its still holders got no grant, or no grant changed hands, within 2 min');
  const watch = line.watch();

  const run = affected(box, fx, [`--results=${resultsFile(box)}`, FILE], { DEEP_TEST_GRANT_STALL: '0.05' });
  // The line moves for 20 s at least, and until the run has its build grant or has ended.
  const ending = ended(run);
  await Promise.race([watch.line(/^GRANTED$/), ending]);
  line.halt();
  const result = await ending;
  const before = watch.joined();
  const all = evidence(result, run, box, fx);

  assert.ok(result, `the run was still going ${RUN_MIN} min after it started, behind a line that kept moving\n${all}`);
  assert.notEqual(before, null, `the run was never seen waiting in the build line, so it proves nothing about a wait\n${all}`);
  assert.ok(!result.stdout.includes('INCONCLUSIVE no grant'), `a run whose line keeps moving never reads INCONCLUSIVE no grant\n${all}`);
  const log = throttleLog(box), holders = line.pids();
  const build = grantOf(log, 'build', holders);
  assert.ok(build, `the run got no build grant\n${all}`);
  // It waited its turn behind the line: holders' grants came after it joined, more than the bound's worth of them.
  const ahead = grants(log.slice(0, log.indexOf(build)), 'build').filter((entry) => holders.has(entry.pid)).length - before;
  assert.ok(ahead >= 3, `at least 3 holders' grants (4.5 s of hand-overs, past the 0.05-min bound) came between the run joining the line and its build grant; ${ahead} did\n${all}`);
  const tested = grants(log, 'test')[0];
  assert.ok(tested, `the run got no test grant\n${all}`);
  assert.ok(log.indexOf(build) < log.indexOf(tested), `the run's build grant came before its test grant\n${all}`);
  // Its tests' own results: the planted test ran, and the run's --results file reads its file PASS.
  assert.ok(record(fx).some((entry) => entry.event === 'built' && entry.status === 0), `the planted test never ran\n${all}`);
  assert.equal(stateOf(box, FILE), 'PASS', `the run's results read the planted file PASS, its own test's result\n${all}`);
});
