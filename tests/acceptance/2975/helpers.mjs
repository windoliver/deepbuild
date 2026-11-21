// Helpers for #2975's acceptance tests (README): a sandboxed HOME, TMPDIR and XDG_* folders; the stand-ins for what the
// repo doesn't own (the login service behind the DEEP_HUB_LAUNCHER seam, launchctl and systemctl themselves, the OS
// confirmation behind DEEP_HUB_TEST_CONFIRM); signals sent by PID; and the hub's socket (its hello, `hub.health`,
// `events.read`). Nothing here imports the code under test: every surface is reached by running it, as `deep`, as
// `deep hub run`, and over the socket.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(CHECKOUT, 'packages', 'cli', 'dist', 'main.js');
export const NODE = process.execPath;
/** The hub's core refuses to start without it ("no deep-hook is built under <checkout>/target"). */
export const DEEP_HOOK = join(CHECKOUT, 'target', 'debug', 'deep-hook');
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const LONG = { timeout: 900_000 };
/** How long a hub may take to come back through the login service's stand-in (its 10 s throttle, then a start under load). */
export const BACK_MS = 90_000;
/** How long a stopped hub is watched for a start: three of launchd's 10 s throttles. */
export const WATCH_MS = 35_000;

export { assert };
export const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const script = (path, content) => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};
export const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }) : []);

/** What this suite needs built in this checkout before it runs (README: How to run). */
export function built() {
  const missing = [CLI, DEEP_HOOK].filter((path) => !existsSync(path));
  assert.deepEqual(missing, [], `BLOCKED: build first (npm ci && npm run build --workspaces && cargo build --locked -p deep-hook); missing: ${missing.join(', ')}`);
}

/**
 * A sandbox removed after the test: HOME, TMPDIR and XDG_* inside it, the stand-ins first on PATH (the login service's
 * launcher; launchctl and systemctl, which record any call and exit 1), the OS confirmation's stub (`confirm`, cancelled
 * until a test says otherwise), and every process a test starts in a process group of its own, stopped by its PID at
 * the end, with the supervisor and every job the login service's stand-in started.
 */
