import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';
import { now } from './hub.mjs';

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
let dir, cli;
const preload = fileURLToPath(new URL('./hub.mjs', import.meta.url));
const trace = (root) => {
  try {
    const text = readFileSync(join(root, 'trace.jsonl'), 'utf8');
    return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(JSON.parse);
  }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
};
const event = (root, name) => trace(root).find((e) => e.event === name);
const children = new Set();
before(() => {
  assert.notEqual(process.platform, 'win32', 'BLOCKED: real Unix sockets required');
  dir = mkdtempSync('/tmp/d2330-');
  cli = build(join(dir, 'build'));
  const read = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };
  const model = process.platform === 'darwin' ? read('/usr/sbin/sysctl', ['-n', 'hw.model']) : 'not a reference Mac';
  console.log(JSON.stringify({ date: new Date().toISOString(), node: process.version, platform: process.platform,
    arch: process.arch, os: release(), model, macOSBuild: process.platform === 'darwin' ? read('/usr/bin/sw_vers', ['-buildVersion']) : null,
    cores: availableParallelism(), load: loadavg(),
    power: process.platform === 'darwin' ? (/AC Power/.test(read('/usr/bin/pmset', ['-g', 'batt'])) ? 'AC' : 'unknown/battery') : 'unknown',
    budget: 'INCONCLUSIVE: local readings, not the scheduled budget window; thermal state, Low Power Mode and instruction counters not certified' }));
});
after(async () => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await Promise.all([...children].map((c) => c.done));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function world(t, mode) {
  const root = mkdtempSync(join(dir, 'r-'));
  mkdirSync(join(root, 'home'));
  writeFileSync(join(root, 'mode'), mode);
  // The only detached child is the one real `hub start` launches. Its own trace proves ownership.
  t.after(async () => {
    const started = event(root, 'start');
    if (started && !event(root, 'exit')) {
      try { process.kill(started.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
      const deadline = now() + 1500;
      while (!event(root, 'exit') && now() < deadline) await wait(5);
      if (!event(root, 'exit')) {
        try { process.kill(started.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
      }
    }
  });
  return root;
}
function command(root, verb, args = []) {
  const started = now();
  const child = spawn(process.execPath, [cli, 'hub', verb, '--root', root, ...args], {
    cwd: root, env: { HOME: join(root, 'home'), TMPDIR: root, PATH: '/usr/bin:/bin',
      NODE_OPTIONS: `--import=${JSON.stringify(preload)}`, ACC2330_OWNER: String(process.pid), LC_ALL: 'C', TZ: 'UTC' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (b) => { stdout += b; });
  child.stderr.on('data', (b) => { stderr += b; });
  child.done = new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      const ended = now();
      // Launch a real hello probe at command exit, not after awaiting hub exit/cleanup.
      const quiet = verb === 'stop' ? answers(root).then((a) => !a) : Promise.resolve(null);
      child.once('close', async () => done({ code, signal, stdout, stderr, started, ended, quiet: await quiet }));
    });
  });
  const watchdog = verb === 'run' ? undefined : setTimeout(() => child.kill('SIGKILL'), 17_000);
  child.done.finally(() => clearTimeout(watchdog));
  return child;
}
function answers(root) {
  return new Promise((done) => {
    const socket = net.connect(join(root, 'hub.sock'));
    const timer = setTimeout(() => finish(false), 500);
    let buffer = '';
    function finish(answered) { clearTimeout(timer); socket.destroy(); done(answered); }
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.includes('\n')) finish(JSON.parse(buffer.split('\n')[0]).hello === 'deep-hub');
    });
    socket.on('error', () => finish(false));
    socket.on('end', () => finish(false));
  });
}
async function ready(root) {
  const deadline = now() + 3000;
  while (!event(root, 'first-answer') && now() < deadline) await wait(2);
  assert.ok(event(root, 'first-answer'), 'BLOCKED: stand-in did not answer');
}
function success(result) {
  assert.equal(result.signal, null, 'command must finish, not hit the harness watchdog');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '', 'unchanged successful command stdout');
  assert.equal(result.stderr, '', 'unchanged successful command stderr');
}
function fixture(root) {
  const start = event(root, 'start'), ready = event(root, 'ready'), answer = event(root, 'first-answer');
  assert.ok(start && ready && answer, 'stand-in actually started, listened and answered');
  const age = ready.t - start.started, witnessLag = answer.t - ready.t;
  // These are fixture-validity checks, NOT extra allowances on either command's budget.
  assert.ok(age >= 30 && age <= 35, `INCONCLUSIVE: 30 ms readiness schedule missed: ${age.toFixed(3)} ms`);
  assert.ok(witnessLag >= 0 && witnessLag <= 5, `INCONCLUSIVE: independent first answer delayed ${witnessLag.toFixed(3)} ms`);
  return { readyMs: age, witnessLagMs: witnessLag, ready: ready.t, answer: answer.t };
}
function latency(t, name, rows, limit) {
  t.diagnostic(`${name} raw local readings (ms): ${JSON.stringify(rows)}`);
  const values = rows.map((r) => r.lagMs).sort((a, b) => a - b);
  t.diagnostic(`${name} p50=${values[2].toFixed(3)} p95=${values[4].toFixed(3)}; formal budget INCONCLUSIVE (see environment/README)`);
  assert.ok(rows.every((r) => r.lagMs >= 0 && r.lagMs <= limit),
    `${name}: every return must be within ${limit} ms; observed ${values.map((v) => v.toFixed(3)).join(', ')} ms`);
  assert.ok(loadavg()[0] < availableParallelism(), 'INCONCLUSIVE: load at or above CPU count; not a budget pass');
  t.skip('INCONCLUSIVE budget: local assertion readings only, not a scheduled-window receipt');
}

