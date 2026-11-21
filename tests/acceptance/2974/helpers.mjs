// Helpers for #2974's acceptance tests (README): a sandboxed HOME, TMPDIR and XDG_* folders; the stand-ins for what the
// repo doesn't own (the login service behind the DEEP_HUB_LAUNCHER seam, launchctl and systemctl themselves, the OS
// confirmation behind DEEP_HUB_TEST_CONFIRM); the hub's socket reached by a process holding the control token; a
// session's turn played through the real deep-hook; and, for the promotions, the watched repository main watch (#1333)
// ticks on and the builds the tests plant. Nothing here imports the code under test: every surface is reached by
// running it, as `deep`, `deep-hook`, `scripts/main-watch.mjs` and the socket (README: The surface). Written for this
// suite, never imported from another.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawCall } from './fixtures/client.mjs';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(CHECKOUT, 'packages', 'cli', 'dist', 'main.js');
export const DEEP_HOOK = join(CHECKOUT, 'target', 'debug', 'deep-hook');
export const NODE = process.execPath;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const CLIENT = join(FIXTURES, 'client.mjs');
export const LONG = { timeout: 1_800_000 };
/** The issue's bounds: a one-shot drain is gone within 35 s; a drain not renewed for 30 s lapses; 1 s after promote's exit. */
export const ONE_SHOT_MS = 35_000;
export const LAPSE_MS = 30_000;
export const AFTER_EXIT_MS = 1000;

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
export function built() {
  const missing = [CLI, DEEP_HOOK].filter((path) => !existsSync(path));
  assert.deepEqual(missing, [], `BLOCKED: build first (npm ci && npm run build --workspaces && cargo build --locked -p deep-hook); missing: ${missing.join(', ')}`);
}

/**
 * A sandbox removed after the test: HOME, TMPDIR and XDG_* inside it, git's identity, the stand-ins first on PATH
 * (the login service's launcher; launchctl and systemctl, which record any call and exit 1), the OS confirmation's
 * stub (`confirm`, which notes each ask and cancels it), and every process a test starts in a process group of its
 * own, stopped by its PID at the end, with the supervisor and every job the login service's stand-in started.
 */
