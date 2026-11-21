// Helpers for #2973's acceptance tests (README): a sandboxed HOME, TMPDIR and XDG_* folders; the stand-ins for what the
// repo doesn't own (the login service behind the DEEP_HUB_LAUNCHER seam, launchctl and systemctl themselves, the OS
// confirmation behind DEEP_HUB_TEST_CONFIRM); the hub's socket, reached by a process holding the control token; the
// restarts and crashes; the files the hub keeps under its root; and, for the promotions, the watched repository main
// watch (#1333) ticks on and the builds the tests plant. Nothing here imports the code under test: every surface is
// reached by running it, as `deep`, `scripts/main-watch.mjs` and the socket (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawCall } from './fixtures/client.mjs';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(CHECKOUT, 'packages', 'cli', 'dist', 'main.js');
export const DEEP_HOOK = join(CHECKOUT, 'target', 'debug', 'deep-hook');
export const NODE = process.execPath;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const CLIENT = join(FIXTURES, 'client.mjs');
export const LONG = { timeout: 1_800_000 };
/** The issue's budget: at most 6 restarts in any 60 minutes, by the hub's clock. */
export const BUDGET = 6;
export const WINDOW_MS = 60 * 60_000;
/** How long a hub that refused a restart must keep running with the same start ID (AC1, and AC5 by the same reading). */
export const STAYS_MS = 20_000;
/** How long a restart may take to bring a hub back: its 15 s minimum up, the stand-in's throttle and a slow start. */
export const BACK_MS = 90_000;

export { assert };
export const wait = (ms) => new Promise((done) => setTimeout(done, ms));
export const sha7 = (sha) => String(sha).slice(0, 7);
const script = (path, content) => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};
export const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }) : []);
const ok = (path) => { try { return realpathSync(path); } catch { return undefined; } };

/** What this suite needs built in this checkout before it runs (README: How to run). */
export function built({ hook = false } = {}) {
  const missing = [CLI, ...(hook ? [DEEP_HOOK] : [])].filter((path) => !existsSync(path));
  assert.deepEqual(missing, [], `BLOCKED: build first (npm ci && npm run build --workspaces && cargo build --locked -p deep-hook); missing: ${missing.join(', ')}`);
}

/**
 * A sandbox removed after the test: HOME, TMPDIR and XDG_* inside it, git's identity, the stand-ins first on PATH
 * (the login service's launcher; launchctl and systemctl, which record any call and exit 1), the OS confirmation's
 * stub (`confirm`, cancelled until a test says otherwise), and every process a test starts in a process group of its
 * own, stopped by its PID at the end, with the supervisor and every job the login service's stand-in started.
 * `register` is where the cleanup goes: a test's `t.after`, or a file's `after`.
 */
