import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const throttle = fileURLToPath(new URL('../scripts/throttle.mjs', import.meta.url));

const until = async (found, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; await pause(100)) if (found()) return true;
  return found();
};

function box(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-throttle-zombie-')));
  const table = join(dir, 'table');
  mkdirSync(table, { recursive: true });
  const readings = join(dir, 'readings.json');
  writeFileSync(readings, JSON.stringify({ memory: 2 ** 40, load: 0, cores: 4 }));
  const env = { ...process.env, HOME: join(dir, 'home'), DEEP_THROTTLE_TABLE: table, DEEP_THROTTLE_READINGS: readings };
  for (const key of ['DEEP_THROTTLE', 'DEEP_THROTTLE_RUN', 'DEEP_WINDOW']) delete env[key];
  const started = [];
  t.after(() => {
    for (const child of started) try { process.kill(child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  return { dir, table, env, started };
}

function psStart(pid) {
  const listing = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
  return listing.stdout.trim();
}

const state = (pid) => spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();

async function unreapedChild(sandbox) {
  const script = "const c = require('node:child_process').spawn('/bin/true'); require('node:fs').writeFileSync(process.argv[1], String(c.pid)); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);";
  const mark = join(sandbox.dir, 'zombie.pid');
  const parent = spawn(process.execPath, ['-e', script, mark], { stdio: 'ignore' });
  sandbox.started.push(parent);
  assert.ok(await until(() => existsSync(mark) && readFileSync(mark, 'utf8'), 10_000), 'the parent never named its child');
  const pid = Number(readFileSync(mark, 'utf8'));
  assert.ok(await until(() => state(pid).startsWith('Z'), 10_000), `child ${pid} never became a zombie: ${state(pid)}`);
  return { pid, start: psStart(pid) };
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

function run(sandbox, args) {
  const child = spawn(process.execPath, [throttle, ...args], { env: sandbox.env, stdio: ['ignore', 'pipe', 'pipe'] });
  sandbox.started.push(child);
  let out = '';
  child.stdout.on('data', (data) => (out += data));
  child.stderr.on('data', (data) => (out += data));
  const result = { status: null, out: () => out };
  child.on('exit', (status, signal) => (result.status = status ?? signal));
  return result;
}

const logged = (sandbox) => (existsSync(join(sandbox.table, 'log')) ? readFileSync(join(sandbox.table, 'log'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const grants = (sandbox) => JSON.parse(readFileSync(join(sandbox.table, 'table.json'), 'utf8')).grants;

test('an admitted build whose command ends while the table lock names an exited, unreaped process exits with its command and gives its grant back', async (t) => {
  const sandbox = box(t);
  const go = join(sandbox.dir, 'go');
  const build = run(sandbox, ['build', '--stall', '30', '--', process.execPath, '-e', `const fs = require('node:fs'); const end = Date.now() + 30000; const wait = () => fs.existsSync(${JSON.stringify(go)}) || Date.now() > end ? process.exit(0) : setTimeout(wait, 50); wait();`]);
  assert.ok(await until(() => logged(sandbox).some((line) => line.event === 'turn'), 20_000), `the build never took its turn:\n${build.out()}`);
  const zombie = await unreapedChild(sandbox);
  await plantLock(sandbox, zombie);
  writeFileSync(go, '');
  const ended = await until(() => build.status !== null, 20_000);
  assert.ok(ended, `the build's throttle was still running 20 s after its command ended, the lock naming exited process ${zombie.pid} (${state(zombie.pid)}):\n${build.out()}`);
  assert.equal(build.status, 0, build.out());
  assert.deepEqual(grants(sandbox), [], 'the build left its grant or turn in the table');
});

test('a grant whose holder exited and was never reaped is released as its holder gone at the next request', async (t) => {
  const sandbox = box(t);
  const zombie = await unreapedChild(sandbox);
  const held = { id: 'deadbeefdeadbeef', class: 'test', pid: zombie.pid, start: zombie.start, nested: false, window: false, index: 1, at: Date.now(), run: true, used: 0, one: true };
  writeFileSync(join(sandbox.table, 'table.json'), JSON.stringify({ grants: [held, { id: 'feedfacefeedface', class: 'turn', run: held.id, pid: zombie.pid, start: zombie.start, nested: true, at: Date.now(), lent: 0 }], requests: [], seq: 1 }));
  const request = run(sandbox, ['build', '--wait', '10', '--', '/bin/true']);
  assert.ok(await until(() => request.status !== null, 30_000), `the request never ended:\n${request.out()}`);
  assert.equal(request.status, 0, request.out());
  const released = logged(sandbox).filter((line) => line.event === 'released' && line.reason === 'holder gone').map((line) => line.id).sort();
  assert.deepEqual(released, ['deadbeefdeadbeef', 'feedfacefeedface'], `the exited holder's grants were not released as gone:\n${JSON.stringify(logged(sandbox), null, 1)}`);
});