export async function sandbox(t) {
  built();
  // Short: a Unix socket path must fit in 104 bytes on macOS (the hub's is <home>/.deepbuild/hub.sock).
  const dir = realpathSync(mkdtempSync('/tmp/d2974-'));
  const home = join(dir, 'h'), temp = join(dir, 't'), bin = join(dir, 'bin'), state = join(dir, 'launchd'), builds = join(dir, 'builds');
  for (const folder of [home, temp, bin, state, builds]) mkdirSync(folder, { recursive: true });
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[core]\n\thooksPath = /dev/null\n');
  symlinkSync(NODE, join(bin, 'node'));
  script(join(bin, 'launcher'), `#!/bin/sh\nT2974_LAUNCHD=${JSON.stringify(state)} exec ${JSON.stringify(NODE)} ${JSON.stringify(join(FIXTURES, 'launcher.mjs'))} "$@"\n`);
  for (const name of ['launchctl', 'systemctl']) {
    script(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' ${name} "$*" >> ${JSON.stringify(join(dir, 'service-calls.log'))}\necho "stand-in ${name}: the tests' service manager is DEEP_HUB_LAUNCHER" >&2\nexit 1\n`);
  }
  // The OS confirmation's stub, as the base's Confirmer runs an executable DEEP_HUB_TEST_CONFIRM: once per ask, with the
  // prompt's words as its one argument; it notes each ask in asks.log and exits 1, you cancelling.
  const asksLog = join(dir, 'asks.log');
  script(join(bin, 'confirm'), `#!/bin/sh\nprintf '%s\\n' "$1" >> ${JSON.stringify(asksLog)}\nexit 1\n`);
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
  const box = { dir, home, temp, bin, state, builds, env, asksLog, root, socket: join(root, 'hub.sock'), tokenFile: join(root, 'control.token'), children: [], stopped: [] };
  t.after(async () => {
    for (const pid of box.stopped) try { process.kill(pid, 'SIGCONT'); } catch {}
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

/** Every ask the hub or a command made of the OS so far: the prompt's words, one per ask. */
export const asks = (box) => (existsSync(box.asksLog) ? readFileSync(box.asksLog, 'utf8').split('\n').filter(Boolean) : []);
/** What the login service's stand-in recorded: loads, starts and exits. */
export const launchd = (box) => lines(join(box.state, 'launchd.jsonl'));

/** Starts `argv` in the sandbox in a process group of its own; `done` resolves with its status and output. */
export function launch(box, argv, { env = {}, cwd = box.dir, input } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  box.children.push(child);
  if (input !== undefined) { child.stdin.on('error', () => undefined); child.stdin.end(input); }
  child.out = '';
  child.err = '';
  child.stdout.on('data', (chunk) => { child.out += chunk; });
  child.stderr.on('data', (chunk) => { child.err += chunk; });
  child.started = Date.now();
  child.done = new Promise((done) => {
    child.on('error', (error) => { child.err += String(error); });
    child.on('close', (status, signal) => done({ status, signal, stdout: child.out, stderr: child.err, started: child.started, ended: Date.now() }));
  });
  // The moment the process itself exited (before its pipes closed).
  child.exited = new Promise((done) => child.on('exit', () => done(Date.now())));
  return child;
}
/** A child's end, or its group stopped by its PID after `ms`: a program that never ends fails at an assertion. */
export function ended(child, ms) {
  const stop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, ms);
  return child.done.finally(() => clearTimeout(stop));
}
/** A run as an assertion message shows it, its token and the sandbox's path redacted. */
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
/** The hub's hello at its socket, or undefined when no hub answers within `ms`. */
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
/** One call from the test's own process with the CLI's credential: the reply line, or 'closed'/'timeout'. */
export async function call(box, method, params = {}, { peer = false, ms = 60_000 } = {}) {
  return (await rawCall({ socket: box.socket, tokenFile: box.tokenFile, method, params, peer, ms })).reply;
}
/** The hub's PID, by `hub.health`; undefined when it doesn't answer. */
export async function hubPid(box, o = {}) {
  const reply = await call(box, 'hub.health', {}, o);
  return typeof reply === 'object' && typeof reply.result?.pid === 'number' ? reply.result.pid : undefined;
}
/** Whether a process runs (signal 0 only asks). */
export const runs = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** The installed hub, started as `deep hub start` starts it: through the login service. Its hello and PID. */
export async function startInstalled(box) {
  const run = await deep(box, ['hub', 'start']);
  assert.equal(run.status, 0, `BLOCKED: deep hub start didn't start the installed hub in the sandbox: ${shown(run, box)}`);
  const up = await hello(box, { ms: 30_000 });
  assert.ok(up, 'BLOCKED: the installed hub never answered its hello after deep hub start');
  const pid = await hubPid(box, { ms: 120_000 });
  assert.ok(pid, 'BLOCKED: the installed hub never answered hub.health after deep hub start');
  return { hello: up, pid };
}

/**
 * A token holder run as a process of its own, a command's child (fixtures/client.mjs), naming its own process as
 * `peer` unless `peer: false`. `mark` is a word only its command line holds. With `every`/`span` it renews the call.
 */
export function holder(box, method, params = {}, { peer = true, mark = `d2974-holder-${randomBytes(4).toString('hex')}`, every, span } = {}) {
  const argv = [NODE, CLIENT, box.socket, box.tokenFile, method, JSON.stringify(params), ...(peer ? ['--peer'] : []), ...(every ? ['--every', String(every), '--for', String(span)] : []), '--mark', mark];
  const child = launch(box, argv);
  child.mark = mark;
  child.calls = () => child.out.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  return child;
}

// ---- Session starts. A start is `start.session` as `deep start` sends it (the CLI's credential, naming its process
// as `peer`). It names a repo, an issue, an agent and a prompt; no run is approved in a sandbox, so a start that is
// served is answered with a result (`refused` by its approval bound) and starts nothing. The drain's refusal is an error.
export const START = (box) => ({ repo: join(box.dir, 'shop'), issue: 9871, agent: 'claude-code', prompt: 'the drain fixture: never started' });
/** A git repository the starts name. */
export function shop(box) {
  const repo = join(box.dir, 'shop');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'README.md'), 'The repository #2974\'s session starts name.\n');
  const git = (...args) => execFileSync('git', args, { cwd: repo, env: box.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'base');
  return repo;
}
/** One start: `{ t, done, reply, hub }`, t when it was sent, hub the start ID of the hub that said hello. */
export async function start(box) {
  const t = Date.now();
  const got = await rawCall({ socket: box.socket, tokenFile: box.tokenFile, method: 'start.session', params: START(box), peer: true, ms: 60_000 });
  return { t, done: Date.now(), reply: got.reply, hub: typeof got.hub === 'object' ? got.hub.start : undefined };
}
/** Starts sent from a promotion's exit on, each as soon as the last came back, until one is served or one was sent past `ms` after it. */
export async function servedAfter(box, exit, ms) {
  const sent = [];
  for (;;) {
    const s = await start(box);
    sent.push(s);
    if (served(s)) return { got: s, sent };
    if (s.t > exit + ms) return { sent };
  }
}

/** Served: the start's own checks answered it with a result. */
export const served = (s) => typeof s.reply === 'object' && s.reply !== null && 'result' in s.reply && !s.reply.error;
/** Refused by a drain: an error whose words name a drain or a pause of starts. */
export const drained = (s) => typeof s.reply === 'object' && s.reply !== null && !!s.reply.error && /drain|paus/i.test(JSON.stringify(s.reply.error));
export const said = (s, box) => redact(JSON.stringify(s?.reply), box);

// ---- Readings of who holds a drain and since when (README: Readings).
/** Every string and number in a JSON value, deep. */
function leaves(value, out = []) {
  if (value === null || value === undefined) return out;
  if (typeof value === 'string' || typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (typeof value === 'object') for (const v of Object.values(value)) leaves(v, out);
  return out;
}
/** The objects in a JSON value, deep, itself first. */
function objects(value, out = []) {
  if (value && typeof value === 'object') {
    out.push(value);
    for (const v of Object.values(value)) objects(v, out);
  }
  return out;
}
/** Whether a leaf is a time in [from, to] ms: epoch ms, epoch s or an ISO-8601 time (within `slack`, for one written to the minute). */
export function isTimeIn(leaf, from, to, slack = 60_000) {
  if (typeof leaf === 'number') return (leaf >= from && leaf <= to) || (leaf * 1000 >= from - 1000 && leaf * 1000 <= to + 1000);
  if (typeof leaf !== 'string') return false;
  return [...leaf.matchAll(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g)].some(([m]) => {
    const at = Date.parse(/Z|[+-]\d{2}:?\d{2}$/.test(m) ? m : `${m}Z`);
    return at >= from - slack && at <= to + slack;
  }) || [...leaf.matchAll(/\b1\d{12}\b/g)].some(([m]) => Number(m) >= from && Number(m) <= to);
}
/**
 * The holder in a JSON reading (health, `deep status --json`, a refusal's error): one object holding, deep within it,
 * the holder's PID as a number or a word, its command line's mark, and a time in [from, to]; undefined with none.
 */
export function holderIn(json, pid, mark, from, to) {
  return objects(json).find((o) => {
    const all = leaves(o);
    return all.some((v) => v === pid || (typeof v === 'string' && new RegExp(`\\b${pid}\\b`).test(v)))
      && all.some((v) => typeof v === 'string' && v.includes(mark))
      && all.some((v) => isTimeIn(v, from, to));
  });
}
/** Whether a text names a time in [from, to]: ISO, epoch ms, a UTC clock time (HH:MM, the sandbox's TZ) or an age ("12 s ago", "for 1 min"). */
export function textTimeIn(text, from, to, now = Date.now()) {
  if (isTimeIn(text, from, to)) return true;
  const minutes = new Set();
  for (let at = from - 60_000; at <= to + 60_000; at += 30_000) minutes.add(new Date(at).toISOString().slice(11, 16));
  if ([...text.matchAll(/\b(\d{2}:\d{2})(?::\d{2})?\b/g)].some(([, hm]) => minutes.has(hm))) return true;
  return [...text.matchAll(/(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?)\b/gi)].some(([, n, unit]) => {
    const ms = Number(n) * (/^m/i.test(unit) ? 60_000 : 1000);
    return now - ms >= from - 65_000 && now - ms <= to + 65_000;
  });
}

// ---- A session's turn, played through the real deep-hook, `deep-hook claude-code <event>` with the hook JSON on stdin
// and the session's folder as its working folder, as Claude Code runs it. The test's process is the agent: deep-hook
// names its parent. A turn runs from a prompt you typed until its stop; while a shell call it began has no end yet,
// the session reads working, as a long command keeps a real turn running.
export const COVERED = JSON.parse(readFileSync(join(CHECKOUT, 'adapters', 'claude-code.facts.json'), 'utf8')).versions.at(-1);
export function session(box) {
  const id = randomUUID();
  const folder = join(box.dir, 'shop');
  const transcript = join(box.home, '.claude', 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd: folder, transcript };
}
function entry(s, value) {
  const uuid = randomUUID();
  writeFileSync(s.transcript, `${JSON.stringify({ parentUuid: s.parent ?? null, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: s.cwd, sessionId: s.id, version: COVERED, gitBranch: 'main' })}\n`, { flag: 'a' });
  s.parent = uuid;
}
export async function hook(box, s, event, extra = {}) {
  const base = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  if (event === 'Stop') Object.assign(base, { stop_hook_active: false });
  const run = await ended(launch(box, [DEEP_HOOK, 'claude-code', event], { cwd: s.cwd, input: JSON.stringify({ ...base, ...extra }) }), 120_000);
  return { ...run, event };
}
/** A turn that runs: the session's start, a prompt you typed, and a shell call begun with no end yet. */
export async function turnRuns(box, s) {
  await hook(box, s, 'SessionStart');
  s.prompt = randomUUID();
  const text = 'run the long build';
  entry(s, { promptId: s.prompt, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: 1 }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  await hook(box, s, 'UserPromptSubmit', { prompt: text, prompt_id: s.prompt });
  s.call = { tool_name: 'Bash', tool_input: { command: 'sleep 600' }, tool_use_id: `toolu_${randomBytes(10).toString('hex')}` };
  entry(s, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: s.call.tool_use_id, name: 'Bash', input: s.call.tool_input }], stop_reason: 'tool_use' } });
  return hook(box, s, 'PreToolUse', { ...s.call, prompt_id: s.prompt });
}
/** The turn's end: the call's result, the final message and the stop. */
export async function turnEnds(box, s) {
  const response = { stdout: '', stderr: '', interrupted: false };
  entry(s, { promptId: s.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: s.call.tool_use_id, type: 'tool_result', content: '' }] }, toolUseResult: response });
  await hook(box, s, 'PostToolUse', { ...s.call, tool_response: response, prompt_id: s.prompt });
  const done = 'The long build finished.';
  entry(s, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: done }], stop_reason: 'end_turn' } });
  return hook(box, s, 'Stop', { last_assistant_message: done, prompt_id: s.prompt });
}

