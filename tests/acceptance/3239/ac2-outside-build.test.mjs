// #3239 AC2: the wrapper AC1's sandbox names logs a call for each compile of a cargo build started outside the four
// scripts, so the fixture tells their bare builds from any other. The build runs in the same fixture as AC1's, with
// the checkout's own cargo build settings in it (helpers.mjs: buildTable), and cargo's own report says which units it
// compiled.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cargoCalls, compiles, fixture, outsideBuild, redact, sandbox, tail, wrapperCalls } from './helpers.mjs';

const ID = '#3239.9d1b4fd0';

test(`${ID} AC2 the same wrapper logs a call for each unit a cargo build started outside the four scripts compiles`, { timeout: 1_200_000 }, async (t) => {
  const box = sandbox(t);
  const repo = fixture(box);
  const run = await outsideBuild(box, repo.root, ['build', '--workspace', '--locked', '--message-format=json']);
  assert.equal(run.status, 0, `the outside cargo build failed\n${tail(box, run)}`);
  const [call] = cargoCalls(box);
  assert.equal(call?.pid, String(run.pid), `the build didn't go through the sandbox's cargo\n${redact(box, JSON.stringify(cargoCalls(box)))}`);
  // Each unit cargo compiled (not fresh), by the crate name rustc is given.
  const units = run.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line))
    .filter(({ reason, fresh }) => reason === 'compiler-artifact' && fresh === false).map(({ target }) => target.name.replaceAll('-', '_'));
  assert.ok(units.length >= 2, `the fixture's two crates didn't compile, so there is nothing to log: ${units.join(', ')}\n${tail(box, run)}`);
  const logged = compiles(wrapperCalls(box).filter(({ cargo }) => cargo === call.pid)).map(({ crate }) => crate);
  const left = [...logged];
  const unlogged = units.filter((unit) => {
    const at = left.indexOf(unit);
    if (at < 0) return true;
    left.splice(at, 1);
    return false;
  });
  assert.deepEqual(unlogged, [], `the cargo home's wrapper logged no call for ${unlogged.length} of the ${units.length} units the outside build compiled (${unlogged.join(', ')}); it logged ${logged.length} compiles (${logged.join(', ') || 'none'}), so the fixture can't tell a script's bare build from any other`);
});
