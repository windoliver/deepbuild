// #1113: throttle.mjs as a command: the child's status, the no-grant timeout, and a forged DEEP_THROTTLE.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { LIMIT, THROTTLE, dump, event, hold, launch, node, sandbox, started, until } from './helpers.mjs';

// Fills `kind` to its limit with stub holders of `ms` each; returns their names once all have started.
async function fill(box, kind, ms) {
  const names = Array.from({ length: LIMIT[kind] }, (_, i) => `${kind}-holder-${i}`);
  for (const name of names) hold(box, kind, 1, { name, hold: ms });
  for (const name of names) await started(box, name);
  return names;
}

test('#1113.060e7bae a wrapped command that exits 3 makes throttle.mjs exit 3, and one killed by SIGTERM exits 143', async (t) => {
  const box = sandbox(t);
  const three = node([THROTTLE, 'test', '--wait', '1', '--', process.execPath, '-e', 'process.exit(3)'], { env: box.env, cwd: box.dir, timeout: 30_000 });
  assert.equal(three.status, 3, `a child that exits 3\n${dump(box, three)}`);

  const pidFile = join(box.dir, 'child.pid');
  const run = launch(box, [process.execPath, THROTTLE, 'test', '--wait', '1', '--', 'sh', '-c', `echo $$ > '${pidFile}'; exec sleep 30`]);
  const ran = await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim(), 10_000);
  assert.ok(ran, `the wrapped command never started\n${dump(box)}`);
  process.kill(Number(readFileSync(pidFile, 'utf8').trim()), 'SIGTERM');
  const killed = await run.done;
  assert.equal(killed.status, 143, `a child killed by SIGTERM (128 + 15)\n${dump(box, killed)}`);
});

test('#1113.99a9da00 a no-grant timeout exits non-zero with INCONCLUSIVE no grant as its first line, and never runs the command', async (t) => {
  const box = sandbox(t);
  await fill(box, 'build', 8_000);
  // 0.02 min is 1.2 s, well inside the holders' 8 s.
  const late = await hold(box, 'build', 0.02, { name: 'late' }).done;
  assert.notEqual(late.status, 0, dump(box, late));
  const first = (late.stdout.trim() ? late.stdout : late.stderr).split('\n').find((line) => line.trim()) ?? '';
  assert.match(first, /^INCONCLUSIVE no grant\b/, `first line ${JSON.stringify(first)}\n${dump(box, late)}`);
  assert.equal(event(box, 'late', 'start'), undefined, `the command ran without a grant\n${dump(box, late)}`);
  assert.ok(late.ended - late.started < 6_000, `it waited ${late.ended - late.started} ms, past its 1.2 s wait\n${dump(box, late)}`);
});

test('#1113.06c9ec7b a forged DEEP_THROTTLE is ignored and a fresh grant is requested: a live holder\'s value copied from outside its chain, or a made-up one', async (t) => {
  const box = sandbox(t);
  const holders = await fill(box, 'build', 3_000);
  const copied = event(box, holders[0], 'start').throttle;
  assert.match(String(copied), /^build:\S+$/, `a build holder's child is handed DEEP_THROTTLE=build:<id>\n${dump(box)}`);
  // Neither forger descends from a holder, so neither may pass through the full build class.
  const forgers = [['copied', copied], ['made-up', 'build:forged-1113']];
  const runs = forgers.map(([name, value]) => hold(box, 'build', 1, { name }, { DEEP_THROTTLE: value }));
  const results = await Promise.all(runs.map((run) => run.done));
  const firstEnd = Math.min(...holders.map((name) => event(box, name, 'end')?.t ?? Infinity));
  forgers.forEach(([name, value], i) => {
    assert.equal(results[i].status, 0, `${name} forger\n${dump(box, results[i])}`);
    const start = event(box, name, 'start');
    assert.ok(start, `${name} forger never ran\n${dump(box, results[i])}`);
    assert.ok(start.t >= firstEnd - 100, `the ${name} DEEP_THROTTLE was trusted: its command started ${firstEnd - start.t} ms before any build holder ended\n${dump(box, results[i])}`);
    assert.notEqual(start.throttle, value, `the ${name} forger ran under the forged grant, not a fresh one\n${dump(box)}`);
  });
});
