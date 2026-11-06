// #1115: a `skips` entry covers a skip only by its test id and its exact note prefix, on real vitest through the real
// unit lane. Fixture `skips` lists throughout, except the last test, whose criterion names 880's real entries.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, dump, entry, idOf, KNOWN, laneState, lists, LONG, NOT_REFERENCE, sandbox, tree, unit, vitestFile } from './helpers.mjs';

const FILE = 'tests/fixture-1115/gated.test.ts';
const NOTE = 'opt-in: a person sets DEEP_1115_FIXTURE=1';
const gated = vitestFile(`test('the gated test', (ctx) => { ctx.skip('${NOTE} and runs it'); });`);
const GATED = idOf(FILE, 'the gated test');

test('#1115.67b0561c a listed id skipping under a different note than its entry\'s makes the lane INCONCLUSIVE and is listed', LONG, async (t) => {
  const box = sandbox(t);
  const run = await unit(box, tree(box, { [FILE]: gated }, { skips: [entry(GATED, 'opt-in: a person sets DEEP_1115_OTHER=1')] }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'INCONCLUSIVE', `an entry with another note left the lane's state at ${laneState(run.stdout)}\n${all}`);
  assert.ok(lists(run.stdout, GATED, NOTE), `no line lists the skip with the note it skipped under\n${all}`);
});

test('#1115.67b0561c an entry with another id does not cover a skip under its note', LONG, async (t) => {
  const box = sandbox(t);
  const run = await unit(box, tree(box, { [FILE]: gated }, { skips: [entry(idOf(FILE, 'another test'), NOTE)] }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'INCONCLUSIVE', `an entry with another id left the lane's state at ${laneState(run.stdout)}\n${all}`);
});

test('#1115.67b0561c a skip whose id and exact note prefix are listed leaves the lane PASS, and the summary prints it', LONG, async (t) => {
  const box = sandbox(t);
  const run = await unit(box, tree(box, { [FILE]: gated }, { skips: [entry(GATED, NOTE)] }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'PASS', `a listed skip changed the lane's state to ${laneState(run.stdout)}\n${all}`);
  assert.equal(run.status, 0, all);
  assert.ok(lists(run.stdout, GATED, NOTE), `the summary does not print the listed skip with its note\n${all}`);
});

test('#1115.67b0561c a listed skip leaves a lane another skip makes INCONCLUSIVE as it is, and both are printed', LONG, async (t) => {
  const box = sandbox(t);
  const run = await unit(box, tree(box, {
    [FILE]: vitestFile(`test('the gated test', (ctx) => { ctx.skip('${NOTE} and runs it'); });
test('the other test', (ctx) => { ctx.skip('INCONCLUSIVE: a note nothing lists'); });`),
  }, { skips: [entry(GATED, NOTE)] }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'INCONCLUSIVE', `the lane's state is ${laneState(run.stdout)}\n${all}`);
  assert.ok(lists(run.stdout, GATED, NOTE), `the summary does not print the listed skip\n${all}`);
  assert.ok(lists(run.stdout, idOf(FILE, 'the other test'), 'INCONCLUSIVE: a note nothing lists'), `no line lists the unlisted skip\n${all}`);
});

// it.skip and describe.skipIf give no note, as the issue's retired 327 test and DEEP_PI_CLI gate do, so their entries
// hold an empty note. An empty prefix must not cover every note the test may skip under later.
test('#1115.67b0561c a noteless entry covers a noteless skip, and a listed id skipping under a note is a different note', LONG, async (t) => {
  const box = sandbox(t);
  const retired = idOf(FILE, 'the retired test');
  const covered = await unit(box, tree(box, { [FILE]: vitestFile("it.skip('the retired test', () => {});") }, { skips: [entry(retired, '')], name: 'noteless' }));
  const one = dump(covered);
  assert.equal(laneState(covered.stdout), 'PASS', `a noteless skip under its noteless entry left the lane's state at ${laneState(covered.stdout)}\n${one}`);
  assert.ok(lists(covered.stdout, retired), `the summary does not print the listed noteless skip\n${one}`);
  const noted = await unit(box, tree(box, { [FILE]: vitestFile("test('the retired test', (ctx) => { ctx.skip('INCONCLUSIVE: a new reason'); });") }, { skips: [entry(retired, '')], name: 'noted' }));
  const two = dump(noted);
  assert.equal(laneState(noted.stdout), 'INCONCLUSIVE', `an empty note covered a skip under a note, leaving the lane's state at ${laneState(noted.stdout)}\n${two}`);
});

const TOUCH_ID = 'tests/acceptance/880/touch-id.test.ts';
const REDRAFT = 'tests/acceptance/880/redraft/touch-id.test.ts';
// 880's helpers stand in here: the real test files are copied byte for byte, and each skips before it reaches a helper.
const STAND_IN = `const never = () => { throw new Error('the 880 fixture reached a helper, so its skip did not fire'); };
export const cleanup = async () => {};
export const [deep, expectCountedOnce, expectOpen, ready, shown, sleep, childEnv, events, own, run, tempDir] = Array(11).fill(never);
export const MINUTE = 60_000;
export const NODE = process.execPath;
`;

test('#1115.67b0561c with DEEP_880_TOUCH_ID set on a machine that is not the reference Mac, 880\'s listed opt-in entry does not cover its notReference() skip and the lane is INCONCLUSIVE', LONG, async (t) => {
  const box = sandbox(t);
  // The real entries, since the criterion names them. Nothing is listed for them on the base.
  const { skips = [] } = JSON.parse(readFileSync(join(CHECKOUT, KNOWN), 'utf8'));
  const real = [TOUCH_ID, REDRAFT].map((file) => skips.filter(({ id }) => id.startsWith(`${file} › `)));
  assert.ok(real.every((found) => found.length === 1), `${KNOWN} does not hold one skips entry for each of ${TOUCH_ID} and ${REDRAFT}: ${JSON.stringify(real)}`);
  const ids = real.map(([{ id }]) => id);
  const fixture = tree(box, {
    'tests/acceptance/880/helpers.ts': STAND_IN,
    [TOUCH_ID]: readFileSync(join(CHECKOUT, TOUCH_ID), 'utf8'),
    [REDRAFT]: readFileSync(join(CHECKOUT, REDRAFT), 'utf8'),
  }, { skips: real.flat(), sysctl: NOT_REFERENCE });

  const unset = await unit(box, fixture);
  const off = dump(unset);
  assert.equal(laneState(unset.stdout), 'PASS', `with the variable unset, 880's entries do not cover its opt-in skips, leaving the lane's state at ${laneState(unset.stdout)}\n${off}`);
  for (const id of ids) assert.ok(lists(unset.stdout, id), `with the variable unset, the summary does not print ${id}\n${off}`);

  const set = await unit(box, fixture, { DEEP_880_TOUCH_ID: '1' });
  const on = dump(set);
  assert.equal(laneState(set.stdout), 'INCONCLUSIVE', `with the variable set, the lane's state is ${laneState(set.stdout)}\n${on}`);
  assert.notEqual(set.status, 0, on);
  const note = process.platform === 'darwin' ? 'INCONCLUSIVE: not a reference Mac' : 'INCONCLUSIVE: platform';
  for (const id of ids) assert.ok(lists(set.stdout, id, note), `no line lists ${id} with its notReference() note\n${on}`);
});
