// #3478: a run that needs no binary keeps its place in the test line for as long as test grants change hands, past its
// stall bound, then runs its tests (docs/parallel-proof.md, section 6). The line is a test's own, on a table of its
// own (README: The moving line). Written blind from issue #3478 at base 1b4929ae7.
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, ended, evidence, fixture, grantOf, grants, movingLine, plain, prints, record, RUN_MIN, resultsFile, sandbox, stateOf, TEST, throttleLog, workspace } from './helpers.mjs';

const FILE = 'tests/fixture-3478/plain.test.mjs';

test('#3478.de589636 with DEEP_TEST_GRANT_STALL at 0.25, a run that needs no binary behind test holders whose grants change hands about every 2 s for 40 s gets its test grant and reads its tests\' own results', TEST, async (t) => {
  const box = sandbox(t);
  // The repository has a Cargo workspace, but the selected test neither builds nor reads a binary.
  const fx = fixture(box, {
    ...workspace(box, { 'fixture-a': prints('fixture-a') }),
    [FILE]: plain(FILE),
  });
  // Every test slot but one is held still; the last changes hands about every 2 s, thirteen holders waiting for it
  // at every moment, each holding 1.5 s: at least 19.5 s of hand-overs ahead of a newcomer, past the 15 s bound.
  const line = await movingLine(box, 'test', 13);
  assert.ok(line, 'the line of test holders never moved: its still holders got no grant, or no grant changed hands, within 2 min');
  const watch = line.watch();

  const run = affected(box, fx, [`--results=${resultsFile(box)}`, FILE], { DEEP_TEST_GRANT_STALL: '0.25' });
  // The line moves for 40 s at least, and until the run has its test grant or has ended.
  const ending = ended(run);
  await Promise.race([watch.line(/^GRANTED$/), ending]);
  line.halt();
  const result = await ending;
  const before = watch.joined();
  const all = evidence(result, run, box, fx);

  assert.ok(result, `the run was still going ${RUN_MIN} min after it started, behind a line that kept moving\n${all}`);
  assert.notEqual(before, null, `the run was never seen waiting in the test line, so it proves nothing about a wait\n${all}`);
  assert.ok(!result.stdout.includes('INCONCLUSIVE no grant'), `a run whose line keeps moving never reads INCONCLUSIVE no grant\n${all}`);
  const log = throttleLog(box), holders = line.pids();
  const tested = grantOf(log, 'test', holders);
  assert.ok(tested, `the run got no test grant\n${all}`);
  // It waited its turn behind the line: holders' grants came after it joined, more than the bound's worth of them.
  const ahead = grants(log.slice(0, log.indexOf(tested)), 'test').filter((entry) => holders.has(entry.pid)).length - before;
  assert.ok(ahead >= 11, `at least 11 holders' grants (16.5 s of holding, past the 0.25-min bound) came between the run joining the line and its test grant; ${ahead} did\n${all}`);
  assert.deepEqual(grants(log, 'build'), [], `a run that needs no binary asks for no build grant\n${all}`);
  // Its tests' own results: the planted test ran, and the run's --results file reads its file PASS.
  assert.ok(record(fx).some((entry) => entry.event === 'start'), `the planted test never ran\n${all}`);
  assert.equal(stateOf(box, FILE), 'PASS', `the run's results read the planted file PASS, its own test's result\n${all}`);
});
