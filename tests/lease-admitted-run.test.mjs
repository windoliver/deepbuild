// #3238: scripts/lease takes no turn of the pool inside an admitted affected.mjs run (#3221), so a lint that run starts
// through it under no turn runs at once though another job holds every token, and the log shows `passed` for it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('a command scripts/lease runs in an admitted run under no turn starts while the pool is full', async (t) => {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'lease-admitted-')));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const repo = join(box, 'repo'), home = join(box, 'home'), table = join(box, 'table');
  mkdirSync(home);
  mkdirSync(table);
  cpSync(join(ROOT, 'scripts'), join(repo, 'scripts'), { recursive: true });
  // Two cores: a pool of one token.
  writeFileSync(join(box, 'readings.json'), JSON.stringify({ memory: 2 ** 40, load: 0, cores: 2 }));
  const env = { ...process.env, HOME: home, DEEP_THROTTLE_TABLE: table, DEEP_THROTTLE_READINGS: join(box, 'readings.json'), DEEP_THROTTLE_RUN: '0', PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };
  for (const key of ['DEEP_THROTTLE', 'DEEP_HUB_PLANT', 'DEEP_LEASE_WAIT', 'NODE_TEST_CONTEXT']) delete env[key];
  const throttle = join(repo, 'scripts/throttle.mjs'), lease = join(repo, 'scripts/lease');
  const busy = join(box, 'busy'), lint = join(box, 'lint'), stop = join(box, 'stop');
  // The run: one job holds the only token until `stop` exists; the lint is then started through the script.
  writeFileSync(join(box, 'run.mjs'), `
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const job = spawn(process.execPath, [${JSON.stringify(throttle)}, 'build', '--', 'sh', '-c', 'touch "${busy}"; while [ ! -e "${stop}" ]; do sleep 0.1; done'], { stdio: 'inherit' });
while (!existsSync(${JSON.stringify(busy)})) await new Promise((r) => setTimeout(r, 50));
const lint = spawn(${JSON.stringify(lease)}, ['touch', ${JSON.stringify(lint)}], { stdio: 'inherit' });
await Promise.all([job, lint].map((child) => new Promise((r) => child.on('close', r))));
`);
  const run = spawn(process.execPath, [throttle, 'test', '--wait', '1', '--', process.execPath, join(box, 'run.mjs')], { env, cwd: repo, stdio: 'ignore' });
  const closed = new Promise((r) => run.on('close', r));
  const until = async (file) => {
    // deadline: a look each 50 ms, for at most the minute a loaded machine's slowest start takes.
    for (const end = Date.now() + 60_000; Date.now() < end && !existsSync(file);) await new Promise((r) => setTimeout(r, 50));
    return existsSync(file);
  };
  try {
    assert.ok(await until(busy), 'the other job never took the pool\'s token (the harness proves nothing)');
    const atOnce = await until(lint);
    const log = readFileSync(join(table, 'log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(atOnce, 'the lint waited for a turn while another job of the run held the only token');
    // `turn` entries: the job's alone. The lint's is a `passed` one, with no turn of its own.
    assert.equal(log.filter((entry) => entry.event === 'turn').length, 1, `one job took a turn: ${JSON.stringify(log)}`);
    assert.equal(log.filter((entry) => entry.event === 'passed').length, 2, `the job and the lint each passed through: ${JSON.stringify(log)}`);
    assert.deepEqual(log.filter((entry) => entry.class === 'build' && ['granted', 'timeout'].includes(entry.event)), [], 'no build request');
  } finally {
    writeFileSync(stop, '');
    await closed;
  }
});
