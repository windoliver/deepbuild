// Helpers for #1334's acceptance tests (README): a sandboxed HOME, TMPDIR and XDG_* folders; stand-ins for what the
// repo doesn't own (launchd or systemd behind the DEEP_HUB_LAUNCHER seam, gh and GitHub, launchctl and systemctl
// themselves); the watched repository main watch (#1333) ticks on; the builds the tests plant; the hub's socket; and
// Claude Code played through the real deep-hook. Nothing here imports the code under test: every surface is reached
// by running it, as `deep`, `deep-hook`, `scripts/main-watch.mjs` and the socket (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(CHECKOUT, 'packages', 'cli', 'dist', 'main.js');
export const DEEP_HOOK = join(CHECKOUT, 'target', 'debug', 'deep-hook');
export const NODE = process.execPath;
export const LONG = { timeout: 1_800_000 };
/** The issue's bound on a rollback. */
export const ROLLBACK_MS = 60_000;
/** The planted programs a test selects with DEEP_HUB_PLANT (README: The surface). */
export const MISJUDGES = 'judges-claims-wrongly';
export const AHEAD = 'contract-major-ahead';
/** main watch's set number of landings (#1333): a tick runs the lanes once 5 landed since the last run. */
export const LANDINGS = 5;

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

// The stand-ins for launchd (or systemd) and gh are files of their own: fixtures/launcher.mjs and fixtures/gh.mjs.
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

/**
 * A sandbox removed after the test: HOME, TMPDIR and XDG_* inside it, git's identity, the stand-ins first on PATH
 * (launcher, gh, and launchctl and systemctl, which record any call and exit 1), and every process a test starts in
 * a process group of its own, stopped by its PID at the end, with the jobs the launchd stand-in started.
 */