export async function sandbox(t) {
  built();
  // Short: a Unix socket path must fit in 104 bytes on macOS (the hub's is <home>/.deepbuild/hub.sock).
  const dir = realpathSync(mkdtempSync('/tmp/d2975-'));
  const home = join(dir, 'h'), temp = join(dir, 't'), bin = join(dir, 'bin'), state = join(dir, 'launchd');
  for (const folder of [home, temp, bin, state]) mkdirSync(folder, { recursive: true });
  symlinkSync(NODE, join(bin, 'node'));
  script(join(bin, 'launcher'), `#!/bin/sh\nT2975_LAUNCHD=${JSON.stringify(state)} exec ${JSON.stringify(NODE)} ${JSON.stringify(join(FIXTURES, 'launcher.mjs'))} "$@"\n`);
  for (const name of ['launchctl', 'systemctl']) {
    script(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' ${name} "$*" >> ${JSON.stringify(join(dir, 'service-calls.log'))}\necho "stand-in ${name}: the tests' service manager is DEEP_HUB_LAUNCHER" >&2\nexit 1\n`);
  }
  // The OS confirmation's stub, as the base's Confirmer runs an executable DEEP_HUB_TEST_CONFIRM: once per ask, with the
  // prompt's words as its argument; exit 0 is you confirming. Each ask is a line of asks.log; `confirm.mode` says
  // whether you confirm.
  const mode = join(dir, 'confirm.mode'), asksLog = join(dir, 'asks.log');
  writeFileSync(mode, 'cancelled\n');
  script(join(bin, 'confirm'), `#!/bin/sh\nprintf '%s\\n' "$1" >> ${JSON.stringify(asksLog)}\n[ "$(cat ${JSON.stringify(mode)})" = confirmed ]\n`);
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|CODEX_|GH_|GITHUB_|ANTHROPIC|OPENAI|XDG_|AWS_|GIT_|CARGO_TARGET)/.test(name)) continue;
    if (['NODE_OPTIONS', 'NODE_TEST_CONTEXT', 'NO_PROXY', 'no_proxy', 'AI_AGENT'].includes(name)) continue;
    env[name] = value;
  }
  Object.assign(env, {
    HOME: home, TMPDIR: temp,
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local', 'share'), XDG_STATE_HOME: join(home, '.local', 'state'),
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    DEEP_HUB_LAUNCHER: join(bin, 'launcher'),
    DEEP_HUB_TEST_CONFIRM: join(bin, 'confirm'),
    TZ: 'UTC', LC_ALL: 'C',
  });
  const root = join(home, '.deepbuild');
  const box = { dir, home, temp, bin, state, env, mode, asksLog, root, socket: join(root, 'hub.sock'), tokenFile: join(root, 'control.token'), children: [] };
  t.after(async () => {
    const groups = new Set();
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null && child.pid) groups.add(child.pid);
    try { groups.add(Number(readFileSync(join(state, 'supervisor.pid'), 'utf8'))); } catch {}
    for (const e of lines(join(state, 'launchd.jsonl'))) if (e.event === 'start' && e.pid) groups.add(e.pid);
    for (const pid of groups) try { process.kill(-pid, 'SIGKILL'); } catch {}
    for (const pid of groups) try { process.kill(pid, 'SIGKILL'); } catch {}
    await wait(500);
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Whether the OS confirms you at the next ask: 'confirmed' or 'cancelled'. */
export const confirming = (box, mode) => writeFileSync(box.mode, `${mode}\n`);
/** Every ask of the OS so far: the prompt's words, one per ask. */
export const asks = (box) => (existsSync(box.asksLog) ? readFileSync(box.asksLog, 'utf8').split('\n').filter(Boolean) : []);
/** What the login service's stand-in recorded: loads, starts and exits. */
export const launchd = (box) => lines(join(box.state, 'launchd.jsonl'));
/** The stand-in's record of the job with PID `pid` exiting, once it has: `{ t, code, signal }`. */
export const exitOf = (box, pid) => launchd(box).find((e) => e.event === 'exit' && e.pid === pid);
/** Every call a test's processes made to launchctl or systemctl (each stand-in exits 1). */
export const serviceCalls = (box) => (existsSync(join(box.dir, 'service-calls.log')) ? readFileSync(join(box.dir, 'service-calls.log'), 'utf8').split('\n').filter(Boolean) : []);

/** Starts `argv` in the sandbox in a process group of its own; `done` resolves with its status and output. */
export function launch(box, argv, { env = {}, cwd = box.dir } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.started = Date.now();
  child.done = new Promise((done) => {
    child.on('error', (error) => { stderr += String(error); });
    child.on('close', (status, signal) => done({ status, signal, stdout, stderr, started: child.started, ended: Date.now() }));
  });
  return child;
}
/** A child's end, or its group stopped by its PID after `ms`: a program that never ends fails at an assertion. */
export function ended(child, ms) {
  const stop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, ms);
  return child.done.finally(() => clearTimeout(stop));
}
/** A run as an assertion message shows it, its token and the sandbox's path redacted. */
export const shown = (run, box) => redact(run ? `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${String(run.stdout).slice(-2000)}\nstderr:\n${String(run.stderr).slice(-2000)}` : '(not run)', box);
export function redact(text, box) {
  let out = String(text);
  if (box) {
    try { const token = readFileSync(box.tokenFile, 'utf8').trim(); if (token) out = out.split(token).join('<token>'); } catch {}
    out = out.split(box.dir).join('<sandbox>');
  }
  return out;
}
/** The tail of the installed hub's log, redacted, for a BLOCKED message. */
export const hubLog = (box) => { try { return redact(readFileSync(join(box.root, 'logs', 'hub.log'), 'utf8').slice(-2000), box); } catch { return '(none)'; } };
/** `deep <args>`, this checkout's CLI, in the sandbox. */
export const deep = (box, args, o = {}) => ended(launch(box, [NODE, CLI, ...args], o), o.timeoutMs ?? 300_000);
/**
 * `kill -<signal> <pid>` as a process of its own in the sandbox (a command's child, holding no confirmation: the stub
 * stays cancelled). Its exit status.
 */
export async function killAs(box, signal, pid) {
  const run = await ended(launch(box, ['/bin/kill', `-${signal}`, String(pid)]), 60_000);
  return run.status;
}

