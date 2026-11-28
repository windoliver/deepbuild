import assert from 'node:assert/strict';
import test from 'node:test';
import { all, ended, endOf, entryOf, POOL_OF_ONE, refused, running, sandbox, startOf, stub, throttle, timeline, until } from './helpers.mjs';

const TURN_S = 8;
const STALL_MS = 12_000;
const NAMES = ['first', 'second', 'third'];

test('#3660.79e21baf on a pool of one token passed down a line of three stub builds each holding its turn 8 s, a build with --stall 0.2 asked behind them gets its turn after them, runs its command, which exits 0, and exits 0', { timeout: 8 * 60_000 }, async (t) => {
  const box = sandbox(t, POOL_OF_ONE);
  const line = [];
  for (const name of NAMES) {
    const child = throttle(box, 'build', ['--wait', '10'], stub(box, name, 'sleep', String(TURN_S)));
    line.push({ name, child });
    await until(() => (name === 'first' ? startOf(box, name) : entryOf(box, child, 'granted')) || !running(child), 120_000);
  }
  const last = throttle(box, 'build', ['--stall', '0.2'], stub(box, 'last', 'exit'));
  const scene = [...line, { name: 'last', child: last }];
  const show = all(box, ...scene.map(({ child }) => child));
  await ended(last, 180_000);
  const story = timeline(box, line[0].child.asked, scene);
  t.diagnostic(story);

  for (const { name, child } of line) assert.ok(entryOf(box, child, 'granted'), `the stub build \`${name}\`, ${child.named}, was never admitted before the build under test asked\n${story}\n${show()}`);
  assert.ok(!running(last), `the build asked with --stall 0.2, ${last.named}, hadn't ended 180 s after it asked\n${story}\n${show()}`);
  assert.ok(!refused(last), `the build asked with --stall 0.2, ${last.named}, ended INCONCLUSIVE before its turn came, though a turn of the pool changed hands about every ${TURN_S} s: its stall didn't start again when a turn was taken or given back\n${story}\n${show()}`);
  assert.ok(startOf(box, 'last'), `the command of the build asked with --stall 0.2, ${last.named}, never started\n${story}\n${show()}`);
  assert.equal(last.status, 0, `the build asked with --stall 0.2, ${last.named}, exited ${last.status}, not 0\n${story}\n${show()}`);
  assert.ok(endOf(box, 'last'), `the command of the build asked with --stall 0.2 never ended by itself\n${show()}`);
  for (const [k, { name, child }] of line.entries()) {
    assert.equal(child.status, 0, `the stub build \`${name}\`, ${child.named}, exited ${child.status}, not 0\n${story}\n${show()}`);
    const next = scene[k + 1].name;
    assert.ok(startOf(box, next).at >= endOf(box, name).at, `the command of \`${next}\` started before \`${name}\`'s ended, so the pool's one token wasn't held in turn\n${story}\n${show()}`);
  }
  assert.ok(startOf(box, 'last').at - last.asked > STALL_MS, `the build asked with --stall 0.2 had its turn ${((startOf(box, 'last').at - last.asked) / 1000).toFixed(1)} s after it asked, within its stall of ${STALL_MS / 1000} s, so the line didn't make its stall start again\n${story}\n${show()}`);
});