export async function sandbox(t) {
  built();
  // Short: a Unix socket path must fit in 104 bytes on macOS (the hub's is <home>/.deepbuild/hub.sock).
  const dir = realpathSync(mkdtempSync('/tmp/d1334-'));
  const home = join(dir, 'h'), temp = join(dir, 't'), bin = join(dir, 'bin'), state = join(dir, 'launchd'), builds = join(dir, 'builds');
  for (const folder of [home, temp, bin, state, builds]) mkdirSync(folder, { recursive: true });
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[core]\n\thooksPath = /dev/null\n');
  symlinkSync(NODE, join(bin, 'node'));
  script(join(bin, 'launcher'), `#!/bin/sh\nT1334_LAUNCHD=${JSON.stringify(state)} exec ${JSON.stringify(NODE)} ${JSON.stringify(join(FIXTURES, 'launcher.mjs'))} "$@"\n`);
  script(join(bin, 'gh'), `#!/bin/sh\nT1334_GH=${JSON.stringify(dir)} exec ${JSON.stringify(NODE)} ${JSON.stringify(join(FIXTURES, 'gh.mjs'))} "$@"\n`);
  for (const name of ['launchctl', 'systemctl']) {
    script(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' ${name} "$*" >> ${JSON.stringify(join(dir, 'service-calls.log'))}\necho "stand-in ${name}: the tests' service manager is DEEP_HUB_LAUNCHER" >&2\nexit 1\n`);
  }
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
    // The doctor's canvas render is skipped: no item of this suite reads it, and it takes a minute on a loaded Mac.
    DEEP_DOCTOR_CANVAS_FAULT: 'render_skipped',
    GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', TZ: 'UTC', LC_ALL: 'C',
  });
  const box = { dir, home, temp, bin, state, builds, env, root: join(home, '.deepbuild'), socket: join(home, '.deepbuild', 'hub.sock'), children: [] };
  t.after(async () => {
    const groups = new Set();
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null && child.pid) groups.add(child.pid);
    // The launchd stand-in's supervisor and every job it started: processes this test's commands started.
    try { groups.add(Number(readFileSync(join(state, 'supervisor.pid'), 'utf8'))); } catch {}
    for (const e of lines(join(state, 'launchd.jsonl'))) if (e.event === 'start' && e.pid) groups.add(e.pid);
    for (const pid of groups) try { process.kill(-pid, 'SIGTERM'); } catch {}
    await wait(1500);
    for (const pid of groups) try { process.kill(-pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Starts `argv` in the sandbox in a process group of its own; `done` resolves with its status, output and times. */
export function launch(box, argv, { env = {}, cwd = box.dir, input } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  if (input !== undefined) { child.stdin.on('error', () => undefined); child.stdin.end(input); }
  child.started = Date.now();
  child.done = new Promise((done) => {
    child.on('error', (error) => { stderr += String(error); });
    child.on('close', (status, signal) => { child.ended = Date.now(); done({ status, signal, stdout, stderr, started: child.started, ended: child.ended }); });
  });
  child.output = () => ({ stdout, stderr });
  return child;
}
/** A child's end, or its group stopped by its PID after `ms`: a program that never ends fails at an assertion. */
export function ended(child, ms) {
  const stop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, ms);
  return child.done.finally(() => clearTimeout(stop));
}
export const shown = (run) => (run ? `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${String(run.stdout).slice(-4000)}\nstderr:\n${String(run.stderr).slice(-3000)}` : '(not run)');
/** `deep <args>`, this checkout's CLI, in the sandbox. */
export const deep = (box, args, o = {}) => ended(launch(box, [NODE, CLI, ...args], o), o.timeoutMs ?? 300_000);

// ---- The watched repository (#1333): `origin.git`, a bare repository standing for GitHub's; `work`, the clone the
// tests land in; and `mac`, the clone main watch ticks in and `deep hub promote` runs in. Its first commit holds this
// checkout's scripts/ (main watch's own job among them) with the fixture's lanes, one tested function and its test.
const SUM_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../lib/sum.mjs';\ntest('adds two numbers', () => assert.equal(sum(2, 3), 5));\n";
export const GOOD_SUM = 'export const sum = (a, b) => a + b;\n';
export const BROKEN_SUM = 'export const sum = (a, b) => a - b;\n';
/** The fixture's lanes: this checkout's lanes.mjs whole (as scripts/lanes-real.mjs, so its throttle and lease are the copy's), its checks cut to two tiny lanes. */
const LANES = `// The fixture's lanes (tests/acceptance/1334/README.md, The watched repository).
export * from './lanes-real.mjs';
export const checks = [
  { name: 'unit', commands: [[process.execPath, '--test', 'tests/sum.test.mjs']], fix: 'Repair the behavior named by the failing test.' },
  { name: 'lint', commands: [[process.execPath, '-e', '']], fix: 'Nothing to lint in the fixture.' },
];
`;
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
  writeFileSync(join(work, 'lib', 'sum.mjs'), GOOD_SUM);
  writeFileSync(join(work, 'tests', 'sum.test.mjs'), SUM_TEST);
  writeFileSync(join(work, 'README.md'), 'The repository #1334\'s tests watch and build from.\n');
  const git = gitIn(box, work);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'c1: the watched repository');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  gitIn(box, box.dir)('clone', '-q', origin, mac);
  return { origin, work, mac, git, c1: git('rev-parse', 'HEAD'), landings: [] };
}
/** A landing on origin's main: a commit adding `landings/<k>`, naming issue #910<k>; `broken` makes sum subtract. */
export function land(box, fx, { broken = false } = {}) {
  const k = fx.landings.length + 1;
  mkdirSync(join(fx.work, 'landings'), { recursive: true });
  writeFileSync(join(fx.work, 'landings', String(k)), `${k}\n`);
  if (broken) writeFileSync(join(fx.work, 'lib', 'sum.mjs'), BROKEN_SUM);
  fx.git('add', '-A');
  fx.git('commit', '-qm', `Landing ${k} (Part of #${9100 + k})`);
  fx.git('push', '-q', 'origin', 'main');
  const sha = fx.git('rev-parse', 'HEAD');
  fx.landings.push(sha);
  return sha;
}
/** One scheduled run of main watch, `node scripts/main-watch.mjs tick`, in the clone it watches. */
export const tick = (box, fx) => ended(launch(box, [NODE, 'scripts/main-watch.mjs', 'tick'], { cwd: fx.mac }), 900_000);
/** main watch's gate: `open` (`landings open`, exit 0) or `paused` (`landings paused …`, non-zero), from its first line. */
export async function watchStatus(box, fx) {
  const run = await ended(launch(box, [NODE, 'scripts/main-watch.mjs', 'status'], { cwd: fx.mac }), 120_000);
  const first = run.stdout.split('\n').find(Boolean) ?? '';
  return { state: run.status === 0 && /^landings open\b/.test(first) ? 'open' : run.status !== 0 && /^landings paused\b/.test(first) ? 'paused' : 'unreadable', line: first, run };
}
/** Five landings, `broken` the last, then a tick: main watch's run on the new head. */
export async function fiveAndTick(box, fx, { broken = false } = {}) {
  for (let k = 1; k <= LANDINGS; k++) land(box, fx, { broken: broken && k === LANDINGS });
  const run = await tick(box, fx);
  return { head: fx.landings.at(-1), run, status: await watchStatus(box, fx) };
}