test('AC1: hub answers at 30 ms; deep hub start --root returns within 60 ms of first answer', { timeout: 20_000 }, async (t) => {
  const rows = [];
  for (let i = 0; i < 6; i++) { // one warm-up, then five fixed samples; no retry-until-green
    const root = world(t, 'normal');
    const result = await command(root, 'start').done;
    success(result);
    const f = fixture(root);
    assert.ok(result.ended >= f.answer, 'start must not succeed before the socket answers');
    if (i) rows.push({ readyMs: f.readyMs, witnessLagMs: f.witnessLagMs,
      readinessToReturnMs: result.ended - f.ready, lagMs: result.ended - f.answer });
    if (i === 0) { success(await command(root, 'start').done); assert.equal(trace(root).filter((e) => e.event === 'start').length, 1, 'already running: no second hub'); }
    // Cleanup exercises the real stop too; only AC1 is timed here.
    success(await command(root, 'stop').done);
  }
  latency(t, 'AC1 first answer -> CLI exit', rows, 60);
});

test('AC2: deep hub stop --root returns within 30 ms of exit, never while socket answers', { timeout: 20_000 }, async (t) => {
  const rows = [];
  for (let i = 0; i < 6; i++) {
    const root = world(t, 'normal');
    const hub = command(root, 'run');
    await ready(root);
    const result = await command(root, 'stop').done;
    success(result);
    assert.equal(result.quiet, true, 'stop returned success while a fresh socket connection still answered');
    const exit = event(root, 'exit'), request = event(root, 'stop-request');
    assert.ok(exit && request, 'hub.stop was received and the hub exited');
    assert.ok(result.ended >= exit.t, 'successful stop must follow hub exit');
    await hub.done;
    if (i) rows.push({ requestToExitMs: exit.t - request.t, lagMs: result.ended - exit.t });
  }
  latency(t, 'AC2 hub exit hook -> CLI exit', rows, 30);
});

test('AC2 guard: closing the control connection is not enough while the socket still answers', { timeout: 5000 }, async (t) => {
  const root = world(t, 'early-close'), hub = command(root, 'run');
  await ready(root);
  const result = await command(root, 'stop').done;
  success(result);
  const closed = event(root, 'control-close'), exit = event(root, 'exit');
  assert.ok(closed, 'fixture closed the control connection early');
  assert.equal(result.quiet, true, 'successful stop while socket still answers after control close');
  assert.ok(exit && result.ended >= exit.t, 'must wait for the still-answering listener to exit');
  assert.ok(exit.t - closed.t >= 200, 'fixture kept listening after control close');
  await hub.done;
});

test('AC2 guard: a socket still answering at the 15 s stop limit cannot yield success', { timeout: 20_000 }, async (t) => {
  const root = world(t, 'stays-up'), hub = command(root, 'run');
  await ready(root);
  const result = await command(root, 'stop').done;
  assert.equal(result.signal, null, '15 s stop limit must not become an indefinite wait');
  assert.equal(await answers(root), true, 'fixture still answers at command return');
  t.diagnostic(`stop limit reading: ${(result.ended - result.started).toFixed(3)} ms, exit ${result.code}, socket answering`);
  hub.kill('SIGTERM');
  await hub.done;
  assert.notEqual(result.code, 0, 'deep hub stop returned success while the socket still answers (including at its 15 s limit)');
});

test("AC3: a hub that never answers fails at 15 s with today's message and exit 3", { timeout: 20_000 }, async (t) => {
  const root = world(t, 'never');
  const result = await command(root, 'start').done;
  assert.ok(event(root, 'start'), 'the stand-in was launched by the real start command');
  assert.equal(event(root, 'ready'), undefined, 'fixture never opened the socket');
  assert.equal(result.signal, null);
  assert.equal(result.code, 3);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `deep hub start: no hub answered at unix:${root}/hub.sock within 15 s; see ${root}/logs/hub.log\n`);
  const elapsed = result.ended - result.started;
  t.diagnostic(`15 s deadline, CLI spawn -> observed process exit: ${elapsed.toFixed(3)} ms`);
  assert.ok(elapsed >= 15_000, 'must not fail before the unchanged 15 s deadline');
  const sinceLaunch = result.ended - event(root, 'start').started;
  assert.ok(sinceLaunch <= 15_100, `15 s from hub launch plus at most one existing 100 ms observation step: ${sinceLaunch.toFixed(3)} ms`);
  t.diagnostic('Timeout message/exit/real wait verified; formal timing budget remains INCONCLUSIVE.');
});

test('unchanged stop error: missing dev hub, exit 3 and existing diagnostic', async (t) => {
  const root = world(t, 'never');
  const result = await command(root, 'stop').done;
  assert.equal(result.signal, null);
  assert.equal(result.code, 3);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `deep hub stop: no hub could be stopped at unix:${root}/hub.sock: connect ENOENT ${root}/hub.sock\n`);
});
