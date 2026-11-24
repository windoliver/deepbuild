// #2173 AC1, the blind redraft for #2047's sweep: `node scripts/repo-rules.mjs` exits 0 on main. The test runs this
// checkout's own checker, as written, from the checkout's root, and reads its exit status and result lines. The lines
// open issue #3139 holds, each about a file under tests/acceptance/, are set apart (README: The surface, (chosen)).
// It writes nothing. Run: node --test tests/acceptance/2173-redraft-2047/ac1-exits-0.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHECKER, CHECKOUT, childEnv, needCargo, quoted, runChecker, some } from './helpers.mjs';

// #3139's lines: a failing line whose message's first path (its first word holding a /) is under tests/acceptance/.
const HELD = 'tests/acceptance/';
const heldBy3139 = ({ message }) => message.split(/\s+/).find((word) => word.includes('/'))?.startsWith(HELD) ?? false;

test('AC1 #2173.222063e6 node scripts/repo-rules.mjs exits 0 on main, apart from the lines under tests/acceptance/ open issue #3139 holds', (t) => {
  const env = childEnv();
  needCargo(env);
  const run = runChecker(CHECKOUT, env);
  const held = run.failing.filter(heldBy3139);
  const other = run.failing.filter((result) => !heldBy3139(result));
  if (held.length) t.diagnostic(`${held.length} failing lines set apart as #3139's (each about a file under ${HELD})`);
  const passes = run.status === 0 || (run.status === 1 && run.failing.length > 0 && other.length === 0);
  assert.ok(passes,
    `node ${CHECKER} exits ${run.status}, not 0, and ${other.length ? `${other.length} of its failing lines ${other.length === 1 ? 'is' : 'are'} about files outside ${HELD}` : 'prints no failing line to account for it'} `
    + `(${held.length} more under ${HELD} set apart as #3139's). Those lines:\n${quoted(some(other.map(({ line }) => line)))}\n`
    + `Its stderr:\n${quoted(run.stderr)}`);
});
