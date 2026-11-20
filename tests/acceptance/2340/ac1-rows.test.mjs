// Criterion 1 (#2340.fc02d61b): from a fixture of two docs and eight issues (five closed as completed, two open, one
// closed as not planned), the script prints the expected rows: a heading two closed issues link reads `closed` with
// both numbers; one a closed and an open issue link reads `mixed`; one only an open issue links reads `open`; and one
// only the not-planned issue links is listed as unlinked. A planted script that reads the not-planned issue as closed
// prints that heading as `closed` and fails, naming it. The planted script is planted/not-planned-as-closed.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISSUES, ROW, fullRead, key, rowProblems, run } from './helpers.mjs';

const EXPECTED = [ROW.alpha, ROW.beta, ROW.gamma, ROW.delta];

test('#2340.fc02d61b AC1 from two docs and eight issues, alpha-section reads closed with #9801 and #9802, beta-section mixed, gamma-section open, and delta-section, which only the not-planned #9808 links, is listed as unlinked; a planted script that reads the not-planned issue as closed prints delta-section as closed and fails, naming it', (t) => {
  const script = run(t, { issues: ISSUES });
  const problems = [...fullRead(script), ...rowProblems(script, EXPECTED)];
  assert.deepEqual(problems, [], `${script.name} doesn't print the rows the fixture's two docs and eight issues give:\n${problems.join('\n')}\n\n${script.output}`);

  const planted = run(t, { issues: ISSUES, planted: 'not-planned-as-closed' });
  const delta = planted.rows.find((row) => key(row) === key(ROW.delta));
  assert.equal(delta?.reads, 'closed', `the planted script that reads the not-planned #9808 as closed doesn't print ${key(ROW.delta)} as closed, so it shows nothing about this test:\n${planted.output}`);
  const caught = rowProblems(planted, EXPECTED);
  assert.ok(caught.some((problem) => problem.includes(key(ROW.delta))), `this test passes the planted script that reads the not-planned #9808 as closed, or fails it without naming ${key(ROW.delta)}:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted not-planned-as-closed.mjs fails: ${caught.join('; ')}`);
});
