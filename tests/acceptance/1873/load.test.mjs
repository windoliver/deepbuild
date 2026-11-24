// #1873 AC4: a landing slows a test listed in `timing`, and the main watch ticks on main's head with the load passed in,
// below the core count and then, on a fresh sandbox, above it (README: The scenes).
import { test } from 'node:test';
import { CORES, LOAD_VAR, LONG, assert, dated, fileIssue, known, sandbox, show, status, tick, watched } from './helpers.mjs';

const NAME = 'stays within its budget';
const TIMED = `tests/timed.test.mjs › ${NAME}`;
const FILES = {
  'lib/work.mjs': 'export const work = async () => {};\n',
  'tests/timed.test.mjs': `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { work } from '../lib/work.mjs';\ntest(${JSON.stringify(NAME)}, async () => {\n  const start = performance.now();\n  await work();\n  const took = performance.now() - start;\n  assert.ok(took < 1000, 'work took ' + Math.round(took) + ' ms against a budget of 1000 ms');\n});\n`,
};
// The planted landing: the work now takes 2.5 s, over its budget at any load.
const SLOW = { 'lib/work.mjs': 'export const work = () => new Promise((done) => setTimeout(done, 2500));\n' };
const FILE = known({ timing: [TIMED], timingIssues: { [TIMED]: dated('a fixture budget, unmeasured at load', 9801, 2) } });

async function scene(t, load) {
  const box = await sandbox(t);
  fileIssue(box, 9801);
  const fx = watched(box, FILE, FILES, [SLOW]);
  const run = await tick(box, fx, { env: { [LOAD_VAR]: String(load) }, poll: true });
  return { run, after: await status(box, fx) };
}
const all = ({ run, after }) => `${show(run)}\npolls: ${JSON.stringify(run.polls.map(({ state, line }) => `${state}: ${line}`))}\nstatus after: ${after.line}`;

test(`#1873.36e78550 a planted landing that slows a listed timing test, ticked at a load below the core count, pauses landings naming the test; at a load above it, it pauses nothing and names the load`, LONG, async (t) => {
  const below = await scene(t, 0);
  assert.equal(below.after.state, 'paused', `at load 0 on ${CORES} cores the slowed timing test read as listed: landings didn't pause\n${all(below)}`);
  assert.ok(below.after.line.includes(NAME), `landings paused, but status doesn't name the test ${TIMED}\n${all(below)}`);
  const load = CORES * 2 + 3;
  const above = await scene(t, load);
  assert.ok(above.run.polls.every(({ state }) => state === 'open') && above.after.state === 'open',
    `at load ${load} on ${CORES} cores the slowed timing test paused landings\n${all(above)}`);
  const names = above.run.stdout.split('\n').find((line) => line.includes(NAME) && /\bload\b/.test(line) && new RegExp(`\\b${load}\\b`).test(line));
  assert.ok(names, `at load ${load} no line of the tick names the test with the load ${load}\n${all(above)}`);
});
