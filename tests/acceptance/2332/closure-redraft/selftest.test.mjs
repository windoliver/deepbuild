// Self-tests of the #2332 redraft's own tooling: needs macOS and cc, no built hub, no main checkout.
// They prove the judge reads the issue's thresholds, the counter reads one process apart from its children,
// and that a hub doing nothing can neither pass nor be measured as if it were one.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { change, here, hubRound, hubVerdicts, idleVerdict, instructionsOf, judgeAt, settle, sleep } from './lib.mjs';

const G = 1e9;
// Twenty pairs whose change/base ratios wobble around `ratio` by +/- `wobble`, in a fixed order.
const pairs = (ratio, wobble = 0.01) => Array.from({ length: 20 }, (_, i) => ({ base: Math.round(G * (1 + (i % 5) * 0.01)), change: 0 })).map((p, i) => ({ ...p, change: Math.round(p.base * ratio * (1 + wobble * (i % 2 ? 1 : -1) * ((i % 4) / 3))) }));

test('start to ready reads 25% under main at the exact line: 0.6 passes, 0.9 fails, 0.75 is undecided', async () => {
  assert.equal((await judgeAt(pairs(0.6), 0.75)).status, 'PASS');
  assert.equal((await judgeAt(pairs(0.9), 0.75)).status, 'FAIL');
  assert.equal((await judgeAt(pairs(0.76, 0.2), 0.75)).status, 'INCONCLUSIVE');
  const read = await judgeAt(pairs(0.6), 0.75);
  assert.ok(read.medianRatio > 0.5 && read.medianRatio < 0.7 && Number.isFinite(read.pAbove) && Number.isFinite(read.pBelow) && read.seed === 2332, JSON.stringify(read));
});

test('a first hook has a 0% margin: 1% more fails, equal is not a pass, less passes', async () => {
  assert.equal((await judgeAt(pairs(1.01, 0.001), 1)).status, 'FAIL');
  assert.notEqual((await judgeAt(pairs(1, 0), 1)).status, 'PASS');
  assert.equal((await judgeAt(pairs(0.9), 1)).status, 'PASS');
  // One pair far above does not hide behind the rest: noisy pairs around main stay undecided.
  assert.equal((await judgeAt(pairs(1, 0.2), 1)).status, 'INCONCLUSIVE');
});

test('a missing, zero or short run is INCONCLUSIVE and never a pass', async () => {
  const good = pairs(0.5);
  for (const bad of [[], good.slice(0, 19), good.map((p, i) => (i === 3 ? { ...p, change: null } : p)), good.map((p, i) => (i === 7 ? { ...p, base: 0 } : p)), good.map((p, i) => (i === 7 ? { ...p, change: 0 } : p)), good.map(() => ({ base: null, change: null }))])
    assert.equal((await judgeAt(bad, 0.75)).status, 'INCONCLUSIVE', JSON.stringify(bad).slice(0, 120));
});

test('the counter reads one live process, apart from its children', async () => {
  const spin = (n) => `for (let i = 0; i < ${n}; i++);`;
  const wait = "process.stdin.resume(); process.stdin.on('end', () => process.exit());";
  const run = (code) => spawn(process.execPath, ['-e', code], { stdio: ['pipe', 'pipe', 'ignore'] });
  const done = (child) => new Promise((resolve) => child.stdout.once('data', resolve));
  const alone = run(`${spin(1e9)} console.log('x'); ${wait}`);
  const parent = run(`require('child_process').spawnSync(process.execPath, ['-e', ${JSON.stringify(spin(1e9))}]); console.log('x'); ${wait}`);
  try {
    await Promise.all([done(alone), done(parent)]);
    const [child, outer] = [instructionsOf(alone.pid), instructionsOf(parent.pid)];
    assert.ok(child > 1e9, `a process that spun 1e9 times reads ${child}`);
    assert.ok(outer < 0.25 * child, `a parent that only waited for such a child reads ${outer}, the child ${child}: children belong apart`);
    assert.equal(instructionsOf(2 ** 22 - 7), null, 'a process that is not there reads null, never 0');
  } finally {
    alone.stdin.end();
    parent.stdin.end();
  }
});

test('quiescence is bounded: an idle process settles, a busy one is reported unsettled', async () => {
  const idle = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });
  const busy = spawn(process.execPath, ['-e', 'for (;;);'], { stdio: 'ignore' });
  try {
    await sleep(500);
    assert.equal((await settle(idle.pid, { limitMs: 8000 })).settled, true);
    const bound = Date.now();
    assert.equal((await settle(busy.pid, { limitMs: 1500 })).settled, false);
    assert.ok(Date.now() - bound < 4000, 'the wait is bounded');
  } finally {
    idle.kill();
    busy.kill();
  }
});

test('a hub that does nothing is refused by the round, so its tiny count never reaches a verdict', async () => {
  await assert.rejects(hubRound(change, join(here, 'noop-hub.mjs')), /INVALID/);
});

test('idle memory is INCONCLUSIVE off a reference Mac, whatever the bytes say, and the gap in counts decides on one', async () => {
  const ok = { ok: true, reason: null };
  const run = (rssBytes, reading = ok) => ({ rssBytes, before: reading, after: reading });
  const rounds = (change, base, reading) => Array.from({ length: 20 }, (_, i) => ({ change: run(Math.round(change * (1 + (i % 3) * 0.002)), reading), base: run(Math.round(base * (1 + (i % 3) * 0.002))) }));
  assert.equal((await idleVerdict(rounds(60e6, 80e6, ok))).status, 'PASS');
  assert.equal((await idleVerdict(rounds(90e6, 80e6, ok))).status, 'FAIL');
  assert.equal((await idleVerdict(rounds(60e6, 80e6, { ok: false, reason: 'power is "battery"' }))).status, 'INCONCLUSIVE');
  assert.equal((await idleVerdict(rounds(NaN, 80e6, ok))).status, 'INCONCLUSIVE');
});

test('a hub whose first hooks cost more fails that hook though its ready count passes', async () => {
  const side = (ready, hook, settledTotal = 4e9) => ({ atReady: ready, settledTotal, readySettled: true, steps: [hook, hook, hook].map((instructions) => ({ instructions, settled: true })) });
  const rounds = (changeSide) => Array.from({ length: 20 }, (_, i) => ({ base: side(4.5e9 + i * 1e6, 20e6 + i * 1e4, 4.6e9), change: changeSide(i) }));
  const lazy = await hubVerdicts(rounds((i) => side(2.5e9 + i * 1e6, 15e6 + i * 1e4, 2.9e9)));
  assert.deepEqual(Object.values(lazy).map(({ status }) => status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
  const slower = await hubVerdicts(rounds((i) => side(2.5e9 + i * 1e6, 90e6 + i * 1e4, 2.9e9)));
  assert.equal(slower.ready.status, 'PASS');
  assert.equal(slower.preToolUse.status, 'FAIL');
  const shifted = await hubVerdicts(rounds((i) => side(2.5e9 + i * 1e6, 20e6 + i * 1e4, 4.6e9)));
  assert.equal(shifted.ready.status, 'PASS');
  assert.notEqual(shifted.settledTotal.status, 'PASS', 'work moved to just after ready is still in the quiescent total');
});
