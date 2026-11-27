// Criterion 3 (#3401.b6c9c9bc): the rows under the generated headings, read in name order, equal the generated rows of
// the merge base byte for byte, every one of them. A planted `table` that drops or rewords a row fails, naming the
// list: planted on the output, a row deleted from the reference and a row reworded in it, held to the same comparison.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CP, generatedOf, mergeBase, read, rowProblems, sectionRows, show, withRowReworded, withoutRow } from './helpers.mjs';

/** The checkout's reference, with its generated headings, and the merge base's generated rows. */
function readBoth() {
  const doc = read(CP);
  const { headings } = generatedOf(doc);
  assert.ok(headings.length >= 2, `${CP} holds its field lists under ${headings.length} generated headings inside Registries and closed lists, not several`);
  const base = mergeBase();
  const baseRows = sectionRows(show(base, CP));
  assert.ok(baseRows.length > 0, `the merge base ${base.slice(0, 9)} holds no generated rows to compare with`);
  return { doc, headings, base, baseRows };
}

test('#3401.b6c9c9bc AC3: the rows under the generated headings, read in name order, equal the merge base\'s generated rows byte for byte, every one of them', (t) => {
  const { doc, headings, base, baseRows } = readBoth();
  const problems = rowProblems(doc, baseRows);
  assert.deepEqual(problems, [], `the rows under the ${headings.length} generated headings aren't the ${baseRows.length} generated rows of the merge base ${base.slice(0, 9)}`);
  t.diagnostic(`${baseRows.length} rows of the merge base ${base.slice(0, 9)}, each under one of ${headings.length} generated headings, byte for byte`);
});

test('#3401.b6c9c9bc AC3: a `table` that drops a row or rewords one fails the comparison, naming the list', (t) => {
  const { doc, headings, baseRows } = readBoth();
  assert.deepEqual(rowProblems(doc, baseRows), [], 'the rows under the generated headings aren\'t the merge base\'s, so a planted row shows nothing here');

  const dropped = headings[Math.floor(headings.length / 2)].rows.at(-1);
  const afterDrop = rowProblems(withoutRow(doc, dropped), baseRows);
  assert.equal(afterDrop.length, 1, `a dropped row of ${dropped.list} is one finding, not ${afterDrop.length}: ${afterDrop.join(' | ')}`);
  assert.ok(afterDrop[0].startsWith(`${dropped.list}: `), `the finding for a dropped row doesn't name ${dropped.list}: ${afterDrop[0]}`);
  t.diagnostic(`a dropped row fails: ${afterDrop[0]}`);

  const reworded = headings[0].rows[0];
  const afterReword = rowProblems(withRowReworded(doc, reworded), baseRows);
  assert.equal(afterReword.length, 1, `a reworded row of ${reworded.list} is one finding, not ${afterReword.length}: ${afterReword.join(' | ')}`);
  assert.ok(afterReword[0].startsWith(`${reworded.list}: `), `the finding for a reworded row doesn't name ${reworded.list}: ${afterReword[0]}`);
  t.diagnostic(`a reworded row fails: ${afterReword[0]}`);
});
