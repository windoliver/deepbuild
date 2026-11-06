// #1115: each lane writes an evidence record naming host, platform, tree hash and every test's state. Reached by running
// the real runLanes, and read from the sandbox's ~/.deepbuild/lanes/ (README: The surface).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dump, entry, gitIn, idOf, laneState, lanes, LONG, nodeFile, recordOf, sandbox, tree, unit, vitestFile } from './helpers.mjs';

const VITEST = 'tests/fixture-1115/states.test.ts';
const NODE = 'tests/fixture-1115-states.test.mjs';
const LISTED_NOTE = 'opt-in: a person sets DEEP_1115_FIXTURE=1';
// What cargo test prints, by the stub (helpers.mjs): a passing test and a failing one.
const CARGO = `     Running unittests src/lib.rs (target/debug/deps/deep_fixture-0123456789abcdef)

running 2 tests
test fixture_cargo_fails ... FAILED
test fixture_cargo_passes ... ok

failures:

failures:
    fixture_cargo_fails

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

error: test failed, to rerun pass \`-p deep-fixture --lib\`
`;

function assertNames(record, cwd) {
  assert.equal(record.host, hostname(), `the record's host: ${JSON.stringify(record)}`);
  assert.ok(String(record.platform).startsWith(process.platform), `the record's platform doesn't name ${process.platform}: ${JSON.stringify(record)}`);
  assert.equal(record.tree, gitIn(cwd)('rev-parse', 'HEAD^{tree}').trim(), `the record's tree is not the tree hash of the clean checkout that ran: ${JSON.stringify(record)}`);
  assert.ok(Array.isArray(record.tests), `the record's tests are no list: ${JSON.stringify(record)}`);
}

test('#1115.b81207df the unit lane\'s evidence record names host, platform, tree hash and every test\'s state, from vitest, node --test and cargo', LONG, async (t) => {
  const box = sandbox(t);
  const cargo = join(box.dir, 'cargo-output');
  writeFileSync(cargo, CARGO);
  const fixture = tree(box, {
    [VITEST]: vitestFile(`test('passes', () => { expect(1).toBe(1); });
test('fails', () => { expect(1).toBe(2); });
test('fails inconclusive', () => { expect.fail('INCONCLUSIVE: the fixture could not read it'); });
test('fails blocked', () => { expect.fail('BLOCKED: the fixture has no toolchain'); });
test('skips', (ctx) => { ctx.skip('INCONCLUSIVE: unrun here'); });
test('skips blocked', (ctx) => { ctx.skip('BLOCKED: no record on the fixture machine'); });
test('skips listed', (ctx) => { ctx.skip('${LISTED_NOTE}'); });`),
    [NODE]: nodeFile(`test('passes', () => { assert.equal(1, 1); });
test('fails', () => { assert.equal(1, 2); });
test('fails inconclusive', () => { assert.fail('INCONCLUSIVE: the fixture could not read it'); });
test('fails blocked', () => { assert.fail('BLOCKED: the fixture has no toolchain'); });
test('skips', (t) => { t.skip('INCONCLUSIVE: unrun here'); });
test('skips blocked', { skip: 'BLOCKED: no record on the fixture machine' }, () => {});
test('skips listed', (t) => { t.skip('${LISTED_NOTE}'); });`),
  }, { skips: [entry(idOf(VITEST, 'skips listed'), LISTED_NOTE), entry(idOf(NODE, 'skips listed'), LISTED_NOTE)] });
  const run = await unit(box, fixture, { T1115_CARGO: cargo, T1115_CARGO_STATUS: '101' });
  const record = recordOf(box, 'unit', run);
  assertNames(record, fixture.cwd);
  const stateOf = new Map(record.tests.map(({ id, state }) => [id, state]));
  const shown = JSON.stringify(record, null, 1);
  for (const file of [VITEST, NODE]) {
    const want = { passes: 'PASS', fails: 'FAIL', 'fails inconclusive': 'INCONCLUSIVE', 'fails blocked': 'BLOCKED', skips: 'INCONCLUSIVE', 'skips blocked': 'BLOCKED' };
    for (const [name, state] of Object.entries(want)) assert.equal(stateOf.get(idOf(file, name)), state, `${idOf(file, name)} in the record\n${shown}`);
    const listed = stateOf.get(idOf(file, 'skips listed'));
    assert.ok(listed && listed !== 'PASS', `the listed skip ${idOf(file, 'skips listed')} is unrun, so it is present and never PASS: ${listed}\n${shown}`);
  }
  const cargoState = (name) => record.tests.find(({ id }) => id.includes(name))?.state;
  assert.equal(cargoState('fixture_cargo_passes'), 'PASS', `the cargo test that passed\n${shown}`);
  assert.equal(cargoState('fixture_cargo_fails'), 'FAIL', `the cargo test that failed\n${shown}`);
  assert.equal(record.state, 'FAIL', `the record's state is the lane's\n${shown}`);
  assert.equal(laneState(run.stdout), 'FAIL', dump(run));
});

test('#1115.b81207df a passing unit lane\'s record holds each of its tests PASS', LONG, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, {});
  const run = await unit(box, fixture);
  assert.equal(laneState(run.stdout), 'PASS', dump(run));
  const record = recordOf(box, 'unit', run);
  assertNames(record, fixture.cwd);
  assert.equal(record.state, 'PASS', JSON.stringify(record));
  // The tree's three files, one per command of the lane that runs tests (helpers.mjs).
  assert.ok(record.tests.length >= 3, `the record holds ${record.tests.length} tests of the 3 that ran: ${JSON.stringify(record)}`);
  assert.deepEqual([...new Set(record.tests.map(({ state }) => state))], ['PASS'], JSON.stringify(record));
});

test('#1115.b81207df each lane writes a record, a lane that fails and one that ran nothing too, with no test list to fill', LONG, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, { 'ok.mjs': 'console.log("ok");\n', 'fails.mjs': 'console.log("FAIL the fixture check"); process.exit(1);\n' });
  const run = await lanes(box, fixture, [
    { name: 'fixture passes', commands: [[process.execPath, 'ok.mjs']], fix: 'None.' },
    { name: 'fixture fails', commands: [[process.execPath, 'fails.mjs']], fix: 'None.' },
    { name: 'fixture unrun', commands: [], fix: 'None.' },
  ]);
  for (const [lane, state] of [['fixture passes', 'PASS'], ['fixture fails', 'FAIL'], ['fixture unrun', 'BLOCKED']]) {
    const record = recordOf(box, lane, run);
    assertNames(record, fixture.cwd);
    assert.equal(record.state, state, `${lane}: ${JSON.stringify(record)}`);
    assert.equal(laneState(run.stdout, lane), state, dump(run));
  }
});
