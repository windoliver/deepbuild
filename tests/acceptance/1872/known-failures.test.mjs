// #1872, criteria 3 and 4: every key of scripts/known-failures.json is guarded. An entry added, or changed in any way
// but a `lint` count that falls, fails the guard with no signed approval tag naming it; a removed entry or a lowered
// count passes with none. Reached by running this checkout's real `node scripts/proof.mjs guard` in scratch
// repositories (README: The guard, and How an approval names an entry).
import test from 'node:test';
import { day, expectPassed, expectRefused, guardRepo, idOf, KNOWN, known, LONG, namesKey, nodeFile, note, sandbox } from './helpers.mjs';

// The change's own test, which fails, and the entry that would list it as failing on main already.
const OWN = 'tests/fixture-1872/own.test.mjs';
const OWN_ID = idOf(OWN, "the change's own test");
const OWN_TEST = nodeFile(`test(${JSON.stringify("the change's own test")}, () => { assert.equal(1, 2); });`);

/** A change whose first commit adds its own failing test and whose second lists that test under `failures`. */
function listsItsOwnFailure(box, before = {}) {
  const scene = guardRepo(box, { [KNOWN]: known(before) });
  scene.commit({ [OWN]: OWN_TEST }, 'Add the change\'s own test');
  const listing = scene.commit({ [KNOWN]: known({ ...before, failures: { ...before.failures, [OWN_ID]: note('fails on main') } }) }, 'List the failure');
  return { scene, listing };
}

test('#1872.51c82c1d a planted commit that adds its own failing test\'s ID to failures, naming an open issue and today\'s date, fails the guard with no signed approval tag, naming the entry', LONG, async (t) => {
  const { scene } = listsItsOwnFailure(sandbox(t));
  expectRefused(await scene.guard(), 'a failures entry for the change\'s own test, with no tag,', [KNOWN, OWN_ID]);
});

test('#1872.51c82c1d the same commit under an unsigned approval tag naming the entry fails the guard, naming the entry', LONG, async (t) => {
  const { scene, listing } = listsItsOwnFailure(sandbox(t));
  scene.approve(listing, [`${KNOWN} › ${OWN_ID}`], null);
  expectRefused(await scene.guard(), 'a failures entry under an unsigned tag', [KNOWN, OWN_ID]);
});

test('#1872.51c82c1d the same commit under a signed approval tag naming the entry passes the guard', LONG, async (t) => {
  const { scene, listing } = listsItsOwnFailure(sandbox(t));
  scene.approve(listing, [`${KNOWN} › ${OWN_ID}`]);
  expectPassed(await scene.guard(), 'a failures entry under a signed tag naming it', [KNOWN]);
});

// A main whose file lists one entry under each key; ids hold none of the key names, so a line naming a key names it.
const FAILING = idOf('tests/fixture-1872/listed.test.mjs', 'a listed test');
const TIMED = idOf('tests/fixture-1872/slow.test.mjs', 'a timed budget');
const FINDING = 'fixture-check: src/a.rs a finding';
const ON_MAIN = { failures: { [FAILING]: note('fails on main', day(-3)) }, lint: { [FINDING]: 2 }, timing: [TIMED] };

const LOOSER = [
  ['a lint count raised', 'lint', { ...ON_MAIN, lint: { [FINDING]: 3 } }],
  ['a lint finding added', 'lint', { ...ON_MAIN, lint: { [FINDING]: 2, 'fixture-check: src/b.rs another finding': 1 } }],
  ['a timing ID added', 'timing', { ...ON_MAIN, timing: [TIMED, idOf('tests/fixture-1872/other.test.mjs', 'another timed budget')] }],
  ['a failures entry\'s date moved later', 'failures', { ...ON_MAIN, failures: { [FAILING]: note('fails on main', day(0)) } }],
];

test('#1872.938914d1 a planted commit that raises a lint count, adds a timing ID, or moves a failures entry\'s date later fails the guard with no tag, naming the key', LONG, async (t) => {
  for (const [what, key, after] of LOOSER) {
    await t.test(what, async (t) => {
      const scene = guardRepo(sandbox(t), { [KNOWN]: known(ON_MAIN) });
      scene.commit({ [KNOWN]: known(after) });
      expectRefused(await scene.guard(), `${what}, with no tag,`, [KNOWN, namesKey(key)]);
    });
  }
});

const TIGHTER = [
  ['a failures entry removed', { ...ON_MAIN, failures: {} }],
  ['a timing ID removed', { ...ON_MAIN, timing: [] }],
  ['a lint entry removed', { ...ON_MAIN, lint: {} }],
  ['a lint count lowered', { ...ON_MAIN, lint: { [FINDING]: 1 } }],
];

test('#1872.938914d1 a planted commit that removes an entry or lowers a count passes the guard with no tag', LONG, async (t) => {
  for (const [what, after] of TIGHTER) {
    await t.test(what, async (t) => {
      const scene = guardRepo(sandbox(t), { [KNOWN]: known(ON_MAIN) });
      scene.commit({ [KNOWN]: known(after) });
      expectPassed(await scene.guard(), `${what}, with no tag,`);
    });
  }
});
