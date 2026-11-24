// Helpers for #2570's acceptance tests (README): a sandbox with a HOME of its own, the stand-ins (the service
// manager behind DEEP_HUB_LAUNCHER, launchctl and systemctl, the hold on a real hub's exit), the `deep hub` commands
// run as a person runs them, and the hub's socket. Nothing here imports the code under test.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export { assert };
export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(CHECKOUT, 'packages', 'cli', 'dist', 'main.js');
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
/** The criteria, tagged as scripts/proof-change.mjs derives them from the issue's text. */
export const AC1 = '#2570.0ed54a91';
export const AC2 = '#2570.03ae960a';
/** A test's own limit, far past anything it waits for: each wait below has its own bound and its own message. */
export const LONG = { timeout: 300_000 };
/** How long `deep hub start` waits for a hub today (the base's WAIT_MS), which criterion 2 keeps. */
export const WAIT_MS = 15_000;
/** How long the old hub is kept exiting when the start under test asks nothing of anyone meanwhile (README). */
export const HOLD_MS = 5_000;

export const wait = (ms) => new Promise((done) => setTimeout(done, ms));
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
export const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }) : []);
/** Polls `read` until it returns something, or returns undefined after `ms`. */
export async function until(read, ms, step = 20) {
  for (const deadline = Date.now() + ms; ;) {
    const got = await read();
    if (got) return got;
    if (Date.now() >= deadline) return undefined;
    await wait(step);
  }
}
const script = (path, content) => { writeFileSync(path, content); chmodSync(path, 0o755); };

/**
 * A sandbox under /tmp/d2570-*, removed after the test with every process the test started, each stopped by its PID.
 * `kind` is how its hub is started: 'dev' (deep hub start --root <folder>) or 'installed' (deep hub start, through
 * the service manager's stand-in).
 */
export function sandbox(t, kind) {
  // A hub's core stops at its start when this checkout has no deep-hook built, though its socket answered first.
  const hook = ['release', 'debug'].map((p) => join(CHECKOUT, 'target', p, 'deep-hook'));
  assert.ok(existsSync(CLI) && hook.some((p) => existsSync(p)), `BLOCKED: build first (npm ci && npm run build --workspaces --if-present && cargo build --locked -p deep-hook); needs ${CLI} and ${hook[1]}`);
  // Short: a Unix socket's path must fit in 104 bytes on macOS, 108 on Linux.
  const dir = realpathSync(mkdtempSync('/tmp/d2570-'));
  const home = join(dir, 'h'), temp = join(dir, 't'), bin = join(dir, 'bin'), launchd = join(dir, 'launchd'), hold = join(dir, 'hold');
  for (const folder of [home, temp, bin, launchd, hold]) mkdirSync(folder, { recursive: true });
  symlinkSync(NODE, join(bin, 'node'));
  script(join(bin, 'launcher'), `#!/bin/sh\nT2570_LAUNCHD=${JSON.stringify(launchd)} exec ${JSON.stringify(NODE)} ${JSON.stringify(join(FIXTURES, 'launcher.mjs'))} "$@"\n`);
  // The real service managers, first on PATH: each records the call and exits 1. No test may reach them.
  for (const name of ['launchctl', 'systemctl']) {
    script(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' ${name} "$*" >> ${JSON.stringify(join(dir, 'service-calls.log'))}\necho "stand-in ${name}: the tests' service manager is DEEP_HUB_LAUNCHER" >&2\nexit 1\n`);
  }
  execFileSync('mkfifo', [join(hold, 'release')]);
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|CODEX_|GH_|GITHUB_|ANTHROPIC|OPENAI|XDG_|AWS_|GIT_|NODE_|T2570_)/.test(name)) continue;
    env[name] = value;
  }
  Object.assign(env, {
    HOME: home, TMPDIR: temp, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local', 'share'), XDG_STATE_HOME: join(home, '.local', 'state'),
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, TZ: 'UTC', LC_ALL: 'C',
    DEEP_HUB_LAUNCHER: join(bin, 'launcher'),
    // The hold on a hub's exit (fixtures/hold-exit.mjs): loaded everywhere, acting only in `deep hub run`.
    NODE_OPTIONS: `--import=${join(FIXTURES, 'hold-exit.mjs')}`, T2570_HOLD: hold,
  });
  const root = kind === 'dev' ? join(dir, 'dev') : join(home, '.deepbuild');
  const box = { dir, home, bin, launchd, hold, env, kind, root, socket: join(root, 'hub.sock'), token: join(root, 'control.token'), log: join(root, 'logs', 'hub.log'), flags: kind === 'dev' ? ['--root', root] : [], children: [] };
  t.after(() => cleanup(box));
  return box;
}

