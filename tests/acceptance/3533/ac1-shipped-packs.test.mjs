// AC1: with the list as it is on main (the base), the lane fails naming each pack folder whose name reads as listed,
// before it reads the change; after the decision it passes on main. Which folders, and which words, are read at run
// time from the base, so the tests hold whether the packs are renamed or the list drops their names (README).
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, LIST, baseList, basePackFolders, cleanChange, commit, laneEnv, makeCopy, namesFolder, readList, readsAsListed, restoreBase, runLane, withhold } from './helpers.mjs';

const ID = '#3533.4fe1349f';
const BASE_LIST = baseList();
const HEAD_LIST = readList(CHECKOUT);
const LISTS = [BASE_LIST, HEAD_LIST];
const show = (text) => withhold(text, LISTS);
// The base's pack folders whose name reads as listed in the base's list.
const READ = basePackFolders().filter((folder) => readsAsListed(BASE_LIST, folder));
const packName = (folder) => folder.replace(/-\d+(?:\.\d+)*$/, '');

/** A copy holding the implementation with the base's packs/ and list, committed as origin/main unless `noBase`. */
function baseState(t, { noBase = false } = {}) {
  const { sandbox, repo } = makeCopy(t);
  restoreBase(repo);
  commit(repo, 'The base', { base: !noBase });
  return { repo, env: laneEnv(sandbox) };
}

function assertNamesEach(run, what) {
  const unnamed = READ.filter((folder) => !run.lines.some((line) => namesFolder(line, folder)));
  assert.ok(!unnamed.length, `${what}, the lane's output names ${READ.length - unnamed.length} of the ${READ.length} pack folders that read as listed; it misses ${unnamed.map((f) => `packs/${show(f)}`).join(', ')}:\n${show(run.output)}`);
}

test(`${ID} AC1: with the base's list and packs, the lane fails on a change that names no product, naming each pack folder that reads as listed`, (t) => {
  // The fixture, read as the issue counts it: three packs (a pack's versions are one pack).
  assert.ok(new Set(READ.map(packName)).size === 3, `the base's pack folders that read as listed are ${READ.map((f) => show(f)).join(', ')}, not three packs`);
  const { repo, env } = baseState(t);
  cleanChange(repo);
  const run = runLane(repo, env);
  // A lane that never reads the pack folders passes here.
  assert.ok(run.status !== 0 && run.states.includes('FAIL'), `the lane doesn't fail (exit ${run.status}, ${run.states.join(' ') || 'no verdict'}):\n${show(run.output)}`);
  assertNamesEach(run, 'With a change that names no product');
});

test(`${ID} AC1: with the base's list and packs, the lane fails naming each pack folder that reads as listed before it reads the change, even when the change can't be worked out`, (t) => {
  // No origin/main: the lane can't work out the change. The pack folders are read first, so they still fail it.
  const { repo, env } = baseState(t, { noBase: true });
  const run = runLane(repo, env);
  // A lane that reads the packs only after the change, or not at all, ends INCONCLUSIVE here without naming them.
  assert.ok(run.status !== 0 && run.states.includes('FAIL'), `the lane doesn't fail on the pack folders when the change can't be read (exit ${run.status}, ${run.states.join(' ') || 'no verdict'}):\n${show(run.output)}`);
  assertNamesEach(run, 'With no merge base');
});

test(`${ID} AC1: after the decision, no folder packs/ ships reads as listed in ${LIST}`, () => {
  const folders = readdirSync(join(CHECKOUT, 'packs')).filter((name) => statSync(join(CHECKOUT, 'packs', name)).isDirectory());
  const read = folders.filter((folder) => readsAsListed(HEAD_LIST, folder));
  assert.ok(!read.length, `${read.length} of the ${folders.length} pack folders still read as listed: ${read.map((f) => `packs/${show(f)}`).join(', ')}`);
});

test(`${ID} AC1: after the decision, the lane passes on main with a change that names no product`, (t) => {
  const { sandbox, repo } = makeCopy(t);
  commit(repo, 'Main after the decision', { base: true });
  cleanChange(repo);
  const run = runLane(repo, laneEnv(sandbox));
  assert.ok(run.status === 0 && run.states[0] === 'PASS', `the lane doesn't pass on main after the decision (exit ${run.status}, ${run.states.join(' ') || 'no verdict'}):\n${show(run.output)}`);
});
