import assert from 'node:assert/strict';
import test from 'node:test';
import { before, bothSides, dump, fixture, HUB_TEST, sandbox } from './helpers.mjs';

// The real before lane on a fixture whose tagged test starts its checkout's hub stand-in through
// packages/cli/dist/main.js hub run, which BLOCKs unless deep-hook and deep-show are under that checkout's target/.
test('#2817.caef3798 a tagged test starting the checkout hub through hub run reaches its assertions on both sides', { timeout: 290_000 }, (t) => {
  const box = sandbox(t);
  fixture(box, { 'tests/acceptance/2817/hub.test.mjs': HUB_TEST });
  const { result, seen } = before(t, box);
  const sides = bothSides(seen, result);
  for (const side of ['change', 'base']) assert.equal(sides[side].status, 0, `${side} side: the hub found no binary under its copy's target/ (${sides[side].stderr})\n${dump(result)}`);
  assert.equal(sides.change.stdout, 'hook-change show-change', 'the change side hub answers with the change programs');
  assert.doesNotMatch(result.stdout, /^(?:BLOCKED|FAIL) before: .*#2817\.caef3798/m, dump(result));
  assert.match(result.stdout, /^PASS before: tests\/acceptance\/2817\/hub\.test\.mjs › #2817\.caef3798 .*: failed on the merge base at its assertion$/m, dump(result));
});
