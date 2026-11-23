// #3169.bb7defda: on the Mac the issue's tests run and judge as they do today. The run is the issue's Proof command
// over the three targets that hold those tests; its output is read by lanes.mjs's own readers.
//
// Today, on every Mac, each test runs: none is ignored. On the reference Mac, the model the merge-base hash was read on,
// each one passes. On any other Mac each hash test fails with its own BLOCKED panic, since a same-machine hash can't be
// compared there. The memory tests' verdicts there are not the reference's: at the base on a Mac18,1, #3016's ac3 fails
// when its target runs whole and passes alone (BASE-FAILURE.txt). So on such a Mac the test asserts what it can, and then
// skips, INCONCLUSIVE (platform), never PASS.
import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMAND, elsewhere, HOURS, idOf, METAL, model, NAMED, panicOf, PLATFORM, proofRun, REFERENCE_MAC, section } from './helpers.mjs';

test('#3169.bb7defda on the Mac the nine tests run and judge as they do today', HOURS, async (t) => {
  if (!METAL) return t.skip(elsewhere('the Mac, whose GPU device is Metal'));
  const here = model(), reference = here === REFERENCE_MAC;
  const run = await proofRun(t);
  assert.equal(run.error, undefined, run.error);
  const wrong = [], read = [];
  for (const named of NAMED) {
    const id = idOf(named);
    const rows = run.tests.filter((row) => row.id === id);
    const row = rows[0];
    if (!row) { wrong.push(`${id}: not in the run's results at all (exit ${run.status}); today it runs`); continue; }
    if (rows.length > 1) { wrong.push(`${id}: read ${rows.length} times: ${rows.map(({ state }) => state).join(', ')}`); continue; }
    if (row.skipped) { wrong.push(`${id}: skipped on the Mac, read ${row.state}, with the note ${JSON.stringify(row.note)}; today it runs`); continue; }
    read.push(`${named.name} ${row.state}`);
    // The reference Mac: each passes, as today.
    if (reference && row.state !== 'PASS') wrong.push(`${id}: ${row.state}: ${panicOf(run.stdout, named.name) || row.note || ''}; today it reads PASS on the reference Mac`);
    // Another Mac: a hash test reads its own BLOCKED, as today.
    if (!reference && named.kind === 'hash' && (row.state !== 'FAIL' || !/\bBLOCKED\b/.test(section(run.stdout, named.name)))) wrong.push(`${id}: ${row.state}${row.state === 'PASS' ? '' : `: ${panicOf(run.stdout, named.name)}`}; today on a ${here}, not the ${REFERENCE_MAC} its hash was read on, it fails with its BLOCKED panic`);
  }
  assert.deepEqual(wrong, [], `${COMMAND.join(' ')} on ${PLATFORM} (${here}), read by lanes.mjs: ${wrong.length} of the ${NAMED.length} named tests don't run and judge as today:\n  ${wrong.join('\n  ')}`);
  if (!reference) return t.skip(`INCONCLUSIVE (platform): each named test ran on this ${here} (${read.join(', ')}); their verdicts are judged only on the reference Mac, a ${REFERENCE_MAC}, so this Mac doesn't prove them; unproven here`);
});
