import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const throttle = fileURLToPath(new URL('../scripts/throttle.mjs', import.meta.url));

const until = async (found, ms) => {
  // deadline: a look each 100 ms, for at most the bound a loaded machine's slowest step takes.
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((look) => setTimeout(look, 100))) if (found()) return true;
  return found();
};

function box(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-throttle-own-lock-')));
  const table = join(dir, 'table');
  mkdirSync(table, { recursive: true });
  const readings = join(dir, 'readings.json');
  writeFileSync(readings, JSON.stringify({ memory: 2 ** 40, load: 0, cores: 4 }));
  const env = { ...process.env, HOME: join(dir, 'home'), DEEP_THROTTLE_TABLE: table, DEEP_THROTTLE_READINGS: readings };
  for (const key of ['DEEP_THROTTLE', 'DEEP_THROTTLE_RUN', 'DEEP_WINDOW']) delete env[key];
  const started = [];
  t.after(() => {
    for (const child of started) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  return { dir, table, env, started };
}

function psStart(pid) {
  const listing = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
  return listing.stdout.trim();
}

async function plantLock(sandbox, holder) {
  const written = join(sandbox.dir, 'planted-lock');
  writeFileSync(written, JSON.stringify(holder));
  const mark = join(sandbox.table, 'table.lock');
  assert.ok(await until(() => {
    try {
      linkSync(written, mark);
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return false;
    }
  }, 10_000), 'the lock was never free to plant');
}

function run(sandbox, args, { preload = [], env = {} } = {}) {
  const child = spawn(process.execPath, [...preload, throttle, ...args], { env: { ...sandbox.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  sandbox.started.push(child);
  let out = '';
  child.stdout.on('data', (data) => (out += data));
  child.stderr.on('data', (data) => (out += data));
  const result = { status: null, out: () => out, pid: child.pid };
  child.on('exit', (status, signal) => (result.status = status ?? signal));
  return result;
}

const logged = (sandbox) => (existsSync(join(sandbox.table, 'log')) ? readFileSync(join(sandbox.table, 'log'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const grants = (sandbox) => JSON.parse(readFileSync(join(sandbox.table, 'table.json'), 'utf8')).grants;

test('an admitted build that finds the table lock naming itself, left by an earlier look of its own, takes it and goes on to exit with its command', async (t) => {
  const sandbox = box(t);
  const go = join(sandbox.dir, 'go');
  const build = run(sandbox, ['build', '--stall', '30', '--', process.execPath, '-e', `const fs = require('node:fs'); const end = Date.now() + 60000; const wait = () => fs.existsSync(${JSON.stringify(go)}) || Date.now() > end ? process.exit(0) : setTimeout(wait, 50); wait();`]);
  assert.ok(await until(() => logged(sandbox).some((line) => line.event === 'turn'), 60_000), `the build never took its turn:\n${build.out()}`);
  await plantLock(sandbox, { pid: build.pid, start: psStart(build.pid) });
  writeFileSync(go, '');
  assert.ok(await until(() => build.status !== null, 60_000), `the build's throttle was still running 60 s after its command ended, the lock naming the throttle itself:\n${build.out()}`);
  assert.equal(build.status, 0, build.out());
  assert.deepEqual(grants(sandbox), [], 'the build left its grant or turn in the table');
});

const PAUSES = `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const { T_ROLE: role, T_DIR: dir } = process.env;
const real = fs.renameSync;
const reach = (name) => fs.writeFileSync(dir + '/' + name, '');
const gate = (name) => { for (const end = Date.now() + 120000; !fs.existsSync(dir + '/' + name) && Date.now() < end;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); };
let paused = false;
fs.renameSync = function (from, to) {
  if (role === 'taker' && !paused && String(to).includes('table.lock.gone.')) {
    paused = true;
    reach('taker-judged');
    gate('taker-rename');
    real(from, to);
    reach('taker-renamed');
    gate('taker-return');
    return;
  }
  if (role === 'holder' && !paused && String(to).endsWith('table.json')) {
    paused = true;
    reach('holder-inside');
    gate('holder-leave');
  }
  return real(from, to);
};
const link = fs.linkSync;
let taken = 0;
fs.linkSync = function (from, to) {
  if (role === 'holder' && String(to).endsWith('table.lock') && ++taken === 2) {
    reach('holder-outside');
    gate('holder-asks-again');
  }
  link(from, to);
  if (role === 'taker' && String(from).includes('table.lock.gone.')) reach('taker-put-back');
};
syncBuiltinESMExports();
`;

test('a lock that a take-over of a dead holder puts back after its live owner gave it up does not stop that owner or the requests behind it', async (t) => {
  const sandbox = box(t);
  const at = (name) => join(sandbox.dir, name);
  const preload = ['--import', at('pauses.mjs')];
  writeFileSync(at('pauses.mjs'), PAUSES);
  const dead = spawnSync('/usr/bin/true');
  await plantLock(sandbox, { pid: dead.pid, start: 'Thu Jan  1 00:00:00 1970' });
  const taker = run(sandbox, ['test', '--wait', '5', '--', '/usr/bin/true'], { preload, env: { T_ROLE: 'taker', T_DIR: sandbox.dir } });
  assert.ok(await until(() => existsSync(at('taker-judged')), 60_000), `the taker never judged the planted lock's holder gone:\n${taker.out()}`);
  rmSync(join(sandbox.table, 'table.lock'));
  const go = at('go');
  const holder = run(sandbox, ['build', '--stall', '30', '--', process.execPath, '-e', `const fs = require('node:fs'); const end = Date.now() + 120000; const wait = () => fs.existsSync(${JSON.stringify(go)}) || Date.now() > end ? process.exit(0) : setTimeout(wait, 50); wait();`], { preload, env: { T_ROLE: 'holder', T_DIR: sandbox.dir } });
  assert.ok(await until(() => existsSync(at('holder-inside')), 60_000), `the holder never took the lock:\n${holder.out()}`);
  assert.equal(JSON.parse(readFileSync(join(sandbox.table, 'table.lock'), 'utf8')).pid, holder.pid, 'the lock does not name the holder');
  writeFileSync(at('taker-rename'), '');
  assert.ok(await until(() => existsSync(at('taker-renamed')), 60_000), `the taker never moved the lock aside:\n${taker.out()}`);
  writeFileSync(at('holder-leave'), '');
  assert.ok(await until(() => existsSync(at('holder-outside')), 60_000), `the holder never gave the lock up and asked again:\n${holder.out()}`);
  writeFileSync(at('taker-return'), '');
  assert.ok(await until(() => existsSync(at('taker-put-back')), 60_000), `the taker never put the lock back:\n${taker.out()}`);
  assert.equal(JSON.parse(readFileSync(join(sandbox.table, 'table.lock'), 'utf8')).pid, holder.pid, 'the lock put back does not name the holder');
  writeFileSync(at('holder-asks-again'), '');
  writeFileSync(go, '');
  assert.ok(await until(() => holder.status !== null && taker.status !== null, 60_000), `60 s after the holder's command ended: holder ${holder.status}, taker ${taker.status}, lock ${existsSync(join(sandbox.table, 'table.lock')) ? readFileSync(join(sandbox.table, 'table.lock'), 'utf8') : 'none'} (holder pid ${holder.pid}):\n${holder.out()}\n${taker.out()}`);
  assert.deepEqual([holder.status, taker.status], [0, 0], holder.out() + taker.out());
  assert.deepEqual(grants(sandbox), [], 'a grant or turn was left in the table');
});