/** Every process the sandbox's commands started and that hasn't ended by its own account: stopped by its PID. */
async function cleanup(box) {
  release(box, 2_000);
  const pids = new Set();
  for (const child of box.children) if (child.exitCode === null && child.signalCode === null && child.pid) pids.add(child.pid);
  try { pids.add(Number(readFileSync(join(box.launchd, 'supervisor.pid'), 'utf8'))); } catch { /* no supervisor */ }
  for (const file of [join(box.launchd, 'launchd.jsonl'), join(box.hold, 'hubs.jsonl')]) {
    const ended = new Set(lines(file).filter((e) => e.event === 'exit').map((e) => e.pid));
    for (const e of lines(file)) if ((e.event === 'start' || e.event === 'run') && !ended.has(e.pid)) pids.add(e.pid);
  }
  const mine = [...pids].filter((pid) => Number.isSafeInteger(pid) && pid > 1 && alive(pid));
  // The supervisor first, so it restarts nothing; each is the leader of a group of its own.
  const signal = (name) => { for (const pid of mine) { try { process.kill(-pid, name); } catch { try { process.kill(pid, name); } catch { /* gone */ } } } };
  signal('SIGTERM');
  await until(() => mine.every((pid) => !alive(pid)), 3_000, 50);
  signal('SIGKILL');
  await until(() => mine.every((pid) => !alive(pid)), 3_000, 50);
  rmSync(box.dir, { recursive: true, force: true });
}

