// Criterion 2 (#2338.19700c5a): an anchor that no heading or <a id> of the file has exits non-zero, naming the file and
// the anchor, and prints no section. The planted program is planted/unknown-exits-zero.mjs, which prints nothing and
// exits 0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SECTION, SECTION_DOCS, TD, runIn, scratch, unknownProblems } from './helpers.mjs';

const ANCHOR = 'no-such-section';

test('#2338.19700c5a AC2 an anchor no heading or <a id> of the file has exits non-zero, naming the file and the anchor, and prints no section; a planted script that exits 0 fails', (t) => {
  const copy = scratch(t, SECTION_DOCS);
  const run = runIn(copy, SECTION, [`${TD}#${ANCHOR}`]);
  const problems = unknownProblems(run, ANCHOR);
  assert.deepEqual(problems, [], `${SECTION} doesn't refuse ${TD}#${ANCHOR}:\n${problems.join('\n')}\n\n${run.output}`);

  const planted = runIn(copy, SECTION, [`${TD}#${ANCHOR}`], { planted: 'unknown-exits-zero' });
  assert.equal(planted.status, 0, `the planted script doesn't exit 0 for the unknown anchor, so it shows nothing here:\n${planted.output}`);
  const caught = unknownProblems(planted, ANCHOR);
  assert.ok(caught.some((problem) => problem.includes('exited 0')), `this test passes the planted script that exits 0 for an unknown anchor:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted unknown-exits-zero.mjs fails: ${caught.join('; ')}`);
});
