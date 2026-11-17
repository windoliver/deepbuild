// Helpers for the blind redraft of #2570's installed-hub tests (REDRAFT.md). A sandboxed HOME under /tmp, the
// service-manager stand-in behind the base's DEEP_HUB_LAUNCHER seam, tripwires for the real launchctl and systemctl,
// and the hub's socket spoken to directly. Nothing here imports the code under test: the CLI and the hub are reached
// by running `deep` and by the socket.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export { assert };
export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(CHECKOUT, 'packages', 'cli', 'dist', 'main.js');
export const DEEP_HOOK = join(CHECKOUT, 'target', 'debug', 'deep-hook');
export const NODE = process.execPath;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** A criterion's ID as scripts/proof-change.mjs derives it: the first eight hex digits of the SHA-256 of its text. */
const criterion = (text) => `#2570.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
export const AC1 = criterion("`deep hub start` asked for while a stopped hub's process is still exiting ends with a hub answering, exit 0");
export const AC2 = criterion("With no hub and none exiting it starts one as today; a hub that never answers still fails at 15 s with today's message and exit 3");
/** The base's wait for a hub to answer after the service manager was asked (service.ts, WAIT_MS). */
export const WAIT_MS = 15_000;

export const wait = (ms) => new Promise((done) => setTimeout(done, ms));
export const loadReading = () => `1-minute load ${loadavg()[0].toFixed(0)} on ${availableParallelism()} cores`;
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const script = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
export const inconclusive = (why) => assert.fail(`INCONCLUSIVE: ${why}, at ${loadReading()}; run it again on a quieter machine`);

/** What this folder needs built in this checkout (REDRAFT.md: How to run). */
function built() {
  const missing = [CLI, DEEP_HOOK].filter((path) => !existsSync(path));
  assert.deepEqual(missing, [], `BLOCKED: build first (npm ci && npm run build --workspaces && cargo build --locked -p deep-hook); missing: ${missing.join(', ')}`);
}

/** The real service manager's files for the installed hub, in the real home: they must not change. */
const REAL = [join(userInfo().homedir, '.config', 'systemd', 'user', 'deepbuild-hub.service'), join(userInfo().homedir, 'Library', 'LaunchAgents', 'com.deepbuild.hub.plist')];
const stamp = () => REAL.map((file) => { try { const s = statSync(file); return `${file} ${s.mtimeMs} ${s.size}`; } catch { return `${file} absent`; } });

/**
 * A sandbox removed after the test: HOME, TMPDIR and XDG_* inside it; first on PATH, the stand-in for the service
 * manager (`launcher`) and `launchctl` and `systemctl` tripwires, which record any call and exit 1. At the end it
 * checks no tripwire fired and no real service file changed, then stops every process it started, by PID.
 */
export function sandbox(t) {
  built();
  // Short: the hub's socket is <home>/.deepbuild/hub.sock, and a Unix socket path must stay short.
  const dir = realpathSync(mkdtempSync('/tmp/b2570-'));
  const home = join(dir, 'h'), temp = join(dir, 't'), bin = join(dir, 'bin'), sm = join(dir, 'sm');
  for (const folder of [home, temp, bin, sm]) mkdirSync(folder, { recursive: true });
  symlinkSync(NODE, join(bin, 'node'));
  script(join(bin, 'launcher'), `#!/bin/sh\nT2570_SM=${JSON.stringify(sm)} exec ${JSON.stringify(NODE)} ${JSON.stringify(join(FIXTURES, 'service-manager.mjs'))} "$@"\n`);
  const calls = join(dir, 'real-service-manager-calls.log');
  for (const name of ['launchctl', 'systemctl']) {
    script(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' ${name} "$*" >> ${JSON.stringify(calls)}\necho "tripwire ${name}: the tests' service manager is DEEP_HUB_LAUNCHER" >&2\nexit 1\n`);
  }
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|CODEX_|GH_|GITHUB_|ANTHROPIC|OPENAI|XDG_|AWS_|GIT_|CARGO_TARGET|T2570_)/.test(name)) continue;
    if (['NODE_OPTIONS', 'NODE_TEST_CONTEXT', 'AI_AGENT'].includes(name)) continue;
    env[name] = value;
  }
  Object.assign(env, {
    HOME: home, TMPDIR: temp,
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local', 'share'), XDG_STATE_HOME: join(home, '.local', 'state'),
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    DEEP_HUB_LAUNCHER: join(bin, 'launcher'),
    TZ: 'UTC', LC_ALL: 'C',
  });
  const root = join(home, '.deepbuild');
  const box = { dir, home, sm, env, root, socket: join(root, 'hub.sock'), token: join(root, 'control.token'), logs: join(root, 'logs'), children: [] };
  box.events = () => lines(join(sm, 'events.jsonl'));
  box.behave = (o) => writeFileSync(join(sm, 'behaviour.json'), JSON.stringify(o));
  box.realCalls = () => (existsSync(calls) ? readFileSync(calls, 'utf8') : '');
  const before = stamp();
  t.after(async () => {
    const groups = new Set();
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null && child.pid) groups.add(child.pid);
    try { groups.add(Number(readFileSync(join(sm, 'supervisor.pid'), 'utf8'))); } catch { /* never loaded */ }
    for (const e of box.events()) if (e.event === 'start' && e.pid) groups.add(e.pid);
    for (const pid of groups) try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ }
    await wait(1500);
    for (const pid of groups) try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
    rmSync(dir, { recursive: true, force: true });
  });
  /** What every test checks last: the real service manager was never called, and its files in the real home are as they were. */
  box.untouched = () => {
    assert.equal(box.realCalls(), '', 'the real launchctl or systemctl was called; the tests must reach only the stand-in');
    assert.deepEqual(stamp(), before, "a real service file in the real home changed during the test");
  };
  return box;
}

