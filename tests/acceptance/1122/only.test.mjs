// #1122: a PR's unit verdict is the Spark's run merged with the Mac's `--only` run, and it equals a full Mac run of the
// same tree (docs/parallel-proof.md, section 8, "Merged per test"). Each scene is a session's worktree carrying this
// checkout's scripts/ and a small suite: a test that reaches a source reading `process.platform`, a test only a Mac
// with Metal can run, and a test that reaches neither. In each:
//   1. the real unit lane runs whole on this Mac (runLanes), and its record is the full Mac run;
//   2. that record is set aside, and the Spark's record of the tree is planted as fetched (<tree>-unit-spark.json):
//      the full run's own rows, with the Metal test skipped and the scene's Linux reading of the other rows;
//   3. the real `node scripts/lane-remote.mjs --only unit` runs, and its merged line, its exit status and
//      mergeRecords(tree) are compared with the full run's state.
// The Spark's record is the one thing not run for real (README: What stays unproven).
import assert from 'node:assert/strict';
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, exactTree, EXIT, forget, fullRun, idOf, laneRemote, lanesFolder, lines, LONG, mergeOf, notOnMac, onlyNames, plant, ran, record, sandbox, sparkRecord, verdictLine, vitestFile, worktree, worst } from './helpers.mjs';

const PLATFORM = 'tests/fixture-1122/platform.test.ts', METAL = 'tests/fixture-1122/metal.test.ts', PLAIN = 'tests/fixture-1122/plain.test.ts';
const IDS = { platform: idOf(PLATFORM, 'the users folder exists'), metal: idOf(METAL, 'draws on Metal'), plain: idOf(PLAIN, 'adds') };
const SKIP = 'INCONCLUSIVE: no Metal on this machine';

/** The suite. `mac` is the folder the darwin-only branch names, `metal` and `sum` what the other two tests expect. */
const suite = ({ mac = '/Users', other = '/home', metal = 2, sum = 2 } = {}) => ({
  // A source that reads process.platform: the darwin branch runs only on the Mac.
  'src/folders.ts': `export const users = (): string => (process.platform === 'darwin' ? '${mac}' : '${other}');\n`,
  'src/sum.ts': 'export const sum = (a: number, b: number): number => a + b;\n',
  [PLATFORM]: vitestFile(`import { users } from '../../src/folders.ts';\ntest('the users folder exists', () => { ran1122('platform'); expect(existsSync(users())).toBe(true); });`),
  [METAL]: vitestFile(`const metal = existsSync('/System/Library/Frameworks/Metal.framework');\ntest('draws on Metal', (ctx) => { if (!metal) ctx.skip('${SKIP}'); ran1122('metal'); expect(1 + 1).toBe(${metal}); });`),
  [PLAIN]: vitestFile(`import { sum } from '../../src/sum.ts';\ntest('adds', () => { ran1122('plain'); expect(sum(1, 1)).toBe(${sum}); });`),
});

/** Steps 1 and 2: the full Mac run's state and rows, set aside, and the Spark's record planted as fetched. */
async function fullThenSpark(t, box, session, linux) {
  const tree = exactTree(box, session.cwd);
  const whole = await fullRun(box, session.cwd);
  const full = record(box.home, `${tree}-unit.json`);
  assert.ok(full, `the full Mac run of the unit lane wrote its record, <tree>-unit.json\n${dump(whole)}`);
  for (const id of Object.values(IDS)) assert.ok(full.tests.some((row) => row.id === id && !row.skipped), `the full Mac run ran ${id}: ${JSON.stringify(full.tests)}`);
  renameSync(join(lanesFolder(box.home), `${tree}-unit.json`), join(box.dir, 'full-mac-run.json'));
  forget(box.home);
  // What the Spark reads of the same tree: the Metal test skipped, and `linux` for each row a Linux run reads otherwise.
  const rows = full.tests.map((row) => (row.id === IDS.metal ? { id: row.id, state: 'INCONCLUSIVE', note: SKIP, skipped: true } : linux[row.id] ? { id: row.id, ...linux[row.id] } : row));
  plant(box.home, sparkRecord(tree, 'unit', worst(rows.map(({ state }) => state)), rows));
  return { tree, full };
}

/** Step 3, and the comparison: the merged verdict is the full Mac run's. */
async function mergedEqualsFull(t, files, linux, expected) {
  const box = sandbox(t);
  const session = worktree(box, { files });
  const { tree, full } = await fullThenSpark(t, box, session, linux);
  assert.equal(full.state, expected, `the full Mac run of this scene reads ${expected}: ${JSON.stringify(full.tests)}`);

  const run = await laneRemote(box, session.cwd, ['--only', 'unit']);
  const merged = verdictLine(run, 'unit', ' (merged)');
  assert.equal(merged, full.state, `node scripts/lane-remote.mjs --only unit ends with "${full.state} unit (merged)", the full Mac run's state\n${dump(run)}`);
  assert.equal(lines(run).at(-1), `${full.state} unit (merged)`, `the merged line is the run's last\n${dump(run)}`);
  assert.equal(run.status, EXIT[full.state], `the run exits by the merged state\n${dump(run)}`);
  assert.equal(mergeOf(box, tree).state, full.state, 'mergeRecords(tree) reads the full Mac run\'s state');
  return { box, tree, run };
}