export async function sandbox(register, { hook = false } = {}) {
  built({ hook });
  // Short: a Unix socket path must fit in 104 bytes on macOS (the hub's is <home>/.deepbuild/hub.sock).
  const dir = realpathSync(mkdtempSync('/tmp/d2973-'));
  const home = join(dir, 'h'), temp = join(dir, 't'), bin = join(dir, 'bin'), state = join(dir, 'launchd'), builds = join(dir, 'builds');
  for (const folder of [home, temp, bin, state, builds]) mkdirSync(folder, { recursive: true });
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[core]\n\thooksPath = /dev/null\n');
  symlinkSync(NODE, join(bin, 'node'));
  script(join(bin, 'launcher'), `#!/bin/sh\nT2973_LAUNCHD=${JSON.stringify(state)} exec ${JSON.stringify(NODE)} ${JSON.stringify(join(FIXTURES, 'launcher.mjs'))} "$@"\n`);
  for (const name of ['launchctl', 'systemctl']) {
    script(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' ${name} "$*" >> ${JSON.stringify(join(dir, 'service-calls.log'))}\necho "stand-in ${name}: the tests' service manager is DEEP_HUB_LAUNCHER" >&2\nexit 1\n`);
  }
  // The OS confirmation's stub, as the base's Confirmer runs an executable DEEP_HUB_TEST_CONFIRM: once per ask, with the
  // prompt's words as its one argument; exit 0 is you confirming. Each ask is a line of asks.log; `confirm.mode` says
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
    DEEP_DOCTOR_CANVAS_FAULT: 'render_skipped',
    GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', TZ: 'UTC', LC_ALL: 'C',
  });
  const root = join(home, '.deepbuild');
  const box = { dir, home, temp, bin, state, builds, env, mode, asksLog, root, socket: join(root, 'hub.sock'), tokenFile: join(root, 'control.token'), children: [], restored: [] };
  register(async () => {
    for (const undo of box.restored) try { undo(); } catch { /* best effort */ }
    const groups = new Set();
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null && child.pid) groups.add(child.pid);
    try { groups.add(Number(readFileSync(join(state, 'supervisor.pid'), 'utf8'))); } catch {}
    for (const e of lines(join(state, 'launchd.jsonl'))) if (e.event === 'start' && e.pid) groups.add(e.pid);
    for (const pid of groups) try { process.kill(-pid, 'SIGTERM'); } catch {}
    for (const pid of groups) try { process.kill(pid, 'SIGTERM'); } catch {}
    await wait(2000);
    for (const pid of groups) try { process.kill(-pid, 'SIGKILL'); } catch {}
    for (const pid of groups) try { process.kill(pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Whether the OS confirms you at the next ask: 'confirmed' or 'cancelled'. */
export const confirming = (box, mode) => writeFileSync(box.mode, `${mode}\n`);
/** Every ask the hub made of the OS so far: the prompt's words, one per ask. */
export const asks = (box) => (existsSync(box.asksLog) ? readFileSync(box.asksLog, 'utf8').split('\n').filter(Boolean) : []);
/** What the login service's stand-in recorded: loads, starts and exits. */
export const launchd = (box) => lines(join(box.state, 'launchd.jsonl'));
/** Every call a test's processes made to launchctl or systemctl (each stand-in exits 1). */
export const serviceCalls = (box) => (existsSync(join(box.dir, 'service-calls.log')) ? readFileSync(join(box.dir, 'service-calls.log'), 'utf8').split('\n').filter(Boolean) : []);
/** Moves the hub's clock on by `ms` past the wall clock from the login service's next start of it on (the stand-in). */
export const clockAhead = (box, ms) => writeFileSync(join(box.state, 'clock.offset'), `${Math.round(ms)}\n`);

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
/** A run as an assertion message shows it, its token and home redacted. */
export const shown = (run, box) => redact(run ? `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${String(run.stdout).slice(-3000)}\nstderr:\n${String(run.stderr).slice(-3000)}` : '(not run)', box);
export function redact(text, box) {
  let out = String(text);
  if (box) {
    try { const token = readFileSync(box.tokenFile, 'utf8').trim(); if (token) out = out.split(token).join('<token>'); } catch {}
    out = out.split(box.dir).join('<sandbox>');
  }
  return out;
}
/** `deep <args>`, this checkout's CLI, in the sandbox. */
export const deep = (box, args, o = {}) => ended(launch(box, [NODE, CLI, ...args], o), o.timeoutMs ?? 300_000);

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

// ---- The hub's socket, as a process holding the control token reaches it (fixtures/client.mjs).
/** The hub's hello at the installed socket, or undefined when no hub answers within `ms`. */
export function hello(box, { ms = 3000 } = {}) {
  return new Promise((done) => {
    const sock = net.connect(box.socket);
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
/** Polls the hello until one answers with a start other than `start`, within `ms`; that hello and when, or undefined. */
export const backAfter = (box, start, ms) => until(async () => { const h = await hello(box, { ms: 2000 }); return h && h.start !== start ? { hello: h, t: Date.now() } : undefined; }, ms);
/** One call from the test's own process with the CLI's credential: the reply line, or 'closed'/'timeout'. */
export async function call(box, method, params = {}, { ms = 60_000 } = {}) {
  return (await rawCall({ socket: box.socket, tokenFile: box.tokenFile, method, params, ms })).reply;
}
/** One call from a process of its own that holds the control token (fixtures/client.mjs), a command's child. */
export async function holderCall(box, method, params = {}) {
  const run = await ended(launch(box, [NODE, CLIENT, box.socket, box.tokenFile, method, JSON.stringify(params)]), 120_000);
  try { return JSON.parse(run.stdout.trim().split('\n').at(-1)).reply; } catch { return `no reply: ${shown(run, box)}`; }
}
/** The hub's PID, by `hub.health`; undefined when it doesn't answer. */
export async function hubPid(box, o = {}) {
  const reply = await call(box, 'hub.health', {}, o);
  return typeof reply === 'object' && typeof reply.result?.pid === 'number' ? reply.result.pid : undefined;
}
/** Whether a process runs (signal 0 only asks). */
export const runs = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** The installed hub that answers now: its hello and PID; BLOCKED when none does within `ms`. */
export async function upNow(box, why, ms = 60_000) {
  const h = await until(() => hello(box, { ms: 2000 }), ms);
  assert.ok(h, `BLOCKED: ${why}: no installed hub answers its hello`);
  const pid = await hubPid(box, { ms: 120_000 });
  assert.ok(pid, `BLOCKED: ${why}: the installed hub never answered hub.health`);
  return { hello: h, pid };
}

/** The installed hub, started as `deep hub start` starts it: through the login service. Its hello and PID. */
export async function startInstalled(box) {
  const run = await deep(box, ['hub', 'start']);
  assert.equal(run.status, 0, `BLOCKED: deep hub start didn't start the installed hub in the sandbox: ${shown(run, box)}`);
  return upNow(box, 'after deep hub start');
}

/** A reply that is a refusal: an `error` and no `result`. */
export const refusedReply = (reply) => typeof reply === 'object' && reply !== null && !!reply.error && !('result' in reply);
/** A reply's text, as the assertions read it. */
export const text = (reply, box) => redact(typeof reply === 'string' ? reply : JSON.stringify(reply), box);

/**
 * One `hub.restart` by a process holding the control token (fixtures/client.mjs), sent to the hub that answers now,
 * and what followed within BACK_MS: `{ reply, asked, before, pid, back, exit }`, `back` the first hello with a new start
 * ID, `exit` the old hub's exit as the login service's stand-in logged it. Nothing is asserted here.
 */
export async function restart(box) {
  const { hello: before, pid } = await upNow(box, 'before a restart');
  const asked = Date.now();
  const reply = await holderCall(box, 'hub.restart');
  if (refusedReply(reply)) return { reply, asked, before, pid };
  const back = await backAfter(box, before.start, BACK_MS);
  const exit = launchd(box).find((e) => e.event === 'exit' && e.pid === pid);
  return { reply, asked, before, pid, back, exit };
}
/** Whether a restart went through: served, the hub back with a new start ID, its old process gone. */
export const restarted = (r) => !!r && !refusedReply(r.reply) && typeof r.reply === 'object' && !!r.reply.result && !!r.back && !runs(r.pid);
/** Spends `n` restarts, each sent once the hub is back, asserting each went through (a BLOCKED setup otherwise). */
export async function spend(box, n, why) {
  const done = [];
  for (let k = 1; k <= n; k++) {
    const r = await restart(box);
    assert.ok(restarted(r), `BLOCKED: ${why}: restart ${k} of ${n} didn't go through: it got ${text(r.reply, box)}${r.back ? '' : ', and no hub came back with a new start ID'}`);
    done.push(r);
  }
  return done;
}

/** A crash: the installed hub's process (the PID hub.health gave) killed by SIGKILL, and the hub the login service brings back. */
export async function crash(box) {
  const { hello: before, pid } = await upNow(box, 'before a crash');
  process.kill(pid, 'SIGKILL');
  const back = await backAfter(box, before.start, BACK_MS);
  const exit = launchd(box).find((e) => e.event === 'exit' && e.pid === pid);
  assert.ok(back, `BLOCKED: the login service didn't bring the hub back within ${BACK_MS / 1000} s of a crash (SIGKILL of PID ${pid}); its exit: ${JSON.stringify(exit)}`);
  return { pid, before, back, exit };
}

/**
 * Whether the hub that answered stays up for `ms`: the same start ID at the end, its process still running, and the
 * login service having started no job meanwhile. Why not, or undefined.
 */
export async function staysUp(box, h, pid, ms = STAYS_MS) {
  const since = Date.now();
  await wait(ms);
  const now = await hello(box, { ms: 10_000 });
  const started = launchd(box).filter((e) => e.event === 'start' && e.t >= since);
  if (now?.start !== h.start) return `${ms / 1000} s later ${now ? `the hub says hello with a new start ID (${now.start}, was ${h.start})` : 'no hub answers'}; the login service started ${started.length} job(s) meanwhile`;
  if (!runs(pid)) return `${ms / 1000} s later its process (PID ${pid}) is gone`;
  if (started.length) return `the login service started ${started.length} job(s) meanwhile`;
  return undefined;
}

/** Whether a refusal names the budget (6 restarts in 60 minutes): why not, or undefined. */
export function namesBudget(words) {
  const missing = [];
  if (!/restart/i.test(words)) missing.push('restarts');
  if (!/(^|[^0-9])6([^0-9]|$)/.test(words)) missing.push('6');
  if (!/60\s*-?\s*min|\bhour\b/i.test(words)) missing.push('60 minutes');
  return missing.length ? `it doesn't name ${missing.join(', ')}` : undefined;
}
/**
 * The times a text names (README: Readings): ISO 8601 or RFC 2822 dates, epoch ms or s, and clock times HH:MM(:SS),
 * those on the day of `near` and the days around it, in UTC and in this machine's zone. Each as [from, to] in ms, a
 * clock time without seconds standing for its whole minute.
 */
export function timesIn(words, near) {
  const out = [];
  for (const m of words.matchAll(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g)) {
    const ms = Date.parse(m[0].replace(' ', 'T'));
    if (Number.isFinite(ms)) out.push([ms, ms + (/:\d{2}:\d{2}/.test(m[0]) ? 1000 : 60_000)]);
  }
  for (const m of words.matchAll(/\b\d{13}\b/g)) out.push([Number(m[0]), Number(m[0])]);
  for (const m of words.matchAll(/\b\d{10}\b/g)) out.push([Number(m[0]) * 1000, Number(m[0]) * 1000 + 1000]);
  for (const m of words.matchAll(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|AM|PM)?/g)) {
    let h = Number(m[1]);
    if (m[4] && /pm/i.test(m[4]) && h < 12) h += 12;
    if (m[4] && /am/i.test(m[4]) && h === 12) h = 0;
    const min = Number(m[2]), sec = m[3] === undefined ? undefined : Number(m[3]);
    for (const day of [-1, 0, 1]) {
      const d = new Date(near + day * 86_400_000);
      const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, min, sec ?? 0);
      const local = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, min, sec ?? 0).getTime();
      for (const at of [utc, local]) out.push([at, at + (sec === undefined ? 60_000 : 1000)]);
    }
  }
  return out;
}
/** Whether `words` names a time in [from, to] ms (a time named to the minute counts if its minute overlaps). */
export const namesTimeIn = (words, from, to) => timesIn(words, from).some(([a, b]) => a <= to && b >= from);
export const iso = (ms) => new Date(ms).toISOString();

// ---- The files the hub keeps under its root (README: Readings, the budget file).
/**
 * The base's own files under the hub's root, by path from it: the record, its lock, the token, the state and the
 * other paths `rootOf` names, and the folders the base keeps (README lists them). Any other regular file is a file the
 * change added.
 */
const BASE_FILES = new Set(['ledger.db', 'ledger.db-wal', 'ledger.db-shm', 'ledger.db-journal', 'hub-lock.sqlite', 'hub-lock.sqlite-journal', 'hub-lock.sqlite-wal', 'hub-lock.sqlite-shm',
  'control.token', 'hub.state', 'hub.sock', 'hub.key', 'hub.key.cert', 'transcripts.json', 'runs.json', 'devices.json', 'confirm.key', 'restore.pending', 'gates.json', 'config.json',
  'rules.json', 'rules-held.json', 'rules-page.json', 'github.json', 'people.json', 'pack.json', 'claude-hooks.json', 'codex-hooks.json', 'codex-trust.json',
  'setup.json', 'setup-finished.json', 'setup-stopped.json', 'slack.json', 'moved.json', 'servers.json']);
const BASE_FOLDERS = ['objects', 'logs', 'extensions', 'compose', 'versions', 'evidence', 'wiki', 'spool'];
/** Every regular file under the root the base doesn't keep: its path from the root and its last change, in ms. */
export function addedFiles(box) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const path = join(dir, e.name), rel = relative(box.root, path);
      if (e.isDirectory()) { if (!BASE_FOLDERS.includes(rel)) walk(path); continue; }
      if (!e.isFile() || BASE_FILES.has(rel) || /\.tmp$|\.\d+$/.test(rel)) continue;
      try { out.push({ rel, path, mtime: statSync(path).mtimeMs }); } catch { /* gone meanwhile */ }
    }
  };
  walk(box.root);
  return out;
}