// ---- Builds (README: Builds). A build is a folder: build.json naming its commit, bin/deep, bin/deep-hook. Each
// bin/deep the tests plant notes every run in <sandbox>/starts.jsonl (the build, its PID, the time in ms, its
// arguments) before it does what its kind says:
//   good      this checkout's CLI, as built
//   crash     exits 1 at once, for any arguments: a build that crashes at start
//   misjudge  this checkout's CLI with DEEP_HUB_PLANT=judges-claims-wrongly: it starts, answers, and judges claims wrong
// bin/deep-hook is a copy of this checkout's target/debug/deep-hook in every kind.
export function makeBuild(box, name, commit, kind) {
  const folder = join(box.builds, name);
  mkdirSync(join(folder, 'bin'), { recursive: true });
  writeFileSync(join(folder, 'build.json'), `${JSON.stringify({ commit, built_by: 'tests/acceptance/1334', kind }, null, 2)}\n`);
  const note = `/usr/bin/perl -MTime::HiRes=time -e 'open(my $f, ">>", $ARGV[0]) or exit 0; my $a = $ARGV[3]; $a =~ s/["\\\\]//g; printf $f "{\\"build\\":\\"%s\\",\\"pid\\":%d,\\"t\\":%.0f,\\"args\\":\\"%s\\"}\\n", $ARGV[1], $ARGV[2], time*1000, $a' ${JSON.stringify(join(box.dir, 'starts.jsonl'))} ${JSON.stringify(name)} "$$" "$*"`;
  const run = `exec ${JSON.stringify(NODE)} ${JSON.stringify(CLI)} "$@"`;
  const body = kind === 'crash' ? `echo "planted build ${name}: crashes at start" >&2\nexit 1`
    : kind === 'misjudge' ? `DEEP_HUB_PLANT=${MISJUDGES}\nexport DEEP_HUB_PLANT\n${run}`
      : run;
  script(join(folder, 'bin', 'deep'), `#!/bin/sh\n${note}\n${body}\n`);
  copyFileSync(DEEP_HOOK, join(folder, 'bin', 'deep-hook'));
  chmodSync(join(folder, 'bin', 'deep-hook'), 0o755);
  return { name, folder, commit, kind };
}
/** Every run of a planted bin/deep so far. */
export const starts = (box) => lines(join(box.dir, 'starts.jsonl'));
/** Runs of the installed hub, `bin/deep hub run` as the login service runs it, by build `name`, after `since` ms. */
export const hubStarts = (box, name, since = 0) => starts(box).filter((s) => s.build === name && s.args === 'hub run' && s.t >= since);
/** What the launchd stand-in recorded: loads, starts and exits. */
export const launchd = (box) => lines(join(box.state, 'launchd.jsonl'));
/** Every call a test's processes made to launchctl or systemctl (each stand-in exits 1). */
export const serviceCalls = (box) => (existsSync(join(box.dir, 'service-calls.log')) ? readFileSync(join(box.dir, 'service-calls.log'), 'utf8').split('\n').filter(Boolean) : []);
/** `deep hub promote <folder>`, run in the clone main watch watches. */
export const promote = (box, fx, build) => launch(box, [NODE, CLI, 'hub', 'promote', build.folder], { cwd: fx.mac });
/** The build `~/.deepbuild/versions/current` names: its folder and the commit its build.json names; undefined with none. */
export function current(box) {
  const link = join(box.root, 'versions', 'current');
  let target;
  try { target = resolve(dirname(link), readlinkSync(link)); } catch { return undefined; }
  let commit;
  try { commit = JSON.parse(readFileSync(join(target, 'build.json'), 'utf8')).commit; } catch { /* none */ }
  return { link: readlinkSync(link), folder: target, commit, inVersions: dirname(ok(target) ?? target) === (ok(join(box.root, 'versions')) ?? join(box.root, 'versions')) };
}