/** Starts `deep <args>` in the sandbox, in a process group of its own; `done` resolves with how it ended. */
export function deepStart(box, args) {
  const child = spawn(NODE, [CLI, ...args], { cwd: box.dir, env: box.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const started = Date.now();
  child.done = new Promise((done) => {
    child.on('error', (error) => { stderr += String(error); });
    child.on('close', (status, signal) => done({ status, signal, stdout, stderr, ms: Date.now() - started, stopped: child.stoppedByTest === true }));
  });
  return child;
}
/** A started command's end; past `ms` the test stops it by its PID, and `stopped` says so. */
export function ended(child, ms) {
  const stop = setTimeout(() => { child.stoppedByTest = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, ms);
  return child.done.finally(() => clearTimeout(stop));
}
/** `deep <args>` run to its end in the sandbox. */
export const deep = (box, args, ms = 120_000) => ended(deepStart(box, args), ms);
export const shown = (run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}${run.stopped ? ', stopped by the test' : ''} after ${run.ms} ms\nstdout: ${run.stdout.slice(-2000)}\nstderr: ${run.stderr.slice(-2000)}`;

/** One connection to a hub's socket, its lines read one at a time; rejects when nothing answers within `ms`. */
function connect(path, ms = 2_000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(path);
    const got = [], waiting = [];
    let buffer = '', failed;
    const fail = (error) => { failed ??= error; sock.destroy(); for (const w of waiting.splice(0)) w.reject(failed); };
    const timer = setTimeout(() => fail(Error(`no answer within ${ms} ms`)), ms);
    sock.setEncoding('utf8');
    sock.on('error', fail);
    sock.on('close', () => fail(Error('the connection closed')));
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const o = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        const w = waiting.shift();
        if (w) w.resolve(o); else got.push(o);
      }
    });
    const next = () => new Promise((res, rej) => { if (got.length) res(got.shift()); else if (failed) rej(failed); else waiting.push({ resolve: res, reject: rej }); });
    next().then((hello) => { clearTimeout(timer); resolve({ hello, next, send: (o) => sock.write(`${JSON.stringify({ v: hello.v, ...o })}\n`), close: () => sock.destroy() }); }, reject);
  });
}
/** The hello of the hub answering on the sandbox's socket, or undefined when none answers: "a hub answers". */
export const hello = (box) => connect(box.socket).then((c) => { c.close(); return c.hello.hello === 'deep-hub' ? c.hello : undefined; }, () => undefined);
/** The answering hub's process, read through `deep hub status`; undefined when no hub could be read. */
export function hubPid(box) {
  // Asked again for up to 30 s: a hub answers on its socket before its core can serve hub.health, and the base's
  // `deep hub status` exits 3 in between ("hub.health was refused ... retryable").
  return until(async () => {
    const run = await deep(box, ['hub', 'status', ...box.flags]);
    try { return run.status === 0 ? JSON.parse(run.stdout).pid : undefined; } catch { return undefined; }
  }, 30_000, 100);
}
/**
 * Tells the sandbox's hub to stop. A dev hub through `deep hub stop --root`; the installed one with the `hub.stop`
 * call that command makes, as the CLI, since `deep hub stop` first asks the OS to confirm a person.
 */
export async function stopHub(box) {
  if (box.kind === 'dev') {
    const run = await deep(box, ['hub', 'stop', ...box.flags]);
    assert.equal(run.status, 0, `the scene's own step, deep hub stop --root, failed: ${shown(run)}`);
    return;
  }
  const c = await connect(box.socket);
  try {
    c.send({ hello: 'cli', token: readFileSync(box.token, 'utf8').trim() });
    const said = await c.next();
    assert.ok(!said.error, `the scene's own step: the hub refused the CLI's credential: ${JSON.stringify(said.error)}`);
    c.send({ id: 'stop', method: 'hub.stop', params: {} });
    const reply = await c.next();
    assert.ok(!reply.error, `the scene's own step: hub.stop was refused: ${JSON.stringify(reply.error)}`);
  } finally {
    c.close();
  }
}

// ---- The hold on the old hub's exit (fixtures/hold-exit.mjs) and the service manager's log.
/** The next hub of this sandbox that stops is held at its exit. */
export const arm = (box) => writeFileSync(join(box.hold, 'arm'), '');
/** The held hub, `{ pid, socket }`, once it holds; undefined before. */
export const holding = (box) => { try { return JSON.parse(readFileSync(join(box.hold, 'holding'), 'utf8')); } catch { return undefined; } };
/** Lets the held hub go on to its own exit. True once it took the word; false when no hub was holding within `ms`. */
export function release(box, ms = 10_000) {
  const held = holding(box);
  if (!held) return false;
  for (const deadline = Date.now() + ms; alive(held.pid) && !box.released;) {
    try {
      // Without blocking: a FIFO opens for writing only once its reader, the held hub, has it open.
      const fd = openSync(join(box.hold, 'release'), constants.O_WRONLY | constants.O_NONBLOCK);
      writeSync(fd, 'go\n');
      closeSync(fd);
      box.released = true;
    } catch (error) {
      if (error.code !== 'ENXIO' || Date.now() >= deadline) return false;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  return box.released === true;
}
/** What the hold's file says of every `deep hub run` the sandbox started: its pid, and its exit code if it ended by itself. */
export const hubRuns = (box) => lines(join(box.hold, 'hubs.jsonl'));
/** The service manager stand-in's log: every ask (with whether the job ran and what was done), start and exit. */
export const launchd = (box) => lines(join(box.launchd, 'launchd.jsonl'));
/** The calls that reached the real service managers' names; none may. */
export const serviceCalls = (box) => (existsSync(join(box.dir, 'service-calls.log')) ? readFileSync(join(box.dir, 'service-calls.log'), 'utf8').split('\n').filter(Boolean) : []);

/**
 * The scene of criterion 1: a hub of this sandbox, started as `kind` says and answering, is told to stop and is held
 * while its process is still exiting. Returns the old hub's pid. Every step is waited for by its event, and a step
 * that doesn't happen fails as the scene's own (never as the criterion).
 */
export async function exitingHub(box) {
  arm(box);
  const first = await deep(box, ['hub', 'start', ...box.flags]);
  assert.equal(first.status, 0, `the scene's own step: the first hub didn't start: ${shown(first)}`);
  const old = await hubPid(box);
  assert.ok(Number.isSafeInteger(old), "the scene's own step: deep hub status didn't name the first hub's pid");
  assert.ok(hubRuns(box).some((e) => e.event === 'run' && e.pid === old), `the scene's own step: the hold isn't loaded in the first hub (pid ${old})`);
  await stopHub(box);
  const held = await until(() => holding(box), 60_000);
  assert.ok(held, `the scene's own step: the stopped hub (pid ${old}) didn't reach its exit within 60 s`);
  assert.equal(held.pid, old, "the scene's own step: the hub held at its exit isn't the one that was stopped");
  assert.ok(alive(old), `the scene's own step: the stopped hub (pid ${old}) must still be running while held`);
  assert.equal(await hello(box), undefined, "the scene's own step: the stopped hub must no longer answer on its socket");
  return old;
}
