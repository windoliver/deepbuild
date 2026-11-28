// #1333: the main watch's tick holds a slot of its own, the watch class, so its lanes never wait in line behind the
// machine's builds and runs: a build or test asked under a held watch grant passes through at once, and a second
// watch waits for the first.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function box(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'throttle-watch-')));
  const home = join(dir, 'home'), table = join(dir, 'table');
  mkdirSync(home);
  mkdirSync(table);
  cpSync(join(ROOT, 'scripts'), join(dir, 'repo', 'scripts'), { recursive: true });
  // 1 GiB available: the first build starts, and the memory rule admits no second one beside it.
  writeFileSync(join(dir, 'readings.json'), JSON.stringify({ memory: 2 ** 30, load: 0, cores: 2 }));
  const env = { ...process.env, HOME: home, DEEP_THROTTLE_TABLE: table, DEEP_THROTTLE_READINGS: join(dir, 'readings.json'), PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };
  for (const key of ['DEEP_THROTTLE', 'DEEP_THROTTLE_RUN', 'NODE_TEST_CONTEXT']) delete env[key];
  const holders = [];
  t.after(async () => {
    writeFileSync(join(dir, 'stop'), '');
    await Promise.all(holders.map((child) => new Promise((r) => (child.exitCode !== null ? r() : child.on('close', r)))));
    rmSync(dir, { recursive: true, force: true });
  });
  const throttle = join(dir, 'repo', 'scripts', 'throttle.mjs');
  const run = (args) => spawnSync(process.execPath, [throttle, ...args], { env, cwd: join(dir, 'repo'), encoding: 'utf8', timeout: 120_000 });
  // A grant of `cls` held by a chain of its own until the test ends; resolves once its command runs.
  const hold = async (cls) => {
    const started = join(dir, `${cls}-${holders.length}`);
    const child = spawn(process.execPath, [throttle, cls, '--wait', '1', '--', 'sh', '-c', `touch "${started}"; while [ ! -e "${join(dir, 'stop')}" ]; do sleep 0.1; done`], { env, cwd: join(dir, 'repo'), stdio: 'ignore' });
    holders.push(child);
    // deadline: a look each 50 ms, for at most the minute a loaded machine's slowest start takes.
    for (const end = Date.now() + 60_000; Date.now() < end && !existsSync(started);) await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(started), `the ${cls} holder never started (the harness proves nothing)`);
  };
  return { dir, throttle, run, hold };
}

test('a build asked under a watch grant starts at once while a top-level build waits in line', async (t) => {
  const { dir, throttle, run, hold } = box(t);
  await hold('build');
  // The control: a build outside the watch gets no grant in its 3 s wait.
  const outside = run(['build', '--wait', '0.05', '--', 'true']);
  assert.equal(outside.status, 3, `a top-level build should wait past its bound: ${outside.stdout}${outside.stderr}`);
  assert.match(outside.stdout, /INCONCLUSIVE no grant: no build grant came within 0.05 min/);
  const built = join(dir, 'built');
  const watched = run(['watch', '--wait', '0.05', '--', process.execPath, throttle, 'build', '--wait', '0.05', '--', 'touch', built]);
  assert.equal(watched.status, 0, `the watch's build should pass through: ${watched.stdout}${watched.stderr}`);
  assert.ok(existsSync(built), 'the build under the watch grant never ran');
});

test('a second watch waits for the first: the class has one slot', async (t) => {
  const { run, hold } = box(t);
  await hold('watch');
  const second = run(['watch', '--wait', '0.05', '--', 'true']);
  assert.equal(second.status, 3, `a second watch should get no grant: ${second.stdout}${second.stderr}`);
  assert.match(second.stdout, /INCONCLUSIVE no grant: no watch grant came within 0.05 min/);
});
