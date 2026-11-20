// Criterion 2 (#2340.8ccc28b4): a link to a heading's explicit `<a id>` and a link to the slug of the heading that
// follows it land on one row. A planted script that keys rows by the anchor as written prints two rows and fails,
// naming both. In the fixture, #9804 (closed) links `<a id="plan">` and #9807 (open) links the slug of the heading that
// follows it, `## Six weeks to version 0`. The planted script is planted/anchor-as-written.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISSUES, ROW, TD, fullRead, oneRowProblems, run } from './helpers.mjs';

const BOTH = [`${TD}#plan`, `${TD}#${ROW.plan.anchor}`];

test('#2340.8ccc28b4 AC2 a link to <a id="plan"> (#9804, closed) and a link to six-weeks-to-version-0, the slug of the heading that follows it (#9807, open), land on one row, which reads mixed; a planted script that keys rows by the anchor as written prints two rows and fails, naming both', (t) => {
  const script = run(t, { issues: ISSUES });
  const problems = [...fullRead(script), ...oneRowProblems(script)];
  assert.deepEqual(problems, [], `${script.name} doesn't put a heading's <a id> and its slug on one row:\n${problems.join('\n')}\n\n${script.output}`);

  const planted = run(t, { issues: ISSUES, planted: 'anchor-as-written' });
  const rows = planted.rows.filter((row) => BOTH.includes(`${row.file}#${row.anchor}`));
  assert.equal(rows.length, 2, `the planted script that keys rows by the anchor as written doesn't print two rows, ${BOTH.join(' and ')}, so it shows nothing about this test:\n${planted.output}`);
  const caught = oneRowProblems(planted);
  assert.ok(caught.some((problem) => BOTH.every((anchor) => problem.includes(anchor))), `this test passes the planted script that keys rows by the anchor as written, or fails it without naming both ${BOTH.join(' and ')}:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted anchor-as-written.mjs fails: ${caught.join('; ')}`);
});
