// #3567, criterion 6: a file that ran over 10 minutes is named on one line with its minutes, and one under is not.
// No short test can spend ten minutes, and the issue names no way to shorten them, so the run's node processes are
// given clocks that run 20 times as fast as the test's (helpers.mjs: clock; README: Criterion 6): the file that takes
// 45 s of the test's time ran 15 minutes by every clock the run's scripts read, and the file beside it, in the same
// job, ran well under ten. The bound is set far off, so nothing but the two files decides what the run prints.
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, clock, dump, lasting, nodePass, passedCount, sandbox, tree, WHOLE, WHOLE_MS, without } from './helpers.mjs';

const OVER = 'tests/fixture-3567-over.test.mjs';
const UNDER = 'tests/fixture-3567-under.test.mjs';
const SCALE = 20;
// 15 minutes of the run's clocks.
const OVER_MS = (15 * 60_000) / SCALE;

test("#3567.58cd929d a file that ran over 10 minutes by the run's clocks is named on one line with its minutes, and the file beside it that ran under 10 is not", WHOLE, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, { [OVER]: lasting(OVER_MS), [UNDER]: nodePass });
  const run = await affected(box, fixture, [OVER, UNDER], { env: { ...clock(box, SCALE), DEEP_AFFECTED_MIN: '600' }, limit: WHOLE_MS });
  const all = () => dump(box, run);
  assert.ok(!run.limited, `the run did not end within ${WHOLE_MS / 1000} s\n${all()}`);
  assert.equal(passedCount(run.stdout), 2, `the two files' tests didn't both run and pass, so this run proves nothing about how long they ran\n${all()}`);
  // The whole run, by its own clocks, in minutes: no file in it ran longer.
  const whole = Math.ceil((run.ms * SCALE) / 60_000) + 1;
  assert.ok(whole < 600, `the run took ${whole} min by its own clocks, past the bound this test set\n${all()}`);

  // A line names a file with its minutes when, beside the paths it names, it holds a number over 10 and no more than
  // the whole run took: the file's minutes, however the line words them.
  const rest = (line) => without(line, OVER, UNDER, box.dir);
  const minutes = (line) => (rest(line).match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 10 && n <= whole);
  const naming = run.stdout.split('\n').filter((line) => line.includes(OVER) && minutes(line).length);
  assert.equal(naming.length, 1, `${OVER} ran ${(OVER_MS * SCALE) / 60_000} min by the run's clocks, and ${naming.length} lines name it with its minutes (a number over 10 and at most ${whole}), not one\n${naming.join('\n')}\n${all()}`);
  assert.ok(!naming[0].includes(UNDER), `${UNDER} ran under 10 minutes, yet the line that names ${OVER} with its minutes names it too\n${naming[0]}\n${all()}`);
  const under = run.stdout.split('\n').filter((line) => line.includes(UNDER) && /\d\s*min/i.test(rest(line)));
  assert.deepEqual(under, [], `${UNDER} ran under 10 minutes, yet a line names it with minutes\n${all()}`);
});