// ---- The hub's socket, read as the CLI reads it (the cli role, with the control token), line by line.
/** The hub's hello at the installed socket, or undefined when no hub answers within `ms`. */
export function hello(box, ms = 2000) {
  return new Promise((done) => {
    const sock = net.connect(box.socket);
    let buffer = '';
    const finish = (value) => { clearTimeout(timer); sock.destroy(); done(value); };
    const timer = setTimeout(() => finish(undefined), ms);
    sock.setEncoding('utf8');
    sock.on('error', () => finish(undefined));
    sock.on('data', (chunk) => {
      buffer += chunk;
      const i = buffer.indexOf('\n');
      if (i < 0) return;
      try { finish(JSON.parse(buffer.slice(0, i))); } catch { finish(undefined); }
    });
  });
}
/** One control call with the CLI's credential; rejects on a refusal or no answer. */
export function call(box, method, params = {}, ms = 30_000) {
  const token = readFileSync(join(box.root, 'control.token'), 'utf8').trim();
  return new Promise((done, fail) => {
    const sock = net.connect(box.socket);
    let buffer = '', step = 0;
    const timer = setTimeout(() => { sock.destroy(); fail(Error(`no answer to ${method} within ${ms} ms`)); }, ms);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); fail(error); });
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line;
        try { line = JSON.parse(buffer.slice(0, i)); } catch { line = {}; }
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1) {
          if (line.error) { clearTimeout(timer); sock.destroy(); return fail(Error(`the hub refused the CLI's hello: ${JSON.stringify(line.error)}`)); }
          step = 2;
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (line.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          return line.error ? fail(Error(`${method} refused: ${JSON.stringify(line.error)}`)) : done(line.result);
        }
      }
    });
  });
}
/** Every event in the record, paged by log_pos through `events.read`. */
export async function events(box) {
  const out = [];
  for (let after = 0; ;) {
    const page = (await call(box, 'events.read', { after, limit: 1000 })).events ?? [];
    if (!page.length) return out;
    out.push(...page);
    after = page.at(-1).log_pos;
  }
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
/** Stops the hub through its socket and waits for the socket to go quiet. */
export async function stopHub(box) {
  try { await call(box, 'hub.stop'); } catch { return; }
  await until(async () => !(await hello(box, 500)), 30_000);
}

// ---- Claude Code, played: the real deep-hook run as an agent's hook entry runs it, `<deep-hook> claude-code <event>`
// with the hook JSON on stdin and the session's folder as its working folder. The test process is the agent: deep-hook
// names its parent, which lives as long as the test does. Payloads are shaped like the corpus's Claude Code ones.
export function session(box, cwd) {
  const id = randomUUID();
  const folder = cwd ?? join(box.dir, `work-${id.slice(0, 8)}`);
  mkdirSync(folder, { recursive: true });
  const transcript = join(box.home, '.claude', 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd: folder, transcript, calls: [] };
}
export function payload(s, event, extra = {}) {
  const base = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  if (event === 'UserPromptSubmit') Object.assign(base, { prompt: 'carry on', prompt_id: randomUUID() });
  if (event === 'Stop') Object.assign(base, { stop_hook_active: false });
  return { ...base, ...extra };
}
/** One hook run; `hook` is the deep-hook binary (default: the one the current promoted build holds). */
export async function hook(box, s, event, extra = {}, { binary, env = {} } = {}) {
  const program = binary ?? join(box.root, 'versions', 'current', 'bin', 'deep-hook');
  const t = Date.now();
  const run = await ended(launch(box, [program, 'claude-code', event], { cwd: s.cwd, env, input: JSON.stringify(payload(s, event, extra)) }), 120_000);
  return { ...run, event, t };
}
/** The newest Claude Code version the facts cover: each transcript entry carries it, so a session isn't watch-only. */
export const COVERED = JSON.parse(readFileSync(join(CHECKOUT, 'adapters', 'claude-code.facts.json'), 'utf8')).versions.at(-1);
/**
 * One transcript entry, as Claude Code writes it. The hub reads whose a prompt is from the session's transcript: a
 * prompt with no entry reads as nobody's, so it opens no task and may not show as a turn at all.
 */
export function entry(s, value) {
  const uuid = randomUUID();
  writeFileSync(s.transcript, `${JSON.stringify({ parentUuid: s.parent ?? null, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: s.cwd, sessionId: s.id, version: COVERED, gitBranch: 'main' })}\n`, { flag: 'a' });
  s.parent = uuid;
}
/** A prompt you typed: its transcript entry, then its UserPromptSubmit, as Claude Code does. Returns the hook run and the prompt's ID. */
export async function typed(box, s, text, o = {}) {
  const prompt = randomUUID();
  entry(s, { promptId: prompt, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: (s.turns = (s.turns ?? 0) + 1) }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return { prompt, run: await hook(box, s, 'UserPromptSubmit', { prompt: text, prompt_id: prompt }, o) };
}

/** A tool call's two hooks, a shell command with a fresh tool_use_id, which its tool.before event keeps as `call`. */
export async function toolCall(box, s, command, o = {}) {
  const id = `toolu_${randomBytes(10).toString('hex')}`;
  s.calls.push(id);
  const input = { tool_name: 'Bash', tool_input: { command }, tool_use_id: id };
  const before = await hook(box, s, 'PreToolUse', input, o);
  const after = await hook(box, s, 'PostToolUse', { ...input, tool_response: { stdout: '', stderr: '', interrupted: false } }, o);
  return { id, before, after };
}
/** A whole turn: a prompt, one shell call, and the stop. */
export async function turn(box, s, label, o = {}) {
  const prompt = await hook(box, s, 'UserPromptSubmit', { prompt: `turn ${label}` }, o);
  const call = await toolCall(box, s, `echo ${label}`, o);
  const stop = await hook(box, s, 'Stop', {}, o);
  return { prompt, call, stop };
}

/**
 * The load rule: a hook run whose deep-hook says it couldn't hand its request to the hub within its 50 ms budget, nor
 * spool it, lost that request by its own budget, whatever the hub or a promotion did. A judgement that needs that
 * request reads INCONCLUSIVE, naming the load, never FAIL and never PASS.
 */
export const spoiled = (run) => /could not spool/.test(run?.stderr ?? '');
/** A hook run the hub didn't take live: deep-hook spooled it, or couldn't, for a later replay. */
export const late = (run) => /spool/.test(run?.stderr ?? '');
export const loadReading = () => `1-minute load ${loadavg()[0].toFixed(1)} on ${availableParallelism()} cores`;

// ---- Readers.
export const sessionOf = (e) => e.session ?? e.session_id ?? null;
/** The session's events that end an attempt or lose its session: session.gone, session.end. */
export const lost = (all, s) => all.filter((e) => (e.kind === 'session.gone' || e.kind === 'session.end') && (sessionOf(e) === s.id || String(e.subject ?? '').endsWith(s.id.replace(/[^0-9A-Za-z]/g, ''))));
/** The calls of `s` with no tool.before event keeping them. */
export const unrecorded = (all, s, ids = s.calls) => ids.filter((id) => !all.some((e) => e.kind === 'tool.before' && e.data?.call === id));
/** The notices of a rollback: `build.rolled_back` events. */
export const rollbacks = (all) => all.filter((e) => e.kind === 'build.rolled_back');

// ---- The login service's definition, written as the base's service code writes it (packages/hub/src/service.ts),
// for the doctor's tests: launchd's plist on macOS, a systemd user unit on Linux, naming `program`.
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function serviceFile(box) {
  return process.platform === 'darwin'
    ? join(box.home, 'Library', 'LaunchAgents', 'com.deepbuild.hub.plist')
    : join(box.home, '.config', 'systemd', 'user', 'deepbuild-hub.service');
}
export function writeService(box, program) {
  const file = serviceFile(box);
  mkdirSync(dirname(file), { recursive: true });
  const env = { PATH: box.env.PATH, HOME: box.home };
  const logs = join(box.root, 'logs');
  const text = process.platform === 'darwin'
    ? `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.deepbuild.hub</string>
  <key>ProgramArguments</key>
  <array>
    ${program.map((s) => `<string>${xml(s)}</string>`).join('\n    ')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>SoftResourceLimits</key>
  <dict>
    <key>NumberOfFiles</key>
    <integer>8192</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    ${Object.entries(env).map(([k, v]) => `<key>${xml(k)}</key>\n    <string>${xml(v)}</string>`).join('\n    ')}
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(join(logs, 'hub.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(logs, 'hub.log'))}</string>
</dict>
</plist>
`
    : `[Unit]\nDescription=DeepBuild hub\n\n[Service]\nExecStart=${program.map((s) => `"${s.replace(/(["\\])/g, '\\$1')}"`).join(' ')}\nEnvironment=${Object.entries(env).map(([k, v]) => `"${k}=${v}"`).join(' ')}\nRestart=on-failure\nLimitNOFILE=8192\n\n[Install]\nWantedBy=default.target\n`;
  writeFileSync(file, text);
  return file;
}
/** The program a service definition names first, as the file says it. */
export function serviceProgram(box) {
  const file = serviceFile(box);
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  const first = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([\s\S]*?)<\/string>/.exec(text)?.[1] ?? /^ExecStart="?([^"\s]+)/m.exec(text)?.[1];
  return first?.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// ---- The rollback scene AC1 and AC2 share (README: The scenes). Main watch passes c1, and the good build of c1 is