// ---- The watched repository (#1333) for the promotions: `origin.git`, a bare repository standing for GitHub's;
// `work`, the clone the tests land in; and `mac`, the clone main watch ticks in and `deep hub promote` runs in. Its
// first commit holds this checkout's scripts/ (main watch's own job among them) with the fixture's lanes, one tested
// function and its test.
const SUM_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../lib/sum.mjs';\ntest('adds two numbers', () => assert.equal(sum(2, 3), 5));\n";
const LANES = `// The fixture's lanes (tests/acceptance/2974/README.md, The promotions).
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
  writeFileSync(join(work, 'README.md'), "The repository #2974's promotion tests watch and build from.\n");
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
/** A landing on origin's main: a commit adding `landings/<k>`, naming made-up issue #987<k>. */
export function land(box, fx) {
  const k = fx.landings.length + 1;
  mkdirSync(join(fx.work, 'landings'), { recursive: true });
  writeFileSync(join(fx.work, 'landings', String(k)), `${k}\n`);
  fx.git('add', '-A');
  fx.git('commit', '-qm', `Landing ${k} (Part of #${9870 + k})`);
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

/**
 * A good build (README: The promotions): a folder holding build.json naming its commit, bin/deep and bin/deep-hook.
 * Its bin/deep notes each run in <sandbox>/starts.jsonl (the build, its PID, the time in ms, its arguments), then runs
 * this checkout's CLI; its bin/deep-hook is a copy of this checkout's target/debug/deep-hook.
 */
export function makeBuild(box, name, commit) {
  const folder = join(box.builds, name);
  mkdirSync(join(folder, 'bin'), { recursive: true });
  writeFileSync(join(folder, 'build.json'), `${JSON.stringify({ commit, built_by: 'tests/acceptance/2974' }, null, 2)}\n`);
  const note = `/usr/bin/perl -MTime::HiRes=time -e 'open(my $f, ">>", $ARGV[0]) or exit 0; my $a = $ARGV[3]; $a =~ s/["\\\\]//g; printf $f "{\\"build\\":\\"%s\\",\\"pid\\":%d,\\"t\\":%.0f,\\"args\\":\\"%s\\"}\\n", $ARGV[1], $ARGV[2], time*1000, $a' ${JSON.stringify(join(box.dir, 'starts.jsonl'))} ${JSON.stringify(name)} "$$" "$*"`;
  script(join(folder, 'bin', 'deep'), `#!/bin/sh\n${note}\nexec ${JSON.stringify(NODE)} ${JSON.stringify(CLI)} "$@"\n`);
  copyFileSync(DEEP_HOOK, join(folder, 'bin', 'deep-hook'));
  chmodSync(join(folder, 'bin', 'deep-hook'), 0o755);
  return { name, folder, commit };
}
/** Runs of the installed hub, `bin/deep hub run` as the login service runs it, by build `name`, after `since` ms. */
export const hubStarts = (box, name, since = 0) => lines(join(box.dir, 'starts.jsonl')).filter((s) => s.build === name && s.args === 'hub run' && s.t >= since);
/** `deep hub promote <folder>`, started in the clone main watch watches: the child, still running. */
export const promoting = (box, fx, build) => launch(box, [NODE, CLI, 'hub', 'promote', build.folder], { cwd: fx.mac });
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
 * The scene the interrupted and the good promotions share: c1's build promoted with no hub running, five landings and
 * a tick, c2's build planted, the shop repository the starts name, and a turn running in a session of that hub.
 */
export async function promotedWithTurn(box) {
  shop(box);
  const fx = watched(box);
  await passed(box, fx, fx.c1);
  const first = await ended(promoting(box, fx, makeBuild(box, 'good-c1', fx.c1)), 900_000);
  assert.equal(first.status, 0, `BLOCKED: the first promotion, of a build of ${sha7(fx.c1)} with no hub running yet, failed: ${shown(first, box)}`);
  const before = await hello(box, { ms: 30_000 });
  const pid = await hubPid(box, { ms: 120_000 });
  assert.ok(before && pid, 'BLOCKED: no installed hub answered after the first promotion');
  for (let k = 0; k < LANDINGS; k++) land(box, fx);
  const c2 = fx.landings.at(-1);
  await passed(box, fx, c2);
  const build = makeBuild(box, 'good-c2', c2);
  const s = session(box);
  const began = await turnRuns(box, s);
  assert.equal(began.status, 0, `BLOCKED: the turn's PreToolUse hook failed: ${shown(began, box)}`);
  return { fx, before, pid, build, s };
}
/** Waits for a promotion to say it waits for a running turn; why not, or undefined once it does. */
export async function waitsForTurn(box, child, ms = 180_000) {
  const said = await until(() => /waiting for \d+ running turn/.test(child.out) || child.exitCode !== null, ms, 100);
  if (said && child.exitCode === null) return undefined;
  return `BLOCKED: deep hub promote never said it waits for the running turn: ${redact(`exit ${child.exitCode}\nstdout:\n${child.out}\nstderr:\n${child.err}`, box)}`;
}
