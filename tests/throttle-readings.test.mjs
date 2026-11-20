// The test class's grants past the first are decided by the machine's readings, under the LIMITS ceiling (#2924,
// docs/parallel-proof.md section 6). The rule's edges directly, and once through the CLI on a table of the test's own
// with readings it is given: the merge base grants the second request whatever the readings say.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const throttle = fileURLToPath(new URL('../scripts/throttle.mjs', import.meta.url));
const GiB = 2 ** 30, MIN = 60_000, NOW = 1_000_000_000_000;
const ceiling = process.platform === 'darwin' ? 2 : 6;
const idle = { memory: 1000 * GiB, load: 0, cores: 20 };
const old = (n) => Array.from({ length: n }, () => ({ at: NOW - 10 * MIN }));

test('the rule: the first test grant always starts; past it, the readings and the ceiling decide', async () => {
  const { roomForTest } = await import(throttle);
  assert.equal(roomForTest([], { memory: 0, load: 500, cores: 1 }, NOW), true, 'the first grant waited on the readings');
  assert.equal(roomForTest(old(1), { ...idle, load: 20 }, NOW), false, 'a second grant started at a load of the cores');
  assert.equal(roomForTest(old(1), { ...idle, load: 19.9 }, NOW), true);
  assert.equal(roomForTest(old(1), { ...idle, memory: 24 * GiB - 1 }, NOW), false, 'a second grant started with less than a run\'s memory');
  assert.equal(roomForTest(old(1), { ...idle, memory: 24 * GiB }, NOW), true);
  // A grant under 5 minutes old, or of no known time, reserves a run's memory the readings don't show yet.
  for (const settling of [{ at: NOW - 5 * MIN + 1 }, {}]) {
    assert.equal(roomForTest([settling], { ...idle, memory: 48 * GiB - 1 }, NOW), false, `a settling grant ${JSON.stringify(settling)} reserved nothing`);
    assert.equal(roomForTest([settling], { ...idle, memory: 48 * GiB }, NOW), true);
  }
  assert.equal(roomForTest([{ at: NOW - 5 * MIN }], { ...idle, memory: 24 * GiB }, NOW), true, 'a 5-minute-old grant still reserved memory');
  assert.equal(roomForTest(old(ceiling - 1), idle, NOW), true);
  assert.equal(roomForTest(old(ceiling), idle, NOW), false, 'a grant past the ceiling started');
  // A test's own table given no readings decides by the ceiling alone.
  assert.equal(roomForTest(old(ceiling - 1), null, NOW), true);
  assert.equal(roomForTest(old(ceiling), null, NOW), false);
});

test('through the CLI, a second test request waits while its readings leave no room, and starts once they do', async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-throttle-readings-')));
  const children = [];
  t.after(() => {
    for (const child of children) if (child.exitCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const readings = join(dir, 'readings.json');
  writeFileSync(readings, JSON.stringify({ memory: 1000 * GiB, load: 64, cores: 16 }));
  const env = { ...process.env, HOME: dir, DEEP_THROTTLE_TABLE: join(dir, 'table'), DEEP_THROTTLE_READINGS: readings };
  for (const key of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT']) delete env[key];
  // Each command notes its start in a file and holds until its stop file appears.
  const request = (name) => {
    const hold = `require('fs').writeFileSync(${JSON.stringify(join(dir, `${name}.started`))}, ''); setInterval(() => require('fs').existsSync(${JSON.stringify(join(dir, `${name}.stop`))}) && process.exit(0), 50)`;
    const child = spawn(process.execPath, [throttle, 'test', '--wait', '1', '--', process.execPath, '-e', hold], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    children.push(child);
    return { pid: child.pid, started: () => existsSync(join(dir, `${name}.started`)), out: () => out, done: new Promise((resolve) => child.on('exit', resolve)) };
  };
  const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
  const granted = () => read(join(dir, 'table', 'log')).split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.event === 'granted');
  // In the table as a request or a grant: on a loaded machine a process can take seconds to get that far.
  const asked = ({ pid }) => { try { const table = JSON.parse(read(join(dir, 'table', 'table.json'))); return [...table.requests, ...table.grants].some((entry) => entry.pid === pid); } catch { return false; } };
  const until = async (found, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await pause(100)) if (found()) return true;
    return found();
  };
  const first = request('first');
  assert.ok(await until(first.started, 30_000), `the first request never started at a load of 4 per core:\n${first.out()}`);
  const second = request('second');
  assert.ok(await until(() => asked(second), 30_000), `the second request never reached the table:\n${second.out()}`);
  // Ten looks or more.
  await pause(2_000);
  assert.ok(!granted().some((entry) => entry.pid === second.pid), `a second test grant started at a load of 64 on 16 cores:\n${second.out()}`);
  writeFileSync(readings, JSON.stringify({ memory: 1000 * GiB, load: 1, cores: 16 }));
  assert.ok(await until(second.started, 30_000), `the second request didn't start once the load fell:\n${second.out()}`);
  assert.deepEqual(granted().map((entry) => entry.readings), [{ memory: 1000 * GiB, load: 64, cores: 16 }, { memory: 1000 * GiB, load: 1, cores: 16 }]);
  writeFileSync(join(dir, 'first.stop'), '');
  writeFileSync(join(dir, 'second.stop'), '');
  assert.deepEqual(await Promise.all([first.done, second.done]), [0, 0]);
});
