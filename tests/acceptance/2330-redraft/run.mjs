// Explicit opt-in: never start a timing suite through test discovery or affected.mjs.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { fingerprint, judgeLimit } from '../../../scripts/benchmark.mjs';
import { build } from './build.mjs';

// Importing the approved reusable scenario/oracle starts no build or process.
export function builder() {
const now = () => Number(process.hrtime.bigint()) / 1e6;
const folder = mkdtempSync('/tmp/a2330-'); // Short enough for Unix sockets on macOS.
const children = new Set(), hubs = new Set();
let serial = 0;
function events(dir) {
  return readdirSync(dir).flatMap(file => {
    const text = readFileSync(join(dir, file), 'utf8');
    // A live writer may be partway through a line. Re-read from the start next time; lose nothing.
    return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(line => JSON.parse(line));
  });
}
function one(rows, kind, pid) {
  const found = rows.filter(e => e.kind === kind && (pid === undefined || e.pid === pid));
  assert.equal(found.length, 1, `INVALID: need exactly one ${kind}`);
  assert(Number.isFinite(found[0].at) && found[0].at > 0, `INVALID: missing ${kind} timestamp`);
  return found[0];
}
async function until(fn) {
  // Only a generous harness hang bound; never an acceptance deadline, never a fixture self-exit.
  const end = now() + 60_000;
  while (now() < end) { const result = fn(); if (result) return result; await new Promise(r => setTimeout(r, 10)); }
  throw Error('BLOCKED: harness did not complete in 60 s');
}
async function quiet(socket) {
  return new Promise((resolve, reject) => {
    const s = net.connect(socket);
    const timer = setTimeout(() => { s.destroy(); reject(Error('INVALID: socket probe timed out')); }, 5000);
    let buffer = '', settled = false;
    const finish = value => { settled = true; clearTimeout(timer); s.destroy(); resolve(value); };
    s.setEncoding('utf8');
    s.on('data', chunk => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      try {
        assert.equal(JSON.parse(buffer.slice(0, buffer.indexOf('\n'))).hello, 'deep-hub');
        finish(false);
      } catch { settled = true; clearTimeout(timer); s.destroy(); reject(Error('INVALID: socket probe malformed hello')); }
    });
    s.once('end', () => {
      if (settled) return;
      if (buffer) { clearTimeout(timer); s.destroy(); reject(Error('INVALID: socket probe partial hello')); }
      else finish(true);
    });
    s.once('error', error => {
      clearTimeout(timer);
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) finish(true);
      else reject(Error(`INVALID: socket probe ${error.code}`));
    });
  });
}
function command(cli, env, root, verb) {
  const child = spawn(process.execPath, [cli, 'hub', verb, '--root', root], { cwd: folder, env });
  children.add(child);
  let stdout = '', stderr = '', result, error, probe;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  child.on('error', e => { error = e; });
  child.on('exit', () => { if (verb === 'stop') { probe = quiet(join(root, 'hub.sock')); probe.catch(() => {}); } });
  child.on('close', (code, signal) => { result = { code, signal, stdout, stderr, done: now() }; children.delete(child); });
  return { child, finish: async () => {
    await until(() => { if (error) throw error; return result; });
    assert.equal(result.signal, null, 'INVALID: command died by signal');
    if (probe) result.quiet = await probe;
    return result;
  } };
}
function success(result) {
  assert.equal(result.code, 0, 'FAIL: CLI exit code changed');
  assert.equal(result.stdout, '', 'FAIL: successful dev-root command is silent');
  assert.equal(result.stderr, '', 'FAIL: successful dev-root command is silent');
}
async function sample(cli, kind) {
  const dir = join(folder, String(++serial)), root = join(dir, 'dev'), log = join(dir, 'events');
  mkdirSync(log, { recursive: true }); mkdirSync(join(dir, 'home'));
  const env = { PATH: '/usr/bin:/bin', HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'home/.config'),
    NODE_OPTIONS: `--import=${join(folder, 'observe.mjs')}`, ACC2330_EVENTS: log,
    ACC2330_OWNER: String(process.pid), ACC2330_MODE: kind };
  const loads = [loadavg()[0]];
  try {
    if (kind === 'start' || kind === 'never') {
      const cmd = command(cli, env, root, 'start');
      const result = await cmd.finish();
      const rows = events(log), launched = one(rows, 'spawn', cmd.child.pid);
      hubs.add(launched.child);
      const boot = one(rows, 'boot', launched.child), exited = one(rows, 'exit', cmd.child.pid);
      assert.equal(boot.start, launched.start, 'INVALID: spawn clock was not propagated');
      if (kind === 'never') {
        assert.equal(result.code, 3, 'FAIL: never-answering start must exit 3');
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, `deep hub start: no hub answered at unix:${root}/hub.sock within 15 s; see ${root}/logs/hub.log\n`);
        assert.equal(rows.filter(e => e.kind === 'listening').length, 0);
        assert.equal(rows.filter(e => e.kind === 'exit' && e.pid === launched.child).length, 0, 'INVALID: never-answering hub died');
        assert(await quiet(join(root, 'hub.sock')), 'INVALID: never-answering hub answered');
        assert(exited.at - launched.at >= 15_000, 'FAIL: start timeout shortened below 15 s');
        return { kind, lower: exited.at - launched.at, upper: result.done - launched.start, limit: 15_100, loads };
      }
      success(result);
      const ready = one(rows, 'listening', launched.child), answer = one(rows, 'witness', launched.child);
      assert(exited.at >= ready.at, 'FAIL: start returned before the socket could answer');
      assert(Number.isFinite(ready.begin) && answer.at >= ready.at && ready.at >= ready.begin && ready.begin >= launched.start + 30, 'INVALID: readiness ordering');
      // A late fixture must not turn a 100 ms poll into a small measured lag.
      assert(answer.at - launched.start <= 35, 'INCONCLUSIVE: scheduled 30 ms answer missed its 5 ms qualification envelope');
      assert(result.done >= answer.at, 'INVALID: independent witness arrived after command completion');
      return { kind, lower: exited.at - answer.at, upper: result.done - ready.begin, limit: 60, loads,
        readyAfterSpawn: ready.at - launched.start, answerAfterSpawn: answer.at - launched.start };
    }
    const peer = command(cli, { ...env, ACC2330_START: String(now()) }, root, 'run');
    await until(() => events(log).some(e => e.kind === 'witness'));
    const cmd = command(cli, env, root, 'stop');
    const result = await cmd.finish();
    if (kind === 'stubborn') {
      assert.equal(result.quiet, false, 'INVALID: stubborn fixture stopped answering');
      assert.notEqual(result.code, 0, 'FAIL: stop reported success while its socket still answers at the 15 s limit');
      return { kind, semantic: true, loads };
    }
    success(result);
    assert.equal(result.quiet, true, 'FAIL: stop completed while its socket still answers');
    const peerResult = await peer.finish();
    assert.equal(peerResult.code, 0, 'INVALID: peer did not exit normally');
    const rows = events(log), requested = one(rows, 'stop-request', peer.child.pid);
    const gone = one(rows, 'going-away', peer.child.pid), exited = one(rows, 'exit', peer.child.pid);
    const cliExit = one(rows, 'exit', cmd.child.pid);
    assert(gone.at >= requested.at + (kind === 'early-close' ? 200 : 30), 'INVALID: peer exited before its schedule');
    assert(cliExit.at >= gone.at, 'FAIL: stop returned during the known socket-answering interval');
    return { kind, lower: Math.max(0, cliExit.at - peerResult.done), upper: result.done - exited.at, limit: 30, loads };
  } finally {
    loads.push(loadavg()[0]);
    for (const row of events(log)) if (row.kind === 'spawn' && Number.isInteger(row.child)) hubs.add(row.child);
    for (const pid of hubs) { try { process.kill(pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
    hubs.clear();
    for (const child of children) child.kill('SIGKILL');
    await until(() => children.size === 0);
  }
}
function close() {
  for (const child of children) child.kill('SIGKILL');
  for (const pid of hubs) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  rmSync(folder, { recursive: true, force: true });
}
try {
  const cli = build(folder);
  return { cli, folder, sample: kind => sample(cli, kind), close };
} catch (error) { close(); throw error; }
}

export function qualifiedMachine() {
  const machine = fingerprint();
  const gate = judgeLimit({ limit: 1, runs: [1, 1, 1, 1, 1], fingerprint: machine,
    loads: Array.from({ length: 5 }, () => ({ start: loadavg()[0], end: loadavg()[0] })) });
  assert(gate.status === 'PASS' && loadavg()[0] < availableParallelism(), `INCONCLUSIVE: no quiet reference Mac: ${gate.reason}`);
  return machine;
}

export async function measureScenario(sample, kind, machine) {
  const rows = [];
  if (kind !== 'stubborn') await sample(kind); // declared warm-up, never retry a failed run
  for (let i = 0; i < (kind === 'stubborn' ? 1 : 5); i++) rows.push(await sample(kind));
  const after = fingerprint();
  const environmentLoads = Array.from({ length: 5 }, () => ({ start: loadavg()[0], end: loadavg()[0] }));
  return { kind, rows, machine, after, environmentLoads };
}

export function judgeScenario({ kind, rows, machine, after, environmentLoads }) {
  const judge = key => judgeLimit({ limit: rows[0].limit, runs: rows.map(r => r[key]), fingerprint: machine,
    loads: rows.map(r => ({ start: r.loads[0], end: r.loads[1] })) });
  const environment = judgeLimit({ limit: 1, runs: [1, 1, 1, 1, 1], fingerprint: after, loads: environmentLoads });
  return environment.status !== 'PASS' || rows.some(r => r.loads.some(v => !Number.isFinite(v) || v < 0 || v >= availableParallelism())) ? 'INCONCLUSIVE'
    : kind === 'stubborn' ? 'PASS' : judge('upper').status === 'PASS' ? 'PASS' : judge('lower').status === 'FAIL' ? 'FAIL' : 'INCONCLUSIVE';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
const mode = process.argv[2];
if (!['--check', '--measure'].includes(mode) || process.argv.length !== 3) {
  console.error('BLOCKED: use --check (no timing) or --measure (authorized quiet-window readings only)');
  process.exit(3);
}
let fixture;
try {
  fixture = builder();
  const { cli, folder, sample } = fixture;
  if (mode === '--check') {
    const env = { HOME: folder, PATH: '/usr/bin:/bin' };
    for (const args of [[cli, 'hub', '--help'], ['--input-type=module', '-e', "await import('@deepbuild/hub/hub')"]]) {
      const result = spawnSync(process.execPath, args, { cwd: folder, env, encoding: 'utf8', timeout: 60_000 });
      assert.equal(result.status, 0, result.stderr || String(result.error));
    }
    console.log('CHECKED: disposable transpilation, real CLI help and public hub entry load; acceptance UNRUN');
  } else {
    const machine = qualifiedMachine();
    for (const [kind, criterion] of [['start', '#2330.c6939f4f'], ['stop', '#2330.c4ac049d'],
      ['early-close', '#2330.c4ac049d'], ['never', '#2330.61815fcc'], ['stubborn', '#2330.c4ac049d']]) {
      try {
        const reading = await measureScenario(sample, kind, machine);
        const { rows, after } = reading;
        const verdict = judgeScenario(reading);
        console.log(JSON.stringify({ criterion, kind, verdict, rows, machine, after }));
      } catch (error) { console.log(JSON.stringify({ criterion, kind, verdict: 'NOT PASS', reason: error.message })); }
    }
    // This file is not a budgets.json task; no standalone reading can close the issue.
    console.error('INCONCLUSIVE: readings only; scheduled-window per-commit/base task registration and 20 samples/side are unmeasured');
    process.exitCode = 3;
  }
} catch (error) { console.error(error.message); process.exitCode = 3; }
finally { fixture?.close(); }
}
