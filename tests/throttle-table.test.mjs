// Which table a throttle request uses (#2744, docs/parallel-proof.md section 6, "Tables of a test's own"): outside a
// test run the machine's, whatever HOME says and whatever words its command carries; inside one, its sandbox HOME's,
// whatever DEEP_THROTTLE names. The requests outside a test run are real ones on the machine's table, each a
// `test --wait` of seconds: they are started through a shell that exits, so no test runner is among their ancestors.
// And a hung grant's end (the same section, "A hung holder's bound") when the log can't be written or ps fails.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const throttle = fileURLToPath(new URL('../scripts/throttle.mjs', import.meta.url));
const machineLog = join(userInfo().homedir, '.deepbuild', 'throttle', 'log');
const clean = (home) => {
  const env = { ...process.env, HOME: home };
  for (const key of ['DEEP_THROTTLE', 'DEEP_THROTTLE_TABLE', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT']) delete env[key];
  return env;
};
// A folder removed after the test, once `stop` has ended what the test started in it: a process still polling its
// table would write into the folder as it goes.
const sandbox = (t, stop = () => {}) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-throttle-table-')));
  t.after(() => {
    stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  mkdirSync(join(dir, 'home'));
  return dir;
};
// Stops a process this test started, by the PID a file holds: an empty or half-written file names no process, and
// 0 would be this test's whole group.
const kill = (file) => {
  const pid = existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0;
  if (Number.isInteger(pid) && pid > 1) try { process.kill(pid, 'SIGKILL'); } catch {}
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
  return { status: () => (existsSync(status) && readFileSync(status, 'utf8').trim() ? Number(readFileSync(status, 'utf8')) : null), pid: () => Number(readFileSync(pid, 'utf8')), out: () => readFileSync(join(dir, `${name}.out`), 'utf8') };
}

for (const [title, command] of [
  ['with a HOME of its own', ['/bin/echo', 'ran']],
  ['whose command carries the word --test', ['/bin/echo', '--test']],
]) {
  test(`outside a test run, a request ${title} is the machine's: its HOME gets no table, and the machine's log names it`, async (t) => {
    const dir = sandbox(t);
    const from = existsSync(machineLog) ? statSync(machineLog).size : 0;
    const run = outside(dir, 'request', ['test', '--wait', '0.05', '--', ...command]);
    if (!await until(() => run.status() !== null, 60_000)) {
      // A budget window stops every wait from running down (section 12a), so the request is taken back, by its PID.
      kill(join(dir, 'request.pid'));
      if (readFileSync(join(machineLog, '..', 'table.json'), 'utf8').includes('"window":true')) return t.skip('INCONCLUSIVE: a budget window is open or pending on the machine\'s table, so the request\'s wait never ran down');
      assert.fail('the request never ended');
    }
    // Granted, or no grant within its 3 s: either way it was the machine's table that answered.
    assert.ok([0, 3].includes(run.status()), `exit ${run.status()}:\n${run.out()}`);
    assert.ok(!existsSync(join(dir, 'home', '.deepbuild')), `a table was made under the request's own HOME:\n${run.out()}`);
    const lines = readFileSync(machineLog, 'utf8').slice(from).split('\n').filter((line) => line.includes(`"pid":${run.pid()},`) || line.includes(`"pid":${run.pid()}}`));
    assert.ok(lines.length, `the machine's log has no line for pid ${run.pid()}`);
  });
}

test('inside a test run, a request with a sandbox HOME keeps that HOME\'s table, whatever DEEP_THROTTLE names: this run\'s own grant, when it has one', (t) => {
  const dir = sandbox(t);
  // Under affected.mjs or a preflight this names the run's grant in the machine's table; started by hand, no grant.
  const named = process.env.DEEP_THROTTLE ?? 'test:0000000000000000';
  const home = join(dir, 'home');
  const request = spawnSync(process.execPath, [throttle, 'test', '--wait', '0.05', '--', process.execPath, '-e', 'console.log(process.env.DEEP_THROTTLE)'], { encoding: 'utf8', env: { ...clean(home), DEEP_THROTTLE: named } });
  assert.equal(request.status, 0, request.stdout + request.stderr);
  assert.match(request.stdout, /^test:[0-9a-f]+$/m);
  assert.notEqual(request.stdout.trim(), named, 'the request passed through on the grant DEEP_THROTTLE names, in the machine\'s table');
  const log = join(home, '.deepbuild', 'throttle', 'log');
  assert.ok(existsSync(log), 'the sandbox HOME got no table: the request went to the machine\'s');
  const id = request.stdout.trim().split(':')[1];
  assert.ok(readFileSync(log, 'utf8').split('\n').some((line) => line.includes('"event":"granted"') && line.includes(id)), 'the sandbox table\'s log has no grant for the request');
});

// A hung holder on a table of the test's own: a command that ignores SIGTERM, held past a bound of seconds while a
// timed request waits. `broken` breaks something once the holder has its grant (or has logged `expired`).
for (const [title, breakAt, broken] of [
  ['the table\'s log can\'t be written', 'granted', ({ table }) => chmodSync(join(table, 'log'), 0o444)],
  ['ps fails after the SIGTERM', 'expired', ({ dir }) => writeFileSync(join(dir, 'ps-fails'), '')],
]) {
  test(`a hung grant past its bound is still ended and INCONCLUSIVE when ${title}`, async (t) => {
    const started = [];
    const dir = sandbox(t, () => {
      for (const child of started) child.kill('SIGKILL');
      kill(join(dir, 'held'));
    });
    const table = join(dir, 'table'), bin = join(dir, 'bin'), held = join(dir, 'held');
    mkdirSync(table);
    mkdirSync(bin);
    // A ps that fails once the file is there, and is the machine's own until then.
    const ps = execFileSync('/bin/sh', ['-c', 'command -v ps'], { encoding: 'utf8' }).trim();
    writeFileSync(join(bin, 'ps'), `#!/bin/sh\n[ -e ${JSON.stringify(join(dir, 'ps-fails'))} ] && exit 2\nexec ${ps} "$@"\n`, { mode: 0o755 });
    const env = { ...clean(join(dir, 'home')), DEEP_THROTTLE_TABLE: table, PATH: `${bin}${delimiter}${process.env.PATH}` };
    // The hung command; it ends by itself only 20 s after its throttle.mjs is gone, so a stopped test leaves nothing
    // for good, and a throttle.mjs that exits without ending it is still caught.
    const stub = `process.on('SIGTERM', () => {}); const parent = process.ppid; require('fs').writeFileSync(${JSON.stringify(held)}, String(process.pid)); setInterval(() => process.ppid !== parent && setTimeout(() => process.exit(), 20_000), 1000)`;
    const start = (args) => {
      const child = spawn(process.execPath, [throttle, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      started.push(child);
      const run = { out: '', status: null };
      child.stdout.on('data', (chunk) => { run.out += chunk; });
      child.stderr.on('data', (chunk) => { run.out += chunk; });
      child.on('exit', (status) => { run.status = status; });
      return run;
    };
    const alive = (pid) => { try { return process.kill(pid, 0); } catch { return false; } };
    const holder = start(['test', '--wait', '0.2', '--hold', '0.02', '--', process.execPath, '-e', stub]);
    assert.ok(await until(() => existsSync(held) && readFileSync(held, 'utf8'), 30_000), `the holder got no grant:\n${holder.out}`);
    const command = Number(readFileSync(held, 'utf8'));
    const logged = (event) => readFileSync(join(table, 'log'), 'utf8').includes(`"event":"${event}"`);
    if (breakAt === 'granted') broken({ dir, table });
    start(['timed', '--wait', '2', '--', '/bin/echo', 'timed']);
    if (breakAt === 'expired') {
      assert.ok(await until(() => logged('expired'), 30_000), `the grant never expired:\n${holder.out}`);
      broken({ dir, table });
    }
    assert.ok(await until(() => holder.status !== null, 45_000), `the holder's throttle.mjs never ended:\n${holder.out}`);
    assert.equal(holder.status, 3, holder.out);
    assert.match(holder.out, /^INCONCLUSIVE throttle: the test grant [0-9a-f]+ was held past its 0\.02 min bound/m);
    assert.ok(await until(() => !alive(command), 5_000), 'the hung command runs on');
  });
}