// ---- The watched repository (#1333) for the promotions: `origin.git`, a bare repository standing for GitHub's;
// `work`, the clone the tests land in; and `mac`, the clone main watch ticks in and `deep hub promote` runs in. Its
// first commit holds this checkout's scripts/ (main watch's own job among them) with the fixture's lanes, one tested
// function and its test.
const SUM_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../lib/sum.mjs';\ntest('adds two numbers', () => assert.equal(sum(2, 3), 5));\n";
const LANES = `// The fixture's lanes (tests/acceptance/2973/README.md, The promotions).
export * from './lanes-real.mjs';
export const checks = [
  { name: 'unit', commands: [[process.execPath, '--test', 'tests/sum.test.mjs']], fix: 'Repair the behavior named by the failing test.' },
  { name: 'lint', commands: [[process.execPath, '-e', '']], fix: 'Nothing to lint in the fixture.' },
];
`;
/** main watch's set number of landings (#1333): a tick runs the lanes once 5 landed since its last run. */
export const LANDINGS = 5;
const gitIn = (box, cwd) => (...args) => execFileSync('git', args, { cwd, env: box.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function watched(box) {
  const origin = join(box.dir, 'origin.git'), work = join(box.dir, 'work'), mac = join(box.dir, 'mac');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: box.env });
  mkdirSync(work);
  cpSync(join(CHECKOUT, 'scripts'), join(work, 'scripts'), { recursive: true });
  renameSync(join(work, 'scripts', 'lanes.mjs'), join(work, 'scripts', 'lanes-real.mjs'));
  writeFileSync(join(work, 'scripts', 'lanes.mjs'), LANES);
  writeFileSync(join(work, 'scripts', 'known-failures.json'), `${JSON.stringify({ failures: {}, lint: {}, timing: [], skips: [] }, null, 2)}\n`);
  mkdirSync(join(work, 'lib'));
  mkdirSync(join(work, 'tests'));
  writeFileSync(join(work, 'lib', 'sum.mjs'), 'export const sum = (a, b) => a + b;\n');
  writeFileSync(join(work, 'tests', 'sum.test.mjs'), SUM_TEST);
  writeFileSync(join(work, 'README.md'), "The repository #2973's promotion tests watch and build from.\n");
  const git = gitIn(box, work);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'c1: the watched repository');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  gitIn(box, box.dir)('clone', '-q', origin, mac);
  // The lanes' runner loads scripts/proof-binaries.mjs, which imports typescript: the fixture has no package.json, so
  // Node finds it the way it finds any bare import, in a node_modules of a folder above main watch's tree.
  mkdirSync(join(box.dir, 'node_modules'));
  symlinkSync(join(CHECKOUT, 'node_modules', 'typescript'), join(box.dir, 'node_modules', 'typescript'));
  return { origin, work, mac, git, c1: git('rev-parse', 'HEAD'), landings: [] };
}
/** A landing on origin's main: a commit adding `landings/<k>`, naming made-up issue #997<k>. */
export function land(box, fx) {
  const k = fx.landings.length + 1;
  mkdirSync(join(fx.work, 'landings'), { recursive: true });
  writeFileSync(join(fx.work, 'landings', String(k)), `${k}\n`);
  fx.git('add', '-A');
  fx.git('commit', '-qm', `Landing ${k} (Part of #${9970 + k})`);
  fx.git('push', '-q', 'origin', 'main');
  const sha = fx.git('rev-parse', 'HEAD');
  fx.landings.push(sha);
  return sha;
}
/** One scheduled run of main watch, `node scripts/main-watch.mjs tick`, in the clone it watches. */
export const tick = (box, fx) => ended(launch(box, [NODE, 'scripts/main-watch.mjs', 'tick'], { cwd: fx.mac }), 900_000);
/** main watch's `status` there: its exit and its output. */
export const watchStatus = (box, fx) => ended(launch(box, [NODE, 'scripts/main-watch.mjs', 'status'], { cwd: fx.mac }), 120_000);
/** main watch's run on the watched clone's head, which must pass: the commit a build of it can be promoted from. */
export async function passed(box, fx, commit) {
  const run = await tick(box, fx);
  const status = await watchStatus(box, fx);
  assert.ok(new RegExp(`^last clean run: ${commit}$`, 'm').test(status.stdout), `BLOCKED: main watch didn't pass ${sha7(commit)} in the fixture: tick ${shown(run, box)}\nstatus ${shown(status, box)}`);
}