/** Polls `probe` every `every` ms until it gives a value or `ms` pass; undefined then. */
export async function until(probe, ms, every = 250) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) return undefined;
    await wait(every);
  }
}
/** Whether a process runs (signal 0 only asks). */
export const runs = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---- The hub's socket.
/** The hub's hello at `socket` (the installed one by default), or undefined when no hub answers within `ms`. */
export function hello(box, { socket = box.socket, ms = 3000 } = {}) {
  return new Promise((done) => {
    const sock = net.connect(socket);
    let buffer = '';
    const finish = (value) => { clearTimeout(timer); sock.destroy(); done(value); };
    const timer = setTimeout(() => finish(undefined), ms);
    sock.setEncoding('utf8');
    sock.on('error', () => finish(undefined));
    sock.on('close', () => finish(undefined));
    sock.on('data', (chunk) => {
      buffer += chunk;
      const i = buffer.indexOf('\n');
      if (i < 0) return;
      try { finish(JSON.parse(buffer.slice(0, i))); } catch { finish(undefined); }
    });
  });
}
/** Whether the socket refuses a connection now (nothing listens: a stopping or stopped hub). */
export const refuses = (socket) => new Promise((done) => {
  const sock = net.connect(socket);
  sock.once('connect', () => { sock.destroy(); done(false); });
  sock.once('error', () => done(true));
});
/**
 * One call as the CLI says hello, with the token in `<socket's folder>/control.token`: the reply line (`{ id, result }`
 * or `{ id, error }`), or 'closed'/'timeout'.
 */
export function call(box, method, params = {}, { socket = box.socket, ms = 60_000 } = {}) {
  let token;
  try { token = readFileSync(join(socket, '..', 'control.token'), 'utf8').trim(); } catch { return Promise.resolve('closed'); }
  return new Promise((done) => {
    const got = [];
    let buffer = '', finished = false;
    const sock = net.connect(socket);
    const finish = (value) => { if (finished) return; finished = true; clearTimeout(timer); sock.destroy(); done(value); };
    const timer = setTimeout(() => finish('timeout'), ms);
    sock.setEncoding('utf8');
    sock.on('error', () => finish('closed'));
    sock.on('close', () => finish('closed'));
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line;
        try { line = JSON.parse(buffer.slice(0, i)); } catch { line = { unparsed: buffer.slice(0, i) }; }
        buffer = buffer.slice(i + 1);
        got.push(line);
        if (got.length === 1) sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
        else if (got.length === 2) {
          if (line.error) return finish('closed');
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (line.id === 1) return finish(line);
      }
    });
  });
}
/** The hub's PID, by `hub.health`; undefined when it doesn't answer. */
export async function hubPid(box, o = {}) {
  const reply = await call(box, 'hub.health', {}, o);
  return typeof reply === 'object' && typeof reply.result?.pid === 'number' ? reply.result.pid : undefined;
}
/** Every event of the hub's record, page by page through `events.read`; undefined when the hub doesn't answer. */
export async function events(box, o = {}) {
  const out = [];
  let after = 0;
  for (;;) {
    const reply = await call(box, 'events.read', { after, limit: 1000 }, o);
    if (typeof reply !== 'object' || !Array.isArray(reply.result?.events)) return undefined;
    const page = reply.result.events;
    if (!page.length) return out;
    out.push(...page);
    after = page.at(-1).log_pos;
  }
}
/** The stops the record holds, in order: each `hub.stopped` event's reason. */
export const stopsIn = (record) => record.filter((e) => e.kind === 'hub.stopped').map((e) => e.data?.reason);

/**
 * The installed hub, started as `deep hub start` starts it: through the login service. Its hello, its PID (by
 * `hub.health`) and the record's stops so far.
 */
export async function startInstalled(box) {
  const run = await deep(box, ['hub', 'start']);
  assert.equal(run.status, 0, `BLOCKED: deep hub start didn't start the installed hub in the sandbox: ${shown(run, box)}\nits hub.log:\n${hubLog(box)}`);
  const up = await hello(box, { ms: 30_000 });
  assert.ok(up, 'BLOCKED: the installed hub never answered its hello after deep hub start');
  const pid = await hubPid(box, { ms: 120_000 });
  assert.ok(pid, 'BLOCKED: the installed hub never answered hub.health after deep hub start');
  const record = await events(box, { ms: 120_000 });
  assert.ok(record, 'BLOCKED: the installed hub never answered events.read after deep hub start');
  return { hello: up, pid, stops: stopsIn(record) };
}

/**
 * After the hub with PID `pid` and start ID `start` stopped: the first hub to answer `hub.health` with a hello naming
 * another start ID within `ms`, its hello and PID, or undefined.
 */
export const backAfter = (box, start, ms = BACK_MS) => until(async () => {
  const h = await hello(box, { ms: 2000 });
  if (!h || h.start === start) return undefined;
  const pid = await hubPid(box, { ms: 30_000 });
  return pid ? { hello: h, pid, t: Date.now() } : undefined;
}, ms, 500);
