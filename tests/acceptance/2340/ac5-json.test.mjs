// Criterion 5 (#2340.baf32dff): the JSON holds the same rows and summary as the table, checked by reading both from
// one run. A planted script whose JSON drops the unlinked headings fails, naming the count. One run is
// `node scripts/design-issues.mjs --json <file>`: the table and its summary line on stdout, the JSON in the file. The
// planted script is planted/json-drops-unlinked.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISSUES, fullRead, jsonProblems, run } from './helpers.mjs';

test('#2340.baf32dff AC5 the JSON of one run holds the same rows and summary as its table; a planted script whose JSON drops the unlinked headings fails, naming the count', (t) => {
  const script = run(t, { issues: ISSUES, json: true });
  const problems = [...fullRead(script), ...jsonProblems(script)];
  assert.deepEqual(problems, [], `${script.name} --json <file> doesn't write the rows and the summary its table prints:\n${problems.join('\n')}\n\n${script.output}\n\nJSON:\n${script.jsonError ?? JSON.stringify(script.json, null, 2)}`);

  const planted = run(t, { issues: ISSUES, json: true, planted: 'json-drops-unlinked' });
  const unlinked = planted.rows.filter((row) => row.reads === 'unlinked').length;
  const dropped = unlinked > 0 && Array.isArray(planted.json?.rows) && planted.json.rows.every((row) => row.reads !== 'unlinked');
  assert.ok(dropped, `the planted script whose JSON drops the unlinked headings doesn't list them in its table and leave them out of its JSON, so it shows nothing about this test:\n${planted.output}`);
  const caught = jsonProblems(planted);
  assert.ok(caught.some((problem) => problem.includes(`${unlinked} unlinked`)), `this test passes the planted script whose JSON drops the unlinked headings, or fails it without naming the count, ${unlinked}:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted json-drops-unlinked.mjs fails: ${caught.join('; ')}`);
});