/** `deep <args>`, this checkout's CLI, in the sandbox, in a process group of its own; stopped by its PID after `ms`. */
export function deep(box, args, ms = 120_000) {
  const child = spawn(NODE, [CLI, ...args], { cwd: box.dir, env: box.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  const started = Date.now();
  const stop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, ms);
  return new Promise((done) => {
    child.on('error', (error) => { stderr += String(error); });
    child.on('close', (status, signal) => { clearTimeout(stop); done({ status, signal, stdout, stderr, started, ended: Date.now(), ms: Date.now() - started }); });
  });
}
export const shown = (run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''} after ${run.ms} ms\nstdout:\n${run.stdout.slice(-2000)}\nstderr:\n${run.stderr.slice(-2000)}`;

/** The hub's socket as the CLI speaks it: lines of JSON, the hub's hello first. */
function connect(path, ms = 5000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(path);
    const got = [];
    const waiting = [];
    let buffer = '';
    let failed;
    const timer = setTimeout(() => fail(Object.assign(Error(`no hello within ${ms} ms`), { code: 'TIMEOUT' })), ms);
    const fail = (error) => {
      if (failed) return;
      failed = error;
      clearTimeout(timer);
      sock.destroy();
      for (const w of waiting.splice(0)) w.reject(error);
      reject(error);
    };
    sock.setEncoding('utf8');
    sock.on('error', fail);
    sock.on('close', () => fail(Object.assign(Error('the hub closed the connection'), { code: 'EOF' })));
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const o = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        const w = waiting.shift();
        if (w) w.resolve(o);
        else got.push(o);
      }
    });
    const next = () => new Promise((res, rej) => {
      if (got.length) return res(got.shift());
      if (failed) return rej(failed);
      waiting.push({ resolve: res, reject: rej });
    });
    next().then((hello) => {
      clearTimeout(timer);
      resolve({ hello, next, send: (o) => sock.write(`${JSON.stringify({ v: 1, ...o })}\n`), close: () => sock.destroy() });
    }, () => undefined);
  });
}
/** The hub's hello at the sandbox's socket; undefined when none answers. */
export const hello = (box, ms = 5000) => connect(box.socket, ms).then((c) => { c.close(); return c.hello; }, () => undefined);
/**
 * One control call as the CLI makes it, with the sandbox's token; the connection is closed once the reply is read. A
 * refusal the hub marks retryable (a hub that answers before its record is open refuses hub.health so) is asked again
 * on a new connection until `ms` runs out.
 */
export async function control(box, method, ms = 60_000) {
  for (const deadline = Date.now() + ms; ;) {
    try {
      return await call(box, method, Math.max(1000, deadline - Date.now()));
    } catch (error) {
      if (!error.retryable || Date.now() > deadline) throw error;
      await wait(250);
    }
  }
}
async function call(box, method, ms) {
  const c = await connect(box.socket, ms);
  try {
    c.send({ hello: 'cli', token: readFileSync(box.token, 'utf8').trim() });
    const ack = await Promise.race([c.next(), wait(ms).then(() => ({ error: `no answer to the CLI's hello within ${ms} ms` }))]);
    if (ack.error) throw Error(`the hub refused the CLI: ${JSON.stringify(ack.error)}`);
    c.send({ id: method, method, params: {} });
    const reply = await Promise.race([c.next(), wait(ms).then(() => ({ error: `no answer to ${method} within ${ms} ms` }))]);
    if (reply.error) throw Object.assign(Error(`${method}: ${JSON.stringify(reply.error)}`), { retryable: reply.error.retryable === true });
    return reply.result;
  } finally {
    c.close();
  }
}
/** Waits until the socket is quiet (nothing listens there: ENOENT or ECONNREFUSED); false if it still answers after `ms`. */
export async function quiet(box, ms) {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await wait(20)) {
    const code = await new Promise((done) => {
      const sock = net.connect(box.socket);
      sock.once('connect', () => { sock.destroy(); done('connected'); });
      sock.once('error', (error) => done(error.code));
    });
    if (code === 'ENOENT' || code === 'ECONNREFUSED') return true;
  }
  return false;
}

/** How long a `deep` command takes to start and end here with no hub: `deep hub status`, which exits 3 at once. */
export async function probe(box) {
  const run = await deep(box, ['hub', 'status'], 120_000);
  return run.ms;
}
