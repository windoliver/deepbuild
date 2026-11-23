// #3139 AC2, the size ratchet in scratch repositories (README: AC2, planted). The decision, as for the wait ratchet: a
// planted twin, any file under a twins/ folder in tests/acceptance/, is out; a blind suite's own file is judged only in
// the change that adds it, so once the merge base holds it a file with no ceiling is out. Outside tests/acceptance/ a
// file over 1,500 lines with no ceiling still fails. Each side of each line is planted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ADDED, AC2, PLANT, SIZE, SIZE_CEILINGS, commit, drop, json, lines, naming, put, run, scratch, show } from './helpers.mjs';

/** A pass: exit 0, a PASS size line, and no line in a failing state. */
function assertPasses(result, why) {
  assert.equal(result.status, 0, `${why}\n${show(result)}`);
  assert.ok(result.lines.some((line) => line.startsWith('PASS size')), `no PASS size line ${why}\n${show(result)}`);
  assert.ok(!result.lines.some((line) => /^(?:FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.test(line)), `${why}\n${show(result)}`);
}

/** A FAIL line naming `path` and its size in lines, with or without a thousands comma. */
const failsNaming = (result, path, size) => naming(result, 'size', path).some((line) => line.startsWith('FAIL ') && new RegExp(`(?<![\\d,])${String(size).replace(/\B(?=(\d{3})+$)/g, ',?')}(?!,?\\d)`).test(line.slice(line.indexOf(path) + path.length)));

const HELD = `${PLANT}catalog.test.mjs`; // a suite's own file the merge base holds, 1,600 lines with no ceiling
const TWIN = `${ADDED}twins/grown/packages/fixture/src/big.ts`;
const SHORT = `${ADDED}short.test.mjs`;
const LONG = `${ADDED}long.test.mjs`;

test(`${AC2} AC2: the size ratchet leaves out a suite's own file the merge base holds over 1,500 lines with no ceiling, and a twin the change adds, and still fails a suite file the change adds over 1,500 lines`, (t) => {
  const cwd = scratch(t, { [HELD]: lines(1600) }, { [SIZE_CEILINGS]: json({}) });

  const held = run(SIZE, cwd);
  assert.deepEqual(naming(held, 'size', HELD), [], `a line names ${HELD}, a suite's own file the merge base holds with no ceiling, which the decision leaves out\n${show(held)}`);
  assertPasses(held, `(the merge base's suite: ${HELD} out)`);

  commit(cwd, { [TWIN]: lines(1600), [SHORT]: lines(20) });
  const twin = run(SIZE, cwd);
  assert.deepEqual(naming(twin, 'size', TWIN), [], `a line names ${TWIN}, a planted twin under a twins/ folder in tests/acceptance/, which is out\n${show(twin)}`);
  assertPasses(twin, `(the change adds the twin ${TWIN}, out, and ${SHORT}, 20 lines)`);

  commit(cwd, { [LONG]: lines(1600) });
  const added = run(SIZE, cwd);
  assert.equal(added.status, 1, `the suite file the change adds runs 1,600 lines, so the ratchet fails\n${show(added)}`);
  assert.ok(failsNaming(added, LONG, 1600), `no FAIL line names ${LONG} and its 1,600 lines, a suite file the change adds over 1,500 lines\n${show(added)}`);
  assert.deepEqual([...naming(added, 'size', TWIN), ...naming(added, 'size', HELD)], [], `a FAIL elsewhere named the twin or the held suite file, both out\n${show(added)}`);
});

test(`${AC2} AC2: the size ratchet still fails an over-long file planted outside tests/acceptance/, in a file the merge base holds and in a new file under a twins/ folder there`, (t) => {
  const OUTSIDE = 'tests/fixture/held.mjs'; // under tests/, outside tests/acceptance/, held at 1,400 lines
  const OUT_TWIN = 'packages/fixture/src/twins/big.ts'; // a twins/ folder outside tests/acceptance/
  const cwd = scratch(t, { [OUTSIDE]: lines(1400) }, { [SIZE_CEILINGS]: json({}) });
  assertPasses(run(SIZE, cwd), `(${OUTSIDE} at 1,400 lines)`);

  put(cwd, OUTSIDE, lines(1600));
  const grown = run(SIZE, cwd);
  assert.equal(grown.status, 1, `${OUTSIDE} grew to 1,600 lines with no ceiling\n${show(grown)}`);
  assert.ok(failsNaming(grown, OUTSIDE, 1600), `no FAIL line names ${OUTSIDE} and its 1,600 lines, a file the merge base holds outside tests/acceptance/ grown over 1,500\n${show(grown)}`);
  put(cwd, OUTSIDE, lines(1400));

  put(cwd, OUT_TWIN, lines(1600));
  const twin = run(SIZE, cwd);
  assert.equal(twin.status, 1, `${OUT_TWIN} runs 1,600 lines with no ceiling\n${show(twin)}`);
  assert.ok(failsNaming(twin, OUT_TWIN, 1600), `no FAIL line names ${OUT_TWIN} and its 1,600 lines: a twins/ folder outside tests/acceptance/ is no planted twin\n${show(twin)}`);
  drop(cwd, OUT_TWIN);
});
