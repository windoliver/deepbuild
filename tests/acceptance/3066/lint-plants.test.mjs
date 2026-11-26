// #3066 AC1, second sentence, and AC3: plants in a scene's scripts/lanes.mjs, read by the scene's own lint lane.
// AC1: a planted alone entry with no reason, and one with a fourth reason, each fail the lint lane, naming the entry.
// AC3: no timing or shared entry moves: a planted move of #236's folder, and of a timing entry, fails the lint lane.
// A scene holds a copy of this checkout's scripts/ on origin/main and the plant as a commit on top (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, LONG, adds, failsNaming, lanesOf, lint, moves, plant, scene, shown } from './helpers.mjs';

const suite = (n) => `import assert from 'node:assert/strict';\nimport test from 'node:test';\n\ntest('the planted suite of #${n} holds', () => {\n  assert.equal(1 + 1, 2);\n});\n`;
const folder = (n) => `tests/acceptance/${n}/`;
const file = (n) => `${folder(n)}suite.test.mjs`;

test('#3066.08445d81 a planted alone entry with no reason fails the lint lane, naming the entry', LONG, async (t) => {
  const box = scene(t, { [file(9365)]: suite(9365), [file(9366)]: suite(9366) });
  // An entry that names its reason is no finding, so the lint lane names an entry for its missing reason alone.
  plant(box, 'an alone entry with the reason timing', [adds(folder(9365), 'timing')]);
  const explained = await lint(box);
  assert.deepEqual(failsNaming(explained, 'tests/acceptance/9365'), [], `the lint lane fails naming ${folder(9365)}, an alone entry planted with the reason timing\n${shown(explained)}`);

  plant(box, 'an alone entry with no reason', [adds(folder(9366))]);
  assert.ok(lanesOf(box.cwd, { env: box.env }).lists.alone.includes(folder(9366)), `the planted lanes.mjs does not hold ${folder(9366)} in alone`);
  const runs = await lint(box);
  assert.notDeepEqual(failsNaming(runs, 'tests/acceptance/9366'), [], `no command of the lint lane fails naming ${folder(9366)}, an alone entry planted with no reason\n${shown(runs)}`);
});

test('#3066.08445d81 a planted alone entry with a fourth reason ("habit") fails the lint lane, naming the entry', LONG, async (t) => {
  const box = scene(t, { [file(9367)]: suite(9367) });
  plant(box, 'an alone entry with a fourth reason', [adds(folder(9367), 'habit')]);
  assert.ok(lanesOf(box.cwd, { env: box.env }).lists.alone.includes(folder(9367)), `the planted lanes.mjs does not hold ${folder(9367)} in alone`);
  const runs = await lint(box);
  assert.notDeepEqual(failsNaming(runs, 'tests/acceptance/9367'), [], `no command of the lint lane fails naming ${folder(9367)}, an alone entry planted with the reason "habit"\n${shown(runs)}`);
});

/**
 * Whether the lint lane fails for the plant: a command that passed before the plant fails after it, or a command that
 * fails after it prints a line naming the entry that it didn't print before. (A bare scene lacks the crates and docs
 * some lint scripts read, so those fail before and after alike, which is no refusal.)
 */
function refused(before, after, entry) {
  const named = entry.replace(/\/$/, '');
  return after.filter(({ status }) => status !== 0).flatMap(({ command, lines }) => {
    const was = before.find((run) => run.command === command);
    if (was?.status === 0) return [`${command}: exit 0 before the move, non-zero after it`];
    return lines.filter((line) => line.includes(named) && !was?.lines.includes(line)).map((line) => `${command}: ${line}`);
  });
}

async function plantedMove(t, entry) {
  // The entry's files are in the scene, so the move takes no test file away: only its line in `alone`.
  const box = scene(t, { [entry.endsWith('/') ? `${entry}moved.test.mjs` : entry]: suite('the moved entry') });
  assert.ok(lanesOf(box.cwd, { env: box.env }).lists.alone.includes(entry), `the scene's lanes.mjs does not hold ${entry} in alone before the move`);
  const before = await lint(box);
  plant(box, `move ${entry} out of alone`, [moves(entry)]);
  assert.ok(!lanesOf(box.cwd, { env: box.env }).lists.alone.includes(entry), `the planted lanes.mjs still holds ${entry} in alone`);
  const after = await lint(box);
  return { before, after, findings: refused(before, after, entry) };
}

test("#3066.67d86604 a planted move of #236's folder out of alone fails the lint lane", LONG, async (t) => {
  const { after, findings } = await plantedMove(t, 'tests/acceptance/236/');
  assert.notDeepEqual(findings, [], `the lint lane does not fail for tests/acceptance/236/ (the sandbox log stream it shares) moved out of alone\n${shown(after)}`);
});

test('#3066.67d86604 a planted move of an alone entry whose reason is timing fails the lint lane', LONG, async (t) => {
  const { lists, reasons } = lanesOf(CHECKOUT);
  // Not one the exclusive list names too, so the refusal is for the entry's own reason.
  const entry = (reasons ?? []).find(([name, reason]) => /^timing\b/.test(String(reason)) && lists.alone.includes(name) && !lists.exclusive.some((other) => name.startsWith(other)))?.[0];
  assert.ok(entry, 'no alone entry of scripts/lanes.mjs carries the reason timing (aloneReasons), so none can be planted as moved');
  const { after, findings } = await plantedMove(t, entry);
  assert.notDeepEqual(findings, [], `the lint lane does not fail for ${entry}, a timing entry, moved out of alone\n${shown(after)}`);
});