/** The planted wrong program a build that fails its health check runs (#1334's plant): it starts, answers and judges claims wrong. */
export const MISJUDGES = 'judges-claims-wrongly';
/**
 * A build (README: The promotions): a folder holding build.json naming its commit, bin/deep and bin/deep-hook. Its
 * bin/deep notes each run in <sandbox>/starts.jsonl (the build, its PID, the time in ms, its arguments), then runs this
 * checkout's CLI: as built for a `good` build; with DEEP_HUB_PLANT=judges-claims-wrongly for a `misjudge` one, which
 * fails the promotion's health check. Its bin/deep-hook is a copy of this checkout's target/debug/deep-hook.
 */
export function makeBuild(box, name, commit, kind = 'good') {
  const folder = join(box.builds, name);
  mkdirSync(join(folder, 'bin'), { recursive: true });
  writeFileSync(join(folder, 'build.json'), `${JSON.stringify({ commit, built_by: 'tests/acceptance/2973', kind }, null, 2)}\n`);
  const note = `/usr/bin/perl -MTime::HiRes=time -e 'open(my $f, ">>", $ARGV[0]) or exit 0; my $a = $ARGV[3]; $a =~ s/["\\\\]//g; printf $f "{\\"build\\":\\"%s\\",\\"pid\\":%d,\\"t\\":%.0f,\\"args\\":\\"%s\\"}\\n", $ARGV[1], $ARGV[2], time*1000, $a' ${JSON.stringify(join(box.dir, 'starts.jsonl'))} ${JSON.stringify(name)} "$$" "$*"`;
  const plant = kind === 'misjudge' ? `DEEP_HUB_PLANT=${MISJUDGES}\nexport DEEP_HUB_PLANT\n` : '';
  script(join(folder, 'bin', 'deep'), `#!/bin/sh\n${note}\n${plant}exec ${JSON.stringify(NODE)} ${JSON.stringify(CLI)} "$@"\n`);
  copyFileSync(DEEP_HOOK, join(folder, 'bin', 'deep-hook'));
  chmodSync(join(folder, 'bin', 'deep-hook'), 0o755);
  return { name, folder, commit, kind };
}
/** Runs of the installed hub, `bin/deep hub run` as the login service runs it, by build `name`, after `since` ms. */
export const hubStarts = (box, name, since = 0) => lines(join(box.dir, 'starts.jsonl')).filter((s) => s.build === name && s.args === 'hub run' && s.t >= since);
/** `deep hub promote <folder>`, run in the clone main watch watches. */
export const promote = (box, fx, build) => ended(launch(box, [NODE, CLI, 'hub', 'promote', build.folder], { cwd: fx.mac }), 900_000);
/** The build `~/.deepbuild/versions/current` names: its folder and the commit its build.json names; undefined with none. */
export function current(box) {
  const link = join(box.root, 'versions', 'current');
  let target;
  try { target = resolve(dirname(link), readlinkSync(link)); } catch { return undefined; }
  let commit;
  try { commit = JSON.parse(readFileSync(join(target, 'build.json'), 'utf8')).commit; } catch { /* none */ }
  return { folder: target, commit, inVersions: dirname(ok(target) ?? target) === (ok(join(box.root, 'versions')) ?? join(box.root, 'versions')) };
}
/**
 * A promotion's scene up to the build to promote: the watched repository, a first promotion of c1's good build with
 * no hub running (so `current` and a last good build exist), `spent` restarts spent on it by the token holder, then
 * five landings and main watch passing their head, c2.
 */
export async function promotionScene(box, spent) {
  const fx = watched(box);
  await passed(box, fx, fx.c1);
  const c1Build = makeBuild(box, 'good-c1', fx.c1);
  const first = await promote(box, fx, c1Build);
  assert.equal(first.status, 0, `BLOCKED: the first promotion, of a build of ${sha7(fx.c1)} with no hub running yet, failed: ${shown(first, box)}`);
  await upNow(box, 'after the first promotion');
  const restarts = await spend(box, spent, `spending ${spent} restarts before the promotion`);
  for (let k = 0; k < LANDINGS; k++) land(box, fx);
  const c2 = fx.landings.at(-1);
  await passed(box, fx, c2);
  return { fx, c1Build, c2, restarts };
}
