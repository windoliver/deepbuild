// Criterion 4 (#3401.56148288): `canvas-closures.mjs drift` passes on the change. With a row deleted from the last
// generated heading it fails, naming that list. A planted `drift` that reads only the first generated table passes the
// deletion and fails this test: a stand-in written beside the scratch copy at run time (helpers.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLOSURES_SCRIPT, CP, driftFailProblems, driftPassProblems, generatedOf, read, readIn, runFirstTableDrift, runIn, runInCheckout, scratch, withoutRow, writeIn } from './helpers.mjs';

test('#3401.56148288 AC4: drift passes on the change; with a row deleted from the last generated heading it fails, naming that list; a planted drift that reads only the first generated table passes the deletion and fails this test', (t) => {
  const { headings } = generatedOf(read(CP));
  assert.ok(headings.length >= 2, `${CP} holds its field lists under ${headings.length} generated headings inside Registries and closed lists, so there is no last generated heading past the first`);

  const run = runInCheckout(CLOSURES_SCRIPT, ['drift']);
  const problems = driftPassProblems(run);
  assert.deepEqual(problems, [], `${CLOSURES_SCRIPT} drift doesn't pass on this checkout:\n${problems.join('\n')}\n\n${run.output}`);

  const copy = scratch(t);
  const doc = readIn(copy, CP);
  const whole = runIn(copy, CLOSURES_SCRIPT, ['drift']);
  const wholeProblems = driftPassProblems(whole);
  assert.deepEqual(wholeProblems, [], `${CLOSURES_SCRIPT} drift doesn't pass in a scratch copy of this checkout:\n${wholeProblems.join('\n')}\n\n${whole.output}`);

  // A row deleted from the first generated heading, then from the last.
  const first = headings[0].rows.at(-1);
  writeIn(copy, CP, withoutRow(doc, first));
  const firstRun = runIn(copy, CLOSURES_SCRIPT, ['drift']);
  const firstProblems = driftFailProblems(firstRun, first.list);
  assert.deepEqual(firstProblems, [], `drift doesn't fail a row deleted from the first generated heading, #${headings[0].id}:\n${firstProblems.join('\n')}\n\n${firstRun.output}`);

  const last = headings.at(-1).rows.at(-1);
  writeIn(copy, CP, withoutRow(doc, last));
  const lastRun = runIn(copy, CLOSURES_SCRIPT, ['drift']);
  const lastProblems = driftFailProblems(lastRun, last.list);
  assert.deepEqual(lastProblems, [], `drift doesn't fail a row deleted from the last generated heading, #${headings.at(-1).id}:\n${lastProblems.join('\n')}\n\n${lastRun.output}`);
  t.diagnostic(`drift with the row deleted: ${lastRun.lines.find((line) => line.startsWith('FAIL drift:') && line.includes(last.list))}`);

  const planted = runFirstTableDrift(copy);
  assert.equal(planted.status, 0, `the planted drift that reads only the first generated table doesn't pass the deletion, so it shows nothing here:\n${planted.output}`);
  const caught = driftFailProblems(planted, last.list);
  assert.ok(caught.length, `this test passes the planted drift that reads only the first generated table:\n${planted.output}`);
  t.diagnostic(`the planted first-table drift fails: ${caught.join('; ')}`);
});
