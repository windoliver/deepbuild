// AC3 (#1121.95fa4a52): the Mac's cargo test writes `cargo test -- --list` per target into its evidence record, and a
// Spark run's record lists the tests absent by platform by comparison with it, its lane INCONCLUSIVE (platform), never
// PASS. The real runLanes runs the real cargo on a small workspace in which the Mac has four whole test files and two
// single tests that Linux lacks.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ABSENT, cargoLane, elsewhere, idsOf, laneLines, LINUX_LIST, MAC, MAC_LIST, macRecord, MINUTES, namesPlatform, PLATFORM, records, runCargoLane, sandbox, SPARK, workspace,
} from './helpers.mjs';

const sorted = (list) => Object.fromEntries(Object.entries(list ?? {}).filter(([, names]) => names.length).map(([target, names]) => [target, [...names].sort()]).sort(([a], [b]) => a.localeCompare(b)));
const rows = (record, ids) => (record.tests ?? []).filter(({ id }) => ids.includes(id));

test('#1121.95fa4a52 the Mac\'s cargo test writes each target\'s `cargo test -- --list` into its evidence record', MINUTES, async (t) => {
  if (PLATFORM !== MAC) return t.skip(elsewhere('the reference list\'s machine, a Mac'));
  const box = sandbox(t), { cwd, tree } = workspace(box);
  const { name } = await cargoLane(box);
  const { status, stdout } = await runCargoLane(box, cwd);
  const mine = records(box).filter((record) => record.platform === MAC && record.tree === tree && record.lane === name);
  assert.equal(mine.length, 1, `the ${name} lane wrote one evidence record of this tree on ${MAC}; the run printed:\n${stdout}`);
  const [record] = mine;
  // The run itself: every test the Mac has ran and passed, so the list below is of a run that stands.
  assert.deepEqual(rows(record, idsOf(MAC_LIST)).map(({ id, state }) => `${state} ${id}`).sort(), idsOf(MAC_LIST).map((id) => `PASS ${id}`), `each of the Mac's nine tests passed in the record (exit ${status}):\n${stdout}`);
  assert.ok(record.list && typeof record.list === 'object' && !Array.isArray(record.list), `the Mac's record holds no reference list: its keys are ${Object.keys(record).join(', ')}, and \`list\` is ${JSON.stringify(record.list)}`);
  assert.deepEqual(sorted(record.list), sorted(MAC_LIST), 'the record\'s list names, per target, the tests `cargo test -- --list` names there');
});

test('#1121.95fa4a52 a Spark run\'s record lists each test absent by platform against the Mac\'s list, and its lane is INCONCLUSIVE (platform), not PASS', MINUTES, async (t) => {
  if (PLATFORM !== SPARK) return t.skip(elsewhere('the Spark, Linux on aarch64'));
  const box = sandbox(t), { cwd, tree } = workspace(box);
  const { name } = await cargoLane(box);
  macRecord(box, tree, name);
  const { status, stdout } = await runCargoLane(box, cwd);
  const mine = records(box).filter((record) => record.platform === SPARK && record.tree === tree);
  assert.equal(mine.length, 1, `the Spark's run wrote one evidence record of this tree; the run printed:\n${stdout}`);
  const [record] = mine;
  // What Linux has ran and passed, its own test among them: only what the Mac's list names and Linux lacks is absent.
  assert.deepEqual(rows(record, idsOf(LINUX_LIST)).map(({ id, state }) => `${state} ${id}`).sort(), idsOf(LINUX_LIST).map((id) => `PASS ${id}`), `each of Linux's four tests passed in the record:\n${stdout}`);
  const absent = rows(record, ABSENT);
  assert.deepEqual(absent.map(({ id }) => id).sort(), ABSENT, `the record lists the six tests absent by platform, four whole test files' and two single tests; its tests are ${JSON.stringify(record.tests, null, 1)}`);
  for (const row of absent) {
    assert.equal(row.state, 'INCONCLUSIVE', `${row.id} never ran here, so it is INCONCLUSIVE, never PASS`);
    assert.equal(row.skipped, true, `${row.id} never ran here, so its row says skipped`);
    assert.ok(namesPlatform(row.note), `${row.id}'s note says the platform lacks it: ${JSON.stringify(row.note)}`);
  }
  assert.deepEqual((record.tests ?? []).filter(({ state }) => state !== 'PASS').map(({ id }) => id).sort(), ABSENT, 'no other test is short of PASS');
  assert.equal(record.state, 'INCONCLUSIVE', 'the record\'s lane is INCONCLUSIVE');
  assert.deepEqual(laneLines(stdout, name).map((line) => line.slice(0, `INCONCLUSIVE ${name} (platform)`.length)), [`INCONCLUSIVE ${name} (platform)`], `the run gives the lane one state, INCONCLUSIVE (platform):\n${stdout}`);
  assert.notEqual(status, 0, 'a lane short of PASS exits non-zero');
});

test('#1121.95fa4a52 a Spark run with no reference list from the Mac is never PASS', MINUTES, async (t) => {
  if (PLATFORM !== SPARK) return t.skip(elsewhere('the Spark, Linux on aarch64'));
  const box = sandbox(t), { cwd, tree } = workspace(box);
  const { name } = await cargoLane(box);
  const { status, stdout } = await runCargoLane(box, cwd);
  const lines = laneLines(stdout, name);
  assert.equal(lines.length, 1, `the run gives the lane one state:\n${stdout}`);
  assert.match(lines[0], /^(?:INCONCLUSIVE|BLOCKED) /, `a Spark cargo test compared with nothing proves nothing of the tests Linux lacks: ${lines[0]}`);
  assert.notEqual(status, 0, 'a lane short of PASS exits non-zero');
  for (const record of records(box).filter((one) => one.platform === SPARK && one.tree === tree)) assert.match(record.state, /^(?:INCONCLUSIVE|BLOCKED)$/, 'and its record is never PASS');
});