// promoted; a session works a turn on it; five landings later main watch passes c2, and a planted build of c2 is
// promoted. While that promotion runs, the hub is polled every 250 ms, and once the planted build has started, the
// session works a turn every 3 s, until the last good build answers again. Then one more turn, the record read back,
// the hub restarted once through `deep hub start`, and the record read again. Nothing here throws on what the product
// does: each observation is kept for the tests to judge.
export async function rollbackScene(t, kind) {
  const box = await sandbox(t);
  const fx = watched(box);
  const o = { box, fx, kind };
  o.tick1 = await tick(box, fx);
  o.watch1 = await watchStatus(box, fx);
  o.good = makeBuild(box, 'good', fx.c1, 'good');
  o.first = await ended(promote(box, fx, o.good), 900_000);
  o.firstCurrent = current(box);
  o.firstHello = await hello(box, 5000);
  o.firstProgram = serviceProgram(box);
  if (!o.firstHello) return o;
  o.s = session(box);
  o.s.started = await hook(box, o.s, 'SessionStart');
  o.s.first = await turn(box, o.s, 'before');
  o.second = await fiveAndTick(box, fx);
  o.c2 = o.second.head;
  o.planted = makeBuild(box, kind, o.c2, kind);
  o.before = await events(box).catch(() => []);
  const child = promote(box, fx, o.planted);
  o.polls = [];
  o.during = [];
  let over = false;
  child.done.then(() => { over = true; });
  const plantedAt = () => starts(box).find((s) => s.build === kind)?.t;
  const back = (p) => p.hello && p.commit === fx.c1 && hubStarts(box, 'good', plantedAt() ?? Infinity).length > 0;
  // Polled until the promotion ends and, while the last good build isn't back, up to three times the bound after the
  // planted build first ran.
  const done = () => over && (!plantedAt() || o.backAt || Date.now() - plantedAt() > 3 * ROLLBACK_MS);
  // The session's work while that runs: a turn every 3 s once the planted build has started, until the good one is back.
  const worker = (async () => {
    while (!done() && !o.backAt) {
      if (plantedAt() && o.during.length < 12) o.during.push(await turn(box, o.s, `during-${o.during.length + 1}`));
      await wait(3000);
    }
  })();
  for (const deadline = Date.now() + 900_000; !done() && Date.now() < deadline;) {
    const p = { t: Date.now(), hello: await hello(box, 1000), commit: current(box)?.commit };
    o.polls.push(p);
    if (!o.backAt && plantedAt() && p.t > plantedAt() && back(p)) o.backAt = p.t;
    await wait(250);
  }
  o.promoted = await ended(child, 60_000);
  await worker;
  o.plantedAt = plantedAt();
  o.current = current(box);
  if (!(await hello(box, 5000))) return o;
  o.s.last = await turn(box, o.s, 'after');
  // The record once every call the session made is in it and the notice is, or after 60 s; then 3 s more.
  await until(async () => { const all = await events(box).catch(() => undefined); return all && !unrecorded(all, o.s).length && rollbacks(all).length > 0; }, 60_000, 1000);
  await wait(3000);
  o.after = await events(box).catch(() => undefined);
  // One restart of the hub, as a login or `deep hub start` brings it up again.
  await stopHub(box);
  o.restart = await deep(box, ['hub', 'start'], { cwd: fx.mac });
  o.restarted = await until(() => hello(box, 1000), 120_000, 500);
  if (o.restarted) {
    await wait(3000);
    o.afterRestart = await events(box).catch(() => undefined);
  }
  return o;
}

