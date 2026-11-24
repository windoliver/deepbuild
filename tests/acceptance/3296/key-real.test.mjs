// #3296 AC4 (#3296.870c9548): a kept result is used only under its own key, where what differs can be changed for real
// between two runs of one small lane: the environment, the Rust compiler's version line and the tree. A program whose part
// of the key is a constant, or leaves some of the variables out, is told here by the job it doesn't start; one whose key
// holds what the run sets for itself is told by the job it starts again when nothing changed. key-lines.test.mjs plants
// every part on the kept lines.
//
// The merge base keeps no line, and is the planted program that starts the job every time.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { before } from 'node:test';
import { pathToFileURL } from 'node:url';
import { dump, nodeFile, scene, toEnd } from './helpers.mjs';

const AC4 = '#3296.870c9548';
const SMALL = { [nodeFile('n')]: 'n' };
const SECRET = 'a-value-the-key-must-not-give-away';
const steps = [];
let watch;
let small;

before(async () => {
  small = scene({ files: SMALL, commands: ['node'] });
  const step = async (what, { env, expected }) => {
    const earlier = small.starts('n'), run = await toEnd(small, { env });
    steps.push({ what, expected, started: small.starts('n') - earlier, code: run.code, kept: small.kept(), shown: dump(small, run) });
  };
  const rustc = 'rustc 1.99.1 (0123456789 2026-10-01)';
  await step('the first run', { expected: 1 });
  await step('nothing changed', { expected: 0 });
  await step('DEEP_T3296 set', { env: { DEEP_T3296: SECRET }, expected: 1 });
  await step('DEEP_T3296 set to another value', { env: { DEEP_T3296: `${SECRET}-2` }, expected: 1 });
  await step('DEEP_T3296 as it was set before', { env: { DEEP_T3296: SECRET }, expected: 0 });
  await step('DEEPBUILD_T3296 set', { env: { DEEPBUILD_T3296: SECRET }, expected: 1 });
  small.rustc('rustc 1.99.2 (9876543210 2026-11-01)');
  await step('another Rust version', { expected: 1 });
  small.rustc(rustc);
  await step('the first run\'s key again', { expected: 0 });
  await step('a variable of neither name', { env: { T3296_OTHER: '1' }, expected: 0 });
  // What the main watch runs, the lanes with no preflight above them, runs everything, and keeps nothing.
  const held = existsSync(small.keptFile()) ? readFileSync(small.keptFile(), 'utf8') : null, earlier = small.starts('n');
  const program = `const mod = await import(${JSON.stringify(pathToFileURL(join(small.tree, 'scripts/lanes.mjs')).href)});\nprocess.exitCode = await mod.runLanes(mod.checks, { cwd: ${JSON.stringify(small.tree)} });`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: small.tree, env: small.env, encoding: 'utf8' });
  watch = { started: small.starts('n') - earlier, status: run.status, kept: (existsSync(small.keptFile()) ? readFileSync(small.keptFile(), 'utf8') : null) === held, shown: `${run.stdout}${run.stderr}` };
  small.put('src/lib.rs', '// another tree\n');
  small.commit();
  await step('another tree', { expected: 1 });
  small.put('src/lib.rs', '');
  small.commit();
  await step('the first tree again', { expected: 0 });
}, { timeout: 60 * 60_000 });

test(`${AC4} another environment, Rust version or tree runs the file again, and the same ones don't`, () => {
  for (const { what, expected, started, code, shown } of steps) {
    assert.equal(started, expected, `${what}: the file was started ${started} times, not ${expected}\n${shown}`);
    assert.equal(code, 0, `${what}: the preflight exited ${code}\n${shown}`);
  }
});

test(`${AC4} a variable's value is in no kept line, and two values of it give two keys`, () => {
  const last = steps.find(({ what }) => what === 'DEEPBUILD_T3296 set');
  assert.ok(last.kept.length, `the runs kept no line\n${last.shown}`);
  assert.ok(!JSON.stringify(last.kept).includes(SECRET), `a kept line holds a variable's value\n${last.shown}`);
  const keys = [...new Set(last.kept.map((line) => line.key.env))];
  assert.equal(keys.length, 4, `four environments were kept under ${keys.length} keys: ${JSON.stringify(keys)}`);
});

// A regression guard: it passes on the merge base too.
test('guard: the lanes run with no preflight above them, as the main watch runs them, start every file and keep nothing', () => {
  assert.equal(watch.started, 1, `the lane's file was started ${watch.started} times\n${watch.shown}`);
  assert.equal(watch.status, 0, `the lanes exited ${watch.status}\n${watch.shown}`);
  assert.ok(watch.kept, `the kept lines changed\n${watch.shown}`);
});
