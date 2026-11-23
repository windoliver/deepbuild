// #3139 AC2, the wait ratchet in scratch repositories (README: AC2, planted). The decision: a planted twin, any file
// under a twins/ folder in tests/acceptance/, is out; a blind suite's own file is judged only in the change that adds
// it, so once the merge base holds it a file with no ceiling is out and a new suite still starts at zero; the other
// acceptance ceilings stay. Outside tests/acceptance/ nothing changes. Each side of each line is planted. The planted
// waits are text these tests write into scratch files; nothing here waits on a timer.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ADDED, AC2, PLANT, WAITS, WAIT_CEILINGS, commit, drop, json, naming, put, run, scratch, show } from './helpers.mjs';

/** A node:test file that waits for its job's event, or on a timer (line 8). */
const suiteFile = (wait) => [
  "import assert from 'node:assert/strict';",
  "import { once } from 'node:events';",
  "import test from 'node:test';",
  "import { start } from './helpers.mjs';",
  '',
  "test('reports done', async () => {",
  '  const job = start();',
  wait ? '  await new Promise((resolve) => setTimeout(resolve, 500));' : "  await once(job, 'done');",
  "  assert.equal(job.state, 'done');",
  '});',
  '',
].join('\n');

/** A test that holds `waits` sleeps, one a line from line 5. */
const sleeper = (waits) => [
  "import { expect, it } from 'vitest';",
  "import { sleep } from './helpers';",
  '',
  "it('settles', async () => {",
  ...Array.from({ length: waits }, (_, i) => `  await sleep(${(i + 1) * 100});`),
  '  expect(true).toBe(true);',
  '});',
  '',
].join('\n');

/** A twin: a copy of a source file of the program whose retry waits on a timer (line 4), as a planted wrong program may. */
const twinSource = [
  'export async function retry(task: () => Promise<boolean>): Promise<boolean> {',
  '  for (let attempt = 0; attempt < 3; attempt++) {',
  '    if (await task()) return true;',
  '    await new Promise((resolve) => setTimeout(resolve, 100));',
  '  }',
  '  return false;',
  '}',
  '',
].join('\n');

const HELD = `${PLANT}held.test.mjs`; // a suite's own file the merge base holds, with a fixed wait and no ceiling
const LISTED = `${PLANT}listed.test.ts`; // a suite's own file the merge base holds with a ceiling of 1
const TWIN = `${ADDED}twins/retries-on-a-timer/packages/fixture/src/retry.ts`;
const NEW = `${ADDED}reports.test.mjs`;

/** A pass: exit 0, a PASS waits line, and no line in a failing state. */
function assertPasses(result, why) {
  assert.equal(result.status, 0, `${why}\n${show(result)}`);
  assert.ok(result.lines.some((line) => line.startsWith('PASS waits')), `no PASS waits line ${why}\n${show(result)}`);
  assert.ok(!result.lines.some((line) => /^(?:FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.test(line)), `${why}\n${show(result)}`);
}

test(`${AC2} AC2: the wait ratchet leaves out a suite's own file the merge base holds with no ceiling, and a twin the change adds, and still fails the suite file the change adds beside it`, (t) => {
  const cwd = scratch(t, { [HELD]: suiteFile(true), [LISTED]: sleeper(1) }, { [WAIT_CEILINGS]: json({ [LISTED]: 1 }) });

  // The merge base holds HELD with its fixed wait and no ceiling: judged only in the change that added it, so out.
  const held = run(WAITS, cwd);
  assert.deepEqual(naming(held, 'waits', HELD), [], `a line names ${HELD}, a suite's own file the merge base holds with no ceiling, which the decision leaves out\n${show(held)}`);
  assertPasses(held, `(the merge base's suite: ${HELD} out, ${LISTED} at its ceiling of 1)`);

  // The change adds a twin that waits on a timer and its suite's own file, which waits for its event.
  commit(cwd, { [TWIN]: twinSource, [NEW]: suiteFile(false) });
  const twin = run(WAITS, cwd);
  assert.deepEqual(naming(twin, 'waits', TWIN), [], `a line names ${TWIN}, a planted twin under a twins/ folder in tests/acceptance/, which is out\n${show(twin)}`);
  assertPasses(twin, `(the change adds the twin ${TWIN}, out, and ${NEW}, which waits for its event)`);

  // The same change with the suite's own file waiting on a timer: a new suite starts at zero, so it fails at line 8.
  commit(cwd, { [NEW]: suiteFile(true) });
  const added = run(WAITS, cwd);
  assert.equal(added.status, 1, `the suite file the change adds holds a fixed wait, so the ratchet fails\n${show(added)}`);
  assert.ok(naming(added, 'waits', `${NEW}:8`).some((line) => line.startsWith('FAIL ')), `no FAIL line names ${NEW}:8, the fixed wait in a suite file the change adds\n${show(added)}`);
  assert.deepEqual([...naming(added, 'waits', TWIN), ...naming(added, 'waits', HELD)], [], `a FAIL elsewhere named the twin or the held suite file, both out\n${show(added)}`);
});

test(`${AC2} AC2: the wait ratchet still fails a fixed wait planted outside tests/acceptance/, in a file the merge base holds and in a new file under a twins/ folder there, and an acceptance file over the ceiling it keeps`, (t) => {
  const OUTSIDE = 'tests/held.test.mjs'; // under tests/, outside tests/acceptance/, held with no wait
  const OUT_TWIN = 'packages/fixture/test/twins/sleeps.test.ts'; // a twins/ folder outside tests/acceptance/
  const cwd = scratch(t, { [OUTSIDE]: suiteFile(false), [LISTED]: sleeper(1) }, { [WAIT_CEILINGS]: json({ [LISTED]: 1 }) });
  assertPasses(run(WAITS, cwd), `(${OUTSIDE} waits for its event; ${LISTED} is at its ceiling of 1)`);

  put(cwd, OUTSIDE, suiteFile(true));
  const outside = run(WAITS, cwd);
  assert.equal(outside.status, 1, `${OUTSIDE} holds a planted fixed wait\n${show(outside)}`);
  assert.ok(naming(outside, 'waits', `${OUTSIDE}:8`).some((line) => line.startsWith('FAIL ')), `no FAIL line names ${OUTSIDE}:8, a fixed wait planted in a file the merge base holds outside tests/acceptance/\n${show(outside)}`);
  put(cwd, OUTSIDE, suiteFile(false));

  put(cwd, OUT_TWIN, sleeper(1));
  const twin = run(WAITS, cwd);
  assert.equal(twin.status, 1, `${OUT_TWIN} holds a planted fixed wait\n${show(twin)}`);
  assert.ok(naming(twin, 'waits', `${OUT_TWIN}:5`).some((line) => line.startsWith('FAIL ')), `no FAIL line names ${OUT_TWIN}:5: a twins/ folder outside tests/acceptance/ is no planted twin\n${show(twin)}`);
  drop(cwd, OUT_TWIN);

  put(cwd, LISTED, sleeper(2));
  const listed = run(WAITS, cwd);
  assert.equal(listed.status, 1, `${LISTED} holds 2 fixed waits over its ceiling of 1\n${show(listed)}`);
  assert.ok(naming(listed, 'waits', LISTED).some((line) => line.startsWith('FAIL ')), `no FAIL line names ${LISTED}, an acceptance file the merge base holds with 2 fixed waits over the ceiling of 1 it keeps\n${show(listed)}`);
});
