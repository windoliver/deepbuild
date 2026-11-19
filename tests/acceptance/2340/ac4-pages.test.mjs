// Criterion 4 (#2340.38f8ebe4): against a recording stand-in for `gh` that serves 250 closed fixture issues in pages
// of 100, the summary counts 250 read. A planted script that reads the first page only counts 100 and fails, naming
// both counts. With the stand-in failing on the second page, the script prints BLOCKED naming the fetch, prints no
// table and exits non-zero; a planted script that prints the first page's table fails. The planted scripts are
// planted/first-page-only.mjs and planted/table-on-partial-read.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAGED, fullRead, partialReadProblems, readCountProblems, run } from './helpers.mjs';

test('#2340.38f8ebe4 AC4 against a recording stand-in for gh that serves 250 closed issues in pages of 100, the summary counts 250 read; a planted script that reads the first page only counts 100 and fails, naming both counts', (t) => {
  const script = run(t, { issues: PAGED });
  const problems = [...fullRead(script), ...readCountProblems(script, 250)];
  assert.deepEqual(problems, [], `${script.name} doesn't count the 250 closed issues the stand-in served in pages of 100:\n${problems.join('\n')}\n\n${script.output}`);
  t.diagnostic(`recorded gh calls: ${script.calls.join('; ')}`);
  t.diagnostic(`summary: ${script.summary.line}`);

  const planted = run(t, { issues: PAGED, planted: 'first-page-only' });
  assert.equal(planted.summary?.issues.read, 100, `the planted script that reads the first page only doesn't count 100 read, so it shows nothing about this test:\n${planted.output}`);
  const caught = readCountProblems(planted, 250);
  assert.ok(caught.some((problem) => /\b100\b/.test(problem) && /\b250\b/.test(problem)), `this test passes the planted script that reads the first page only, or fails it without naming both counts, 100 and 250:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted first-page-only.mjs fails: ${caught.join('; ')}`);
});

test('#2340.38f8ebe4 AC4 with the stand-in failing on the second page of the closed issues, the script prints BLOCKED naming the fetch, prints no table and exits non-zero; a planted script that prints the first page\'s table fails', (t) => {
  const script = run(t, { issues: PAGED, failFromPage: 2 });
  const problems = partialReadProblems(script);
  assert.deepEqual(problems, [], `${script.name} doesn't stop BLOCKED, with no table, when the second page of the closed issues fails:\n${problems.join('\n')}\n\n${script.output}`);
  t.diagnostic(`recorded gh calls: ${script.calls.join('; ')}`);
  t.diagnostic(`BLOCKED line: ${script.blocked.join(' | ')}`);

  const planted = run(t, { issues: PAGED, failFromPage: 2, planted: 'table-on-partial-read' });
  assert.ok(planted.rows.length > 0, `the planted script that prints the first page's table prints no table row, so it shows nothing about this test:\n${planted.output}`);
  const caught = partialReadProblems(planted);
  assert.ok(caught.some((problem) => problem.includes('printed a table from a partial read')), `this test passes the planted script that prints the first page's table:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted table-on-partial-read.mjs fails: ${caught.join('; ')}`);
});