/** The Mac's --only record: it ran the platform-branching test and the one the Spark skipped, and not the third. */
function narrowed({ box, tree, run }) {
  const mac = record(box.home, `${tree}-unit.json`);
  assert.ok(mac && String(mac.platform).startsWith('darwin'), `the --only run wrote the Mac's record of the lane, <tree>-unit.json\n${dump(run)}`);
  const names = onlyNames(mac.only);
  assert.ok(names.includes(PLATFORM) && names.includes(METAL), `the record's "only" names the files it ran, the test reaching a process.platform source and the one the Spark skipped: ${JSON.stringify(mac.only)}`);
  assert.deepEqual([...new Set(ran(box.home).map(({ name }) => name))].sort(), ['metal', 'platform'], `the --only run ran those two tests and no other\n${dump(run)}`);
}

test('#1122.7d260bb4 a tree that passes: the merged unit verdict is PASS, as the full Mac run of the same tree', { ...LONG, skip: notOnMac() }, async (t) => {
  narrowed(await mergedEqualsFull(t, suite(), {}, 'PASS'));
});

test('#1122.7d260bb4 a bug in a darwin-only branch, which the Spark passes: the merged unit verdict is FAIL, as the full Mac run', { ...LONG, skip: notOnMac() }, async (t) => {
  // The Spark runs the other branch, so its row of the test is PASS; only the Mac's --only run of it can fail.
  narrowed(await mergedEqualsFull(t, suite({ mac: '/no-such-folder-1122' }), { [IDS.platform]: { state: 'PASS' } }, 'FAIL'));
});

test('#1122.7d260bb4 a failing test the Spark skipped: the merged unit verdict is FAIL, as the full Mac run', { ...LONG, skip: notOnMac() }, async (t) => {
  narrowed(await mergedEqualsFull(t, suite({ metal: 3 }), {}, 'FAIL'));
});

test('#1122.7d260bb4 a failing test only the Spark ran: the merged unit verdict is FAIL, as the full Mac run', { ...LONG, skip: notOnMac() }, async (t) => {
  narrowed(await mergedEqualsFull(t, suite({ sum: 3 }), {}, 'FAIL'));
});

test('#1122.e6c3b0b8 the Spark\'s FAIL of a test the Mac\'s --only run passes merges to FAIL: "FAIL unit (merged)", exit 1', { ...LONG, skip: notOnMac() }, async (t) => {
  const box = sandbox(t);
  // A bug in the branch only the Spark runs: the test fails there and passes on the Mac.
  const session = worktree(box, { files: suite({ other: '/no-such-folder-1122' }) });
  const { tree } = await fullThenSpark(t, box, session, { [IDS.platform]: { state: 'FAIL', note: 'AssertionError: expected false to be true' } });

  const run = await laneRemote(box, session.cwd, ['--only', 'unit']);
  const mac = record(box.home, `${tree}-unit.json`);
  assert.equal(mac?.tests?.find(({ id }) => id === IDS.platform)?.state, 'PASS', `the Mac's --only run ran the same test id and passed it\n${dump(run)}`);
  assert.equal(verdictLine(run, 'unit', ' (merged)'), 'FAIL', `the Spark's FAIL wins: "FAIL unit (merged)"\n${dump(run)}`);
  assert.equal(run.status, 1, `the run exits 1\n${dump(run)}`);
  assert.equal(mergeOf(box, tree).state, 'FAIL', 'mergeRecords(tree) reads FAIL');
});

test('#1122.7d260bb4 with no fetched record of the tree and lane, --only runs nothing: BLOCKED lane-remote, exit 3', { ...LONG, skip: notOnMac() }, async (t) => {
  const box = sandbox(t);
  const session = worktree(box, { files: suite() });
  const run = await laneRemote(box, session.cwd, ['--only', 'unit']);
  assert.ok(lines(run).some((line) => line.startsWith('BLOCKED lane-remote')), `the run reads "BLOCKED lane-remote"\n${dump(run)}`);
  assert.equal(run.status, 3, `the run exits 3\n${dump(run)}`);
  assert.deepEqual(ran(box.home), [], 'no test ran');
  assert.notEqual(verdictLine(run, 'unit', ' (merged)'), 'PASS', 'nothing unrun passes');
});
