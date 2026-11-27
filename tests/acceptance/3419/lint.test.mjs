// #3419 criterion 5 (#3419.9ce8f264): a change that adds a suite and lists it in lanes-lists.mjs as alone fails the
// lint lane, naming the entry and the suite's lane.json; the same entry for a folder that held a file at the merge
// base passes. The lint lane is reached as affected.mjs reaches it: each command of the scene's own lanes.mjs `checks`
// lint lane whose script is under scripts/, run in the scene (README, "What I chose"). Many of them can't read a
// scratch repository (no crates, docs or builds) and fail there whatever the change; so "passes" is read against the
// same scene with no entry: every command exits as it does there, and no finding names the entry that didn't there.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, OTHER, OWN, lintLane, scene, testFile } from './helpers.mjs';

const lists = readFileSync(join(CHECKOUT, 'scripts/lanes-lists.mjs'), 'utf8');
const lanes = readFileSync(join(CHECKOUT, 'scripts/lanes.mjs'), 'utf8');
const OPEN = 'export const alone = [';

/** lanes-lists.mjs with `entry` first in its alone list, as a hand would add it. */
const withEntry = (entry) => lists.replace(OPEN, `${OPEN}${JSON.stringify(entry).replace(/"/g, "'")}, `);
/** lanes.mjs with the entry's reason named, so the alone lint's reason check has nothing to say of it. */
const withReason = (entry) => `${lanes}\naloneReasons[${JSON.stringify(entry).replace(/"/g, "'")}] = 'shared: the planted port';\n`;
const findings = (run, entry) => run.flatMap(({ output }) => output.split('\n').filter((line) => /^(?:FAIL|BLOCKED|INVALID|INCONCLUSIVE)\b/.test(line) && line.includes(entry)));
const shown = (run) => run.map(({ label, status, output }) => `--- ${label}: exit ${status}\n${output.split('\n').filter((line) => line.includes('tests/acceptance/94')).join('\n')}`).join('\n');

test("#3419.9ce8f264 an alone entry in lanes-lists.mjs for a suite the change adds fails the lint lane, naming the entry and the suite's lane.json; the same entry for a folder that held a file at the merge base passes", async (t) => {
  assert.ok(lists.includes(OPEN), `this checkout's scripts/lanes-lists.mjs holds no "${OPEN}", where the entry goes`);
  const added = `tests/acceptance/${OWN}/`;
  const box = scene(t, { commits: [{ files: { [`${added}suite.test.mjs`]: testFile(), 'scripts/lanes-lists.mjs': withEntry(added), 'scripts/lanes.mjs': withReason(added) } }] });
  const run = await lintLane(box);
  const named = run.filter(({ status, output }) => status !== 0 && output.split('\n').some((line) => /^FAIL\b/.test(line) && line.includes(added)) && output.includes(`${added}lane.json`));
  assert.ok(named.length, `no lint-lane command fails with a FAIL line naming the entry ${added} and output naming ${added}lane.json\n${shown(run)}`);

  const landed = `tests/acceptance/${OTHER}/`;
  const base = { [`${landed}suite.test.mjs`]: testFile() };
  const withIt = await lintLane(scene(t, { base, issue: OTHER, commits: [{ files: { 'scripts/lanes-lists.mjs': withEntry(landed), 'scripts/lanes.mjs': withReason(landed) } }] }));
  const without = await lintLane(scene(t, { base, issue: OTHER, commits: [{ files: { 'scripts/lanes.mjs': withReason(landed) } }] }));
  const status = (run) => Object.fromEntries(run.map(({ label, status }) => [label, status]));
  assert.deepEqual(status(withIt), status(without), `the lint lane's commands exit otherwise with the alone entry ${landed}, a folder that held a file at the merge base, than without it\n${shown(withIt)}`);
  const before = new Set(findings(without, landed).map((line) => line.replaceAll(without.cwd, '<scene>')));
  const fresh = findings(withIt, landed).map((line) => line.replaceAll(withIt.cwd, '<scene>')).filter((line) => !before.has(line));
  assert.deepEqual(fresh, [], `the lint lane finds the alone entry ${landed}, a folder that held a file at the merge base`);
});
