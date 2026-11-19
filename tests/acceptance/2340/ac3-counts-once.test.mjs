// Criterion 3 (#2340.7613f30b): an issue that links one heading three times counts once on its row. A planted script
// that counts links prints 3 and fails, naming the heading and the count. In the fixture, #9805 (closed) links
// `## Foxtrot section` three times: by its full link on main, by a relative docs/ link and by a bare link. The planted
// script is planted/counts-links.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISSUES, ROW, countsOnceProblems, fullRead, key, run } from './helpers.mjs';

test('#2340.7613f30b AC3 #9805, which links foxtrot-section three times, counts once on its row; a planted script that counts links prints 3 and fails, naming the heading and the count', (t) => {
  const script = run(t, { issues: ISSUES });
  const problems = [...fullRead(script), ...countsOnceProblems(script)];
  assert.deepEqual(problems, [], `${script.name} doesn't count #9805 once on ${key(ROW.foxtrot)}:\n${problems.join('\n')}\n\n${script.output}`);

  const planted = run(t, { issues: ISSUES, planted: 'counts-links' });
  const foxtrot = planted.rows.find((row) => key(row) === key(ROW.foxtrot));
  const times = foxtrot?.closed.filter((number) => number === 9805).length;
  assert.equal(times, 3, `the planted script that counts links doesn't print #9805 3 times on ${key(ROW.foxtrot)}, so it shows nothing about this test:\n${planted.output}`);
  const caught = countsOnceProblems(planted);
  assert.ok(caught.some((problem) => problem.includes(key(ROW.foxtrot)) && /\b3 times\b/.test(problem)), `this test passes the planted script that counts links, or fails it without naming ${key(ROW.foxtrot)} and the count 3:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted counts-links.mjs fails: ${caught.join('; ')}`);
});
