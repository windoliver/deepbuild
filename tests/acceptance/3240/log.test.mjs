// #3240.712a690c: with the new fields, the log still holds PIDs, grant IDs, classes and command names only. A stub
// grant's child and an ungranted process draw on the GPU, each started with a marked argument, a marked environment
// value and a binary under the sandbox's HOME, while a `build` request waits; `load`'s first sample, whose GPU read
// is over its own first second, is read whole (README: The surface). It takes about 20 s.
import assert from 'node:assert/strict';
import { userInfo } from 'node:os';
import test from 'node:test';
import { ARGUMENT, CLASSES, SECRET, begun, draw, dump, gpuBetween, gpuStub, gpuTimes, hold, leads, listing, load, logText, loose, pause, running, sampled, sandbox, spin } from './helpers.mjs';

test('#3240.712a690c the log still holds PIDs, grant IDs, classes and command names only: gpuTop, waiting, idle and busy add no argument, path, environment value or reason text', { timeout: 420_000 }, async (t) => {
  if (process.platform !== 'darwin') return t.skip('INCONCLUSIVE: the GPU is read on macOS only, and this criterion runs on the Mac');
  const box = sandbox(t);
  gpuStub(box);
  const granted = hold(box, 'granted', draw(box, 'granted', 120));
  const free = loose(box, 'free', draw(box, 'free', 120));
  const child = await begun(box, granted, 'test');
  const other = await begun(box, free);
  // A build grant and a build request behind it, so waiting counts one.
  const builder = hold(box, 'builder', spin(box, 'builder', 0), { cls: 'build' });
  const holding = await begun(box, builder, 'build');
  const waiter = hold(box, 'waiter', spin(box, 'waiter', 0), { cls: 'build', wait: 10 });
  await pause(3_000);
  const readings = [listing()];
  const before = gpuTimes();
  const run = load(box);
  const sample = await sampled(box, run, 1, 60_000, readings);
  const after = gpuTimes();
  if (running(run)) run.kill('SIGTERM');
  const context = dump(box, run, granted, free, builder, waiter);
  assert.ok(sample, `load wrote no sample to load.log in the table's folder\n${context}`);
  assert.equal(sample.failed, undefined, `the sample failed\n${context}`);
  // The log is read with the new fields in it: the stubs drawing are listed in gpuTop when they led.
  assert.ok(Array.isArray(sample.gpuTop), `the sample holds no gpuTop, the processes that used the GPU\n${context}`);
  const between = gpuBetween(before, after);
  for (const [pid, name] of [[child.pid, 'the grant\'s child'], [other.pid, 'the ungranted process']]) {
    if (leads(between, pid)) assert.ok(sample.gpuTop.some((proc) => proc.pid === pid), `${name} (pid ${pid}) used more GPU time than all but four processes, by a fifth, and isn't in gpuTop\n${context}`);
  }
  t.diagnostic(`in gpuTop: ${sample.gpuTop.filter((proc) => [child.pid, other.pid].includes(proc.pid)).length} of the test's 2 GPU stubs; waiting ${JSON.stringify(sample.waiting)}`);

  // Every stub and the sampler were given ARGUMENT or SECRET; the stubs run from the sandbox's HOME, throttle.mjs from
  // this checkout, and the machine's other processes from the user's home.
  const text = logText(box);
  const never = { 'a stub\'s argument': ARGUMENT, 'an environment value': SECRET, 'the sandbox\'s HOME': box.home, 'the sandbox': box.dir, 'the user\'s home': userInfo().homedir, 'a script\'s name, an argument': '.mjs' };
  for (const [what, mark] of Object.entries(never)) assert.ok(!text.includes(mark), `load.log holds ${what} (${mark})\n${text}`);

  // Only: every text in the sample is the time, a class, a grant's ID of this table or a command's name. A GPU that was
  // read leaves no reason text.
  const ids = [child.id, holding.id];
  const names = (pid) => new Set(readings.map((procs) => procs.get(pid)?.command).filter((name) => name !== undefined));
  const walk = (value, key, owner) => {
    if (Array.isArray(value)) return value.forEach((item) => walk(item, key, owner));
    if (value && typeof value === 'object') return Object.entries(value).forEach(([name, item]) => walk(item, name, value));
    if (typeof value === 'number') return;
    assert.equal(typeof value, 'string', `${key}: ${JSON.stringify(value)}`);
    if (key === 'at') return assert.ok(!Number.isNaN(Date.parse(value)), `at: ${value}`);
    if (key === 'class') return assert.ok(CLASSES.includes(value), `class: ${value}`);
    if (key === 'id' || key === 'grant') return assert.ok(ids.includes(value), `${key} ${value} is no grant of this table`);
    assert.equal(key, 'command', `a text that is no time, class, grant ID or command name: ${key} ${JSON.stringify(value)}\n${text}`);
    assert.ok(!value.includes('/'), `a command with a path: ${value}`);
    // The name as ps prints ucomm, for a process the test's own listings saw.
    if (names(owner.pid).size) assert.ok(names(owner.pid).has(value), `pid ${owner.pid}'s command is ${JSON.stringify(value)}; ps prints its ucomm as ${[...names(owner.pid)].map((name) => JSON.stringify(name)).join(' or ')}`);
  };
  walk(sample);
  // The keys of waiting are the four classes, its values counts.
  assert.ok(sample.waiting && Object.keys(sample.waiting).every((cls) => CLASSES.includes(cls)), `waiting is keyed by class: ${JSON.stringify(sample.waiting)}`);
});
