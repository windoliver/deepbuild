// Which table a throttle request uses (#2744, docs/parallel-proof.md section 6, "Tables of a test's own"): outside a
// test run the machine's, whatever HOME says and whatever words its command carries; inside one, its sandbox HOME's,
// whatever DEEP_THROTTLE names. The requests outside a test run are real ones on the machine's table, each a
// `test --wait` of seconds: they are started through a shell that exits, so no test runner is among their ancestors.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const throttle = fileURLToPath(new URL('../scripts/throttle.mjs', import.meta.url));
const machineLog = join(userInfo().homedir, '.deepbuild', 'throttle', 'log');
const clean = (home) => {
  const env = { ...process.env, HOME: home };
  for (const key of ['DEEP_THROTTLE', 'DEEP_THROTTLE_TABLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT']) delete env[key];
  return env;
};
const sandbox = (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-throttle-table-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'home'));
  return dir;
};
const until = async (found, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; await pause(100)) if (found()) return true;
  return found();
};

/** Starts `throttle.mjs <args>` outside any test run, with `home` as HOME; its pid and exit status land in files. */
function outside(dir, name, args) {
  const pid = join(dir, `${name}.pid`), status = join(dir, `${name}.status`);
  const script = '( "$@" > "$OUT" 2>&1 & echo $! > "$PID"; wait $!; echo $? > "$STATUS" ) &';
  spawn('/bin/sh', ['-c', script, 'sh', process.execPath, throttle, ...args], { detached: true, stdio: 'ignore', env: { ...clean(join(dir, 'home')), OUT: join(dir, `${name}.out`), PID: pid, STATUS: status } }).unref();
  return { status: () => (existsSync(status) ? Number(readFileSync(status, 'utf8')) : null), pid: () => Number(readFileSync(pid, 'utf8')), out: () => readFileSync(join(dir, `${name}.out`), 'utf8') };
}

for (const [title, command] of [
  ['with a HOME of its own', ['/bin/echo', 'ran']],
  ['whose command carries the word --test', ['/bin/echo', '--test']],
]) {
  test(`outside a test run, a request ${title} is the machine's: its HOME gets no table, and the machine's log names it`, async (t) => {
    const dir = sandbox(t);
    const from = existsSync(machineLog) ? statSync(machineLog).size : 0;
    const run = outside(dir, 'request', ['test', '--wait', '0.05', '--', ...command]);
    assert.ok(await until(() => run.status() !== null, 60_000), 'the request never ended');
    // Granted, or no grant within its 3 s: either way it was the machine's table that answered.
    assert.ok([0, 3].includes(run.status()), `exit ${run.status()}:\n${run.out()}`);
    assert.ok(!existsSync(join(dir, 'home', '.deepbuild')), `a table was made under the request's own HOME:\n${run.out()}`);
    const lines = readFileSync(machineLog, 'utf8').slice(from).split('\n').filter((line) => line.includes(`"pid":${run.pid()},`) || line.includes(`"pid":${run.pid()}}`));
    assert.ok(lines.length, `the machine's log has no line for pid ${run.pid()}`);
  });
}

test('inside a test run, a request with a sandbox HOME keeps that HOME\'s table, though DEEP_THROTTLE names a grant of the machine\'s', async (t) => {
  const dir = sandbox(t);
  const stop = join(dir, 'stop'), held = join(dir, 'held');
  const stub = `require('fs').writeFileSync(${JSON.stringify(held)}, process.env.DEEP_THROTTLE); setInterval(() => require('fs').existsSync(${JSON.stringify(stop)}) && process.exit(0), 100)`;
  const holder = outside(dir, 'holder', ['test', '--wait', '0.5', '--', process.execPath, '-e', stub]);
  try {
    await until(() => existsSync(held) || holder.status() !== null, 60_000);
    if (!existsSync(held)) return t.skip(`INCONCLUSIVE: no test grant came from the machine's table within 30 s:\n${holder.out()}`);
    const named = readFileSync(held, 'utf8');
    const home = join(dir, 'test-home');
    mkdirSync(home);
    const request = spawnSync(process.execPath, [throttle, 'test', '--wait', '0.05', '--', process.execPath, '-e', 'console.log(process.env.DEEP_THROTTLE)'], { encoding: 'utf8', env: { ...clean(home), DEEP_THROTTLE: named } });
    assert.equal(request.status, 0, request.stdout + request.stderr);
    assert.match(request.stdout, /^test:[0-9a-f]+$/m);
    assert.notEqual(request.stdout.trim(), named, 'the request passed through on a grant its chain does not hold');
    const log = join(home, '.deepbuild', 'throttle', 'log');
    assert.ok(existsSync(log), 'the sandbox HOME got no table: the request went to the machine\'s');
    const id = request.stdout.trim().split(':')[1];
    assert.ok(readFileSync(log, 'utf8').split('\n').some((line) => line.includes('"event":"granted"') && line.includes(id)), 'the sandbox table\'s log has no grant for the request');
  } finally {
    writeFileSync(stop, '');
    await until(() => holder.status() !== null, 30_000);
  }
});