/** What a person reads at a failed assertion of a rollback scene. */
export const told = (o) => [
  `the planted promotion: ${shown(o.promoted)}`,
  `planted bin/deep runs (build, ms from the planted build's first run, args): ${starts(o.box).map((s) => `${s.build} ${s.t - (o.plantedAt ?? 0)} ${s.args}`).join('; ')}`,
  `launchd stand-in (event, ms): ${launchd(o.box).map((e) => `${e.event}${e.code !== undefined ? ` ${e.code}` : ''} ${e.t - (o.plantedAt ?? 0)}`).join('; ')}`,
  `versions/current: ${JSON.stringify(o.current)}`,
].join('\n');

/**
 * The judgement AC1 and AC2 share: the planted build ran; the last good build answered again within 60 s of its
 * first run; the promotion exited as a failure; no attempt was lost; one notice names the planted build's commit, and
 * still one after a restart. `why` is what the criterion's wrong program is told when the build never came back.
 */
export function rolledBack(o, id, why) {
  const { fx } = o;
  assert.ok(o.tick1.status === 0 && o.watch1.state === 'open', `${id} main watch didn't pass c1 ${sha7(fx.c1)}, so nothing could be promoted: ${shown(o.tick1)}\n${o.watch1.line}`);
  assert.ok(o.first.status === 0 && o.firstCurrent?.commit === fx.c1 && o.firstCurrent.inVersions && o.firstHello,
    `${id} the first promotion, of a build of ${sha7(fx.c1)} that main watch passed, must leave ~/.deepbuild/versions/current on its folder under versions/ and the hub answering: current ${JSON.stringify(o.firstCurrent)}, the hub ${o.firstHello ? 'answers' : 'does not answer'}\n${shown(o.first)}`);
  assert.equal(o.second.status.state, 'open', `${id} main watch didn't pass c2 ${sha7(o.c2)} after five landings: ${shown(o.second.run)}`);
  assert.ok(o.plantedAt, `${id} the planted ${o.kind} build of ${sha7(o.c2)} never ran, so nothing was rolled back\n${told(o)}`);
  assert.ok(o.backAt, `${id} the last good build (${sha7(fx.c1)}) never came back: ${why}\n${told(o)}`);
  const took = o.backAt - o.plantedAt;
  assert.ok(took <= ROLLBACK_MS, `${id} the last good build answered again ${(took / 1000).toFixed(1)} s after the planted build first ran; the bound is ${ROLLBACK_MS / 1000} s\n${told(o)}`);
  assert.ok(o.promoted.status === 1 || o.promoted.status === 3, `${id} a promotion that was rolled back exits as a failure (1 or 3), not ${o.promoted.status}\n${told(o)}`);
  assert.equal(o.current?.commit, fx.c1, `${id} versions/current must name the last good build after the rollback\n${told(o)}`);
  // No attempt lost: every call the session made before, during and after is in the record, every event of it from
  // before the promotion still is, and nothing ended its session.
  assert.ok(o.after, `${id} the record couldn't be read after the rollback\n${told(o)}`);
  assert.ok(o.during.length > 0, `${id} the session worked no turn while the planted build was in, so nothing shows an attempt survives it\n${told(o)}`);
  const runs = [o.s.started, ...[o.s.first, ...o.during, o.s.last].filter(Boolean).flatMap((x) => [x.prompt, x.call.before, x.call.after, x.stop])];
  const dropped = runs.filter(spoiled);
  assert.deepEqual(dropped.map((r) => r.event), [], `INCONCLUSIVE: ${id} deep-hook itself couldn't hand ${dropped.length} of the session's hook runs to the hub or its spool within its 50 ms budget (${dropped[0]?.stderr.trim()}), at ${loadReading()}, so no attempt can be judged lost or kept; run it again on a quieter machine`);
  const missing = unrecorded(o.after, o.s);
  assert.deepEqual(missing, [], `${id} an attempt lost: ${missing.length} of the session's ${o.s.calls.length} calls aren't in the record after the rollback (by tool_use_id)\n${told(o)}`);
  const ids = new Set(o.after.map((e) => e.id));
  const gone = o.before.filter((e) => sessionOf(e) === o.s.id && !ids.has(e.id));
  assert.deepEqual(gone.map((e) => `${e.kind} ${e.id}`), [], `${id} an attempt lost: events of the session from before the promotion are gone from the record`);
  assert.deepEqual(lost(o.after, o.s).map((e) => e.kind), [], `${id} an attempt lost: the record ended the session's attempt`);
  // One notice naming the commit.
  const notices = rollbacks(o.after);
  assert.equal(notices.length, 1, `${id} one notice of the rollback, a build.rolled_back event in the record naming the promoted commit ${sha7(o.c2)}; there are ${notices.length}: ${JSON.stringify(notices.map((e) => e.data))}\n${told(o)}`);
  const named = notices[0].data?.commit;
  assert.ok(typeof named === 'string' && named.length >= 7 && o.c2.startsWith(named), `${id} the rollback's notice must name the promoted commit ${o.c2} in data.commit, not ${JSON.stringify(notices[0].data)}`);
  assert.ok(o.restarted && o.afterRestart, `${id} after the rollback the hub didn't come back from deep hub start: ${shown(o.restart)}`);
  assert.equal(rollbacks(o.afterRestart).length, 1, `${id} one notice, never twice: after one restart of the hub the record holds ${rollbacks(o.afterRestart).length} build.rolled_back events`);
  return `the last good build answered ${(took / 1000).toFixed(1)} s after the planted build first ran, at ${loadReading()}; ${o.during.length} turns worked meanwhile`;
}
