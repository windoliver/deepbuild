// #3169.7cec9f4a: on a machine whose device isn't Metal, each of the issue's tests states that it needs Metal or the
// reference Mac, and the unit lane reads it INCONCLUSIVE (platform), never FAIL, BLOCKED or PASS. The run is the
// issue's Proof command over the three targets that hold those tests; its output is read by lanes.mjs's own readers.
import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMAND, elsewhere, HOURS, idOf, METAL, NAMED, panicOf, PLATFORM, proofRun } from './helpers.mjs';

/** A note that says what the test needs: Metal, or the reference Mac. */
const NEEDS = /\bMetal\b|\breference Mac\b/i;

test('#3169.7cec9f4a off Metal each of the nine tests states it needs Metal or the reference Mac and the unit lane reads it INCONCLUSIVE (platform)', HOURS, async (t) => {
  if (METAL) return t.skip(elsewhere('a machine whose GPU device is not Metal (the Spark, Linux on aarch64)'));
  const run = await proofRun(t);
  assert.equal(run.error, undefined, run.error);
  const wrong = [];
  for (const named of NAMED) {
    const id = idOf(named);
    const rows = run.tests.filter((row) => row.id === id);
    const row = rows[0];
    if (!row) wrong.push(`${id}: not in the run's results at all (exit ${run.status})`);
    else if (rows.length > 1) wrong.push(`${id}: read ${rows.length} times: ${rows.map(({ state }) => state).join(', ')}`);
    else if (!row.skipped) wrong.push(`${id}: ${row.state}${row.state === 'PASS' ? ': it ran and passed off Metal' : `: ${panicOf(run.stdout, named.name) || row.note || ''}`}`);
    else if (row.state !== 'INCONCLUSIVE' || !row.platform) wrong.push(`${id}: skipped and read ${row.state}${row.platform ? '' : ', not a platform skip'}: its note is ${JSON.stringify(row.note)}`);
    else if (!NEEDS.test(row.note)) wrong.push(`${id}: its note ${JSON.stringify(row.note)} doesn't say it needs Metal or the reference Mac`);
  }
  assert.deepEqual(wrong, [], `${COMMAND.join(' ')} on ${PLATFORM}, read by lanes.mjs: ${wrong.length} of the ${NAMED.length} named tests aren't INCONCLUSIVE (platform) with a note naming Metal or the reference Mac:\n  ${wrong.join('\n  ')}`);
});
