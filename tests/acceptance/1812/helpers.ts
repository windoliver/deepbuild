// Shared test-side tools for issue #1812's acceptance tests (README): throwaway homes with stand-ins for the login
// service and the service managers, the built `deep` CLI run as a child process, setup through the CLI, a hub run in a
// home, the commands `deep --help` lists, and the one check of a hub that isn't answering. The world, the process
// helpers and listedCommands are adapted from tests/acceptance/1359/helpers.ts (same repo, same license). Nothing here
// stands in for DeepBuild: every test reaches it through the CLI, the files under the throwaway home and the repo's lint
// lane. Processes are stopped by PID only.

import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout under test: its packages/cli/dist/main.js is the `deep` every test runs. */
export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(CHECKOUT, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const SECOND = 1000;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The CLI must be built: a test that can't run it is BLOCKED, never a pass. */
export function needBuild(): void {
  if (!existsSync(CLI)) throw Error(`BLOCKED: no built CLI at ${CLI}; run npm run build --workspaces first`);
}
/** setup's entries name the built deep-hook (#18), and a hub won't start without it. */
export function needHook(): void {
  if (!['release', 'debug'].some((p) => existsSync(join(CHECKOUT, 'target', p, 'deep-hook')))) {
    throw Error(`BLOCKED: no deep-hook built under ${join(CHECKOUT, 'target')}; run cargo build --locked -p deep-hook first`);
  }
}

// ---- Temp folders. Short real paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1812-'));
  made.push(dir);
  return dir;
}

/**
 * A throwaway world: `<tmp>/h` is HOME (empty: nobody set DeepBuild up there), `<tmp>/w` the working folder a command
 * runs in, and `<tmp>/bin` first on PATH with:
 * - `launcher`, the login service stand-in (fixtures/launcher.mjs, #1002's): `deep setup` and `deep hub start` hand it
 *   the hub's service definition through `DEEP_HUB_LAUNCHER`, and it starts the program the definition names, logging
 *   each PID to `<tmp>/launched`;
 * - `refusing-launcher`, a login service that loads nothing and exits 1, and `launchctl` and `systemctl`, which do the
 *   same, so nothing reaches the real service manager, and `curl` and `wget`, so no script downloads; each logs its
 *   call to `<tmp>/bin/calls.log`;
 * - `sh-login`, your login shell (SHELL), whose PATH is `<tmp>/bin`, Node's folder and the system's;
 * - `installer.sh`, the agent's own installer as DEEP_HUB_TEST_INSTALLER names it (#1349's seam): it logs its call and
 *   exits 1, installing nothing, so setup never fetches an installer over the network.
 * There is no `cargo`, `claude` or `codex` on that PATH. `<tmp>/confirm` holds `cancelled`: the OS confirmation stubbed
 * through DEEP_HUB_TEST_CONFIRM (#24), so nothing a command asks you to confirm goes through.
 */
export interface World { tmp: string; home: string; work: string; bin: string }
export function world(): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const work = join(tmp, 'w');
  const bin = join(tmp, 'bin');
  for (const dir of [home, work, bin]) mkdirSync(dir);
  for (const name of ['launchctl', 'systemctl', 'refusing-launcher', 'curl', 'wget']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  const script = (name: string, text: string) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  script('launcher', `#!/bin/sh\nprintf 'launcher %s\\n' "$*" >> '${bin}/calls.log'\nexec '${NODE}' '${join(FIXTURES, 'launcher.mjs')}' "$@"\n`);
  script('installer.sh', `#!/bin/sh\n# The agent's installer stand-in: installs nothing.\nprintf 'installer %s\\n' "$*" >> '${bin}/calls.log'\nexit 1\n`);
  script('sh-login', [
    '#!/bin/sh',
    '# Your login shell, as setup reads it: the PATH a login shell sets is this one. Login and interactive flags are',
    '# dropped, so no profile of the machine running the tests is read.',
    `PATH='${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
    '',
  ].join('\n'));
  writeFileSync(join(tmp, 'confirm'), 'cancelled\n');
  return { tmp, home, work, bin };
}
export const rootOf = (w: World) => join(w.home, '.deepbuild');
export const socketOf = (w: World) => join(rootOf(w), 'hub.sock');
/** What the stand-ins were asked to do, one line a call. */
export const calls = (w: World): string[] => (existsSync(join(w.bin, 'calls.log')) ? readFileSync(join(w.bin, 'calls.log'), 'utf8').split('\n').filter(Boolean) : []);

/** #1002's marker that setup finished in the home, as setup writes it, so no `deep` command here runs setup first. */
export function finished(w: World): void {
  mkdirSync(rootOf(w), { recursive: true, mode: 0o700 });
  const version = (JSON.parse(readFileSync(join(CHECKOUT, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(rootOf(w), 'setup-finished.json'), `${JSON.stringify({ version, at: new Date().toISOString() })}\n`, { mode: 0o600 });
}

/** A git checkout with one commit on main, at `<tmp>/<name>`, for the commands that name a repo. */
export function repo(w: World, name = 'repo'): string {
  const dir = join(w.tmp, name);
  mkdirSync(dir);
  const env = { PATH: '/usr/bin:/bin', HOME: w.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env });
  writeFileSync(join(dir, 'README.md'), '# a fixture repo\n');
  execFileSync('git', ['add', '.'], { cwd: dir, env });
  execFileSync('git', ['-c', 'user.name=dh1812', '-c', 'user.email=dh1812@example.invalid', 'commit', '-q', '-m', 'init'], { cwd: dir, env });
  return dir;
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * The environment a child gets: HOME the world's home, the stand-ins first on PATH, a login service (`starts`, the
 * launcher, or `refuses`, the default) as `DEEP_HUB_LAUNCHER`, and no DEEP_, XDG_, CLAUDE*, CODEX*, GIT_, MCP_,
 * NODE_OPTIONS or billing variable of this process's. `extra` sets or (undefined) removes more.
 */
export function childEnv(w: World, o: { hub?: 'starts' | 'refuses' | undefined; extra?: Record<string, string | undefined> | undefined } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|MCP_|AI_AGENT)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = w.home;
  env.XDG_CONFIG_HOME = join(w.home, '.config');
  env.XDG_CACHE_HOME = join(w.home, '.cache');
  env.SHELL = join(w.bin, 'sh-login');
  env.PATH = `${w.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.LC_ALL = 'C';
  env.TMPDIR = join(w.tmp, 'tmp');
  mkdirSync(env.TMPDIR, { recursive: true });
  env.DEEP_HUB_TEST_CONFIRM = join(w.tmp, 'confirm');
  env.DEEP_HUB_TEST_INSTALLER = join(w.bin, 'installer.sh');
  env.DEEP_HUB_LAUNCHER = join(w.bin, o.hub === 'starts' ? 'launcher' : 'refusing-launcher');
  env.DEEP_TEST_LAUNCHER_LOG = join(w.tmp, 'launched');
  for (const [key, value] of Object.entries(o.extra ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
export function own(pid: number | undefined | null): void {
  if (pid) owned.add(pid);
}
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
  try {
    return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}
/** Stops `pids` (SIGTERM, then SIGKILL after 10 s) and waits for them to be gone. */
export async function stop(pids: readonly number[]): Promise<void> {
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 10 * SECOND;
  while (pids.some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  while (pids.some(alive)) await sleep(50);
}
/** The hubs the login service stand-in started in a world, by the PIDs it logged. */
export const launched = (w: World): number[] => (existsSync(join(w.tmp, 'launched')) ? readFileSync(join(w.tmp, 'launched'), 'utf8').split('\n').map(Number).filter((pid) => pid > 0) : []);
/** Stops the hubs the launcher started in `w`. */
export const stopHubs = (w: World): Promise<void> => stop(launched(w));
/** Stops every process this suite started, the hubs the launcher started included, and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const dir of made) {
    const log = join(dir, 'launched');
    if (existsSync(log)) for (const pid of readFileSync(log, 'utf8').split('\n').map(Number)) if (pid > 0) own(pid);
  }
  const pids = [...owned];
  owned.clear();
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while (pids.some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
/**
 * Runs a command to its end in a process group of its own, without blocking this process's event loop; at the timeout
 * the group this run made is killed (SIGKILL to its own PID's group, never by name or port).
 */
export function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number | undefined }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, o.timeoutMs ?? 120 * SECOND);
    child.on('error', (error) => { stderr += `\n[spawn failed: ${error.message}]`; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/** `deep <args>` as you run it: the built CLI (or `cli`, a front end of it) under this Node, in the world's working folder. */
export function deep(w: World, args: readonly string[], o: { cli?: string; hub?: 'starts' | 'refuses'; extra?: Record<string, string | undefined>; timeoutMs?: number; cwd?: string } = {}): Promise<Ran> {
  return run(NODE, [o.cli ?? CLI, ...args], { env: childEnv(w, { hub: o.hub, extra: o.extra }), cwd: o.cwd ?? w.work, timeoutMs: o.timeoutMs });
}

/**
 * `deep setup` in the world, with the login service stand-in that starts the hub: setup returns once the hub answers.
 * An agent is found first, so setup plans no install (#1349): a stand-in `claude` sits where Claude Code's installer
 * puts it, `~/.local/bin/claude`, off every PATH here; run, it logs its call and exits 1. Its hubs are stopped by PID at
 * cleanup, or by stopHubs. A setup that doesn't finish is BLOCKED.
 */
export async function setUp(w: World): Promise<void> {
  needBuild();
  needHook();
  mkdirSync(join(w.home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(w.home, '.local', 'bin', 'claude'), `#!/bin/sh\nprintf 'claude %s\\n' "$*" >> '${w.bin}/calls.log'\nexit 1\n`, { mode: 0o755 });
  const r = await deep(w, ['setup'], { hub: 'starts', timeoutMs: 240 * SECOND });
  const reached = calls(w).filter((line) => /^(installer|curl|wget|claude) /.test(line));
  if (reached.length) throw Error(`BLOCKED: deep setup reached past the stand-ins: ${reached.join('; ')}`);
  if (r.code !== 0 || !launched(w).length) throw Error(`BLOCKED: deep setup didn't set the home up with a hub: ${shown(r)}`);
}

/** Whether a hub answers on `socket`: it accepts a connection and sends its first line within `ms`. */
export function answers(socket: string, ms = 5 * SECOND): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(socket);
    const done = (ok: boolean) => { clearTimeout(timer); sock.destroy(); resolve(ok); };
    const timer = setTimeout(() => done(false), ms);
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => { if (d.includes('\n')) done(true); });
    sock.on('error', () => done(false));
    sock.on('close', () => done(false));
  });
}

/**
 * `deep hub run` in the world, as #66's and #1463's suites start a hub: a process of this suite's, with `extra` in its
 * environment, ready once it prints its `{"ready": true, ...}` line. One that doesn't start is BLOCKED.
 */
export interface Hub { pid: number; socket: string }
export async function hubRun(w: World, extra: Record<string, string> = {}): Promise<Hub> {
  needBuild();
  needHook();
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: w.work, env: childEnv(w, { extra }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
  const ready = await new Promise<{ ready?: unknown; pid?: unknown; socket?: unknown } | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 120 * SECOND);
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (!out.includes('\n')) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(out.split('\n')[0]!) as { ready?: unknown }); } catch { resolve(undefined); }
    });
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: deep hub run didn't start a hub: stdout ${JSON.stringify(out.slice(0, 500))}, stderr ${JSON.stringify(err.slice(-1500))}`);
  own(Number(ready.pid));
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket) };
}

// ---- The commands `deep --help` lists (#1359's reading of its usage lines).
/** The text up to the usage's first `|` at bracket depth 0, and so on: a synopsis's alternatives. */
function alternatives(synopsis: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of synopsis) {
    if (ch === '[' || ch === '<') depth++;
    if (ch === ']' || ch === '>') depth = Math.max(0, depth - 1);
    if (ch === '|' && depth === 0) { out.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  out.push(current.trim());
  return out;
}
const WORD = /^[a-z][a-z0-9-]*$/;
/**
 * Every command `deep --help` lists, as its words (`['hub', 'start']`): each usage line `deep <synopsis>  <what it
 * does>`, its synopsis split into alternatives at `|`. A command's words are the leading plain lowercase words of its
 * alternative; a later alternative replaces the last word of a two-word command (`hub run | start`), or of a one-word
 * one with nothing after it (`off | on`), and follows a one-word command that takes arguments (`numbers [--json] |
 * refresh`). An alternative that starts with a flag or a placeholder names no new command. Every deep command is one or
 * two words, so a line whose words run on past two is prose that starts with `deep`, not a usage line.
 */
export function listedCommands(text: string): string[][] {
  const seen = new Map<string, string[]>();
  for (const line of text.split('\n')) {
    const m = /^\s*(?:Usage:\s*)?deep\s+(.*)$/.exec(line);
    if (!m) continue;
    const synopsis = m[1]!.split(/\s{2,}/)[0]!.trim();
    const alts = alternatives(synopsis);
    const tokens0 = alts[0]!.split(/\s+/).filter(Boolean);
    const first: string[] = [];
    for (const t of tokens0) { if (!WORD.test(t)) break; first.push(t); }
    if (!first.length || first.length > 2) continue;
    const takesArgs = tokens0.length > first.length;
    const add = (words: string[]) => { if (words.length <= 2) seen.set(words.join(' '), words); };
    add(first);
    for (const alt of alts.slice(1)) {
      const words: string[] = [];
      for (const t of alt.split(/\s+/).filter(Boolean)) { if (!WORD.test(t)) break; words.push(t); }
      if (!words.length) continue;
      if (first.length >= 2) add([...first.slice(0, -1), ...words]);
      else if (takesArgs) add([...first, ...words]);
      else add(words);
    }
  }
  return [...seen.values()];
}
/** `deep --help`'s output, read once per file from a fresh world. */
let helpText: Promise<string> | undefined;
export function help(): Promise<string> {
  return (helpText ??= (async () => {
    needBuild();
    const r = await deep(world(), ['--help'], { timeoutMs: 60 * SECOND });
    if (r.code !== 0 || !r.stdout.includes('deep ')) throw Error(`BLOCKED: deep --help didn't print the commands to list: ${shown(r)}`);
    return r.stdout;
  })());
}

// ---- The table AC1 and AC2 run (README, The table).
/** The commands `deep --help` lists that call no hub, each with why it is left out of the table. */
export const NEEDS_NO_HUB: Readonly<Record<string, string>> = {
  setup: 'sets the home up and starts the hub (the owner\'s comment of Nov 10)',
  'hub start': 'starts the hub (the owner\'s comment; AC8 runs it)',
  'hub run': 'is the hub',
  kinds: 'needs no hub (the owner\'s comment)',
  export: 'draws one still headless, with no hub (the owner\'s comment)',
  explain: 'reads a recorded session folder (the owner\'s comment)',
  lease: 'runs its command as it is when no hub answers (the owner\'s comment)',
  doctor: 'reports the hub as one of its items; its exit is #19\'s and #1713\'s',
  'debug bundle': 'bundles the logs and the doctor\'s items, with no hub',
  update: 'asks the registry, never the hub (AC6 runs it)',
  run: 'is `deep run --result <file>`, which reads a run result file',
  mcp: 'is the MCP server an agent starts on stdio; it answers each call that the hub is unreachable (design: deep mcp)',
  read: 'reads the hub\'s root read-only, with or without the hub (#63)',
  find: 'reads the hub\'s root read-only, with or without the hub (#63; AC4 runs it)',
  open: 'asks the app over the app\'s own socket (#1460)',
  'gate rules': 'prints rulesets from your settings and never calls the hub (#1325)',
  join: 'reaches a project\'s hub on another machine, never yours (#1338)',
  restore: 'puts a backup back with the hub stopped',
  'secret add': 'reads the value at your terminal before it calls the hub; a run with no terminal stops there',
};
/** The commands that run setup's steps themselves in a home that isn't set up (#1002), as the owner's comment lists them. */
export const FIRST_RUN = ['status', 'inbox', 'secret', 'off', 'on', 'env', 'install', 'guard', 'memory'];
/** A handle's ID: a ULID, as the record's handles carry them. */
const ID = '01KAZ3Y8M5Q2W7E4R6T9P1N3B5';
/**
 * Every listed command that calls the hub, by its words, with arguments that reach that call at the merge base (each was
 * run there with the hub stopped and reached its socket), laid in `w`: a git checkout, a package folder whose
 * `deepbuild.json` reads, and a JSON file.
 */
export function hubForms(w: World): Map<string, string[]> {
  const checkout = repo(w);
  const pkg = join(w.tmp, 'pkg');
  mkdirSync(pkg);
  writeFileSync(join(pkg, 'deepbuild.json'), `${JSON.stringify({ id: 'dh1812.fixture', version: '0.0.1' })}\n`);
  const file = join(w.tmp, 'file.json');
  writeFileSync(file, '{}\n');
  return new Map(Object.entries({
    status: ['status'],
    off: ['off'],
    on: ['on'],
    'run follow': ['run', 'follow', `run:${ID}`],
    'host run': ['host', 'run', `ask:${ID}`],
    'host changes': ['host', 'changes', 'h1'],
    'host remove': ['host', 'remove', 'h1'],
    'host list': ['host', 'list'],
    'host facts': ['host', 'facts', 'h1'],
    'hub status': ['hub', 'status'],
    'hub stop': ['hub', 'stop'],
    'hub use': ['hub', 'use', '--root', join(w.tmp, 'devhub')],
    fix: ['fix', 'ACME-1'],
    land: ['land', '--repo', checkout],
    work: ['work', '--repo', checkout, '--issues', '1', '--once'],
    'workspace new': ['workspace', 'new', 'topic'],
    'workspace task': ['workspace', 'task', 'ws1', 'title', '--criterion', 'text'],
    'workspace move': ['workspace', 'move', 'ws1', pkg],
    'workspace revert': ['workspace', 'revert', 'ws1'],
    'workspace diff': ['workspace', 'diff', 'ws1'],
    'workspace drift': ['workspace', 'drift', 'ws1'],
    'env up': ['env', 'up'],
    'env down': ['env', 'down'],
    numbers: ['numbers'],
    'numbers refresh': ['numbers', 'refresh'],
    'numbers baseline': ['numbers', 'baseline', file],
    'numbers sample': ['numbers', 'sample', '2026-11-01'],
    show: ['show', '--doc', 'doc1', '--document', file],
    inbox: ['inbox'],
    'inbox answer': ['inbox', 'answer', `ask:${ID}`, 'allow'],
    'inbox undo': ['inbox', 'undo', `ask:${ID}`],
    'inbox save': ['inbox', 'save', `offer:${ID}`],
    race: ['race', '1'],
    'start approve': ['start', 'approve', '--repo', checkout, '--issues', '1', '--agents', 'claude-code', '--at-once', '1', '--plan-share', '10'],
    start: ['start', '--repo', checkout, '--issue', '1', '--agent', 'claude-code', '--prompt', 'go'],
    install: ['install', pkg],
    'guard add': ['guard', 'add', file],
    memory: ['memory'],
    'memory keep': ['memory', 'keep', `lesson:${ID}`],
    'memory remove': ['memory', 'remove', `lesson:${ID}`],
    'memory overrule': ['memory', 'overrule', `decision:${ID}`],
    'rules sync': ['rules', 'sync'],
    'rules reach': ['rules', 'reach', '--repo', checkout, '--scope', '**'],
    'rules credit': ['rules', 'credit', `rule:${ID}`],
    'session rules': ['session', 'rules', `session:${ID}`],
    undo: ['undo', `staged:${ID}`],
    'mcp-exec': ['mcp-exec', 'server1'],
    'secret list': ['secret', 'list'],
    'person invite': ['person', 'invite', 'login1', '--address', '127.0.0.1:9'],
    'person revoke': ['person', 'revoke', 'login1'],
    'library on': ['library', 'on', 'dh1812-library'],
    'library off': ['library', 'off', 'dh1812-library'],
    'library rule': ['library', 'rule', 'dh1812-library', 'MIT'],
    'pack rule': ['pack', 'rule', 'acme/pack', 'MIT'],
    'job rule': ['job', 'rule', 'tool@1.0.0', '5'],
    backup: ['backup', join(w.tmp, 'bk')],
  }));
}
/**
 * The table's rows: each command `deep --help` lists that calls the hub, with its arguments. A listed command the table
 * neither runs nor leaves out by name is BLOCKED: the table could not say it ran every command.
 */
export async function table(w: World): Promise<{ name: string; args: string[] }[]> {
  const forms = hubForms(w);
  const listed = listedCommands(await help()).map((words) => words.join(' '));
  const unknown = listed.filter((name) => !forms.has(name) && !Object.hasOwn(NEEDS_NO_HUB, name));
  if (unknown.length) throw Error(`BLOCKED: deep --help lists ${unknown.map((n) => `deep ${n}`).join(', ')}, which this table neither runs nor leaves out by name`);
  if (!listed.includes('inbox')) throw Error(`BLOCKED: deep --help doesn't list deep inbox: ${listed.join(', ')}`);
  return listed.filter((name) => forms.has(name)).map((name) => ({ name, args: forms.get(name)! }));
}

// ---- A hub that isn't answering: the one sentence (README, How each criterion is read: AC1 and AC2).
/** The names of the system's errors (ENOENT, ECONNREFUSED, ...), as Node lists them. */
const ERRNO = new RegExp(`\\b(?:${Object.keys(constants.errno).join('|')})\\b`);
/** The sentence: a line saying the hub isn't answering. */
const SENTENCE = /\bhub\b.*\b(?:isn't|isn’t|is not) answering\b/i;
/** Every absolute path in a text, as written: from a `/` after a space, a quote, a bracket, `=` or `:`. */
export function paths(text: string): string[] {
  return [...text.matchAll(/(?:^|[\s'"`(<[=:])(\/[^\s'"`()<>[\],;]+)/gm)].map((m) => m[1]!.replace(/[.:]+$/, '')).filter((p) => p.length > 1);
}
/**
 * What is wrong with a command's run against a home whose hub isn't answering, as one line naming the command, or
 * nothing: it exits 3; the first line of its output (stdout, then stderr) that says the hub isn't answering names
 * `fix`, and neither the other fix nor BLOCKED, a verdict's word; nothing it prints holds an errno or a path twice; and
 * in a home that isn't set up, nothing it prints names `deep hub start`.
 */
export function hubDownFailures(name: string, r: Ran, fix: 'deep hub start' | 'deep setup'): string[] {
  const out: string[] = [];
  const text = `${r.stdout}\n${r.stderr}`;
  const other = fix === 'deep setup' ? 'deep hub start' : 'deep setup';
  const sentence = text.split('\n').find((line) => SENTENCE.test(line));
  if (r.timedOut) out.push(`${name} was still running at the timeout`);
  if (r.code !== 3) out.push(`${name} exits ${r.code}, not 3`);
  if (!sentence) out.push(`${name} prints no line saying the hub isn't answering`);
  else {
    if (!sentence.includes(fix)) out.push(`${name}'s sentence doesn't name the fix, ${fix}: ${JSON.stringify(sentence.trim())}`);
    if (sentence.includes(other)) out.push(`${name}'s sentence names ${other}, not the one fix ${fix}: ${JSON.stringify(sentence.trim())}`);
    if (/\bBLOCKED\b/.test(sentence)) out.push(`${name}'s sentence holds BLOCKED, a verdict's word: ${JSON.stringify(sentence.trim())}`);
  }
  if (fix === 'deep setup' && text.includes('deep hub start')) out.push(`${name} names deep hub start in a home that isn't set up`);
  const errno = ERRNO.exec(text)?.[0];
  if (errno) out.push(`${name} prints an errno, ${errno}`);
  const seen = new Map<string, number>();
  for (const p of paths(text)) seen.set(p, (seen.get(p) ?? 0) + 1);
  const twice = [...seen].filter(([, n]) => n > 1).map(([p]) => p);
  if (twice.length) out.push(`${name} prints ${twice.map((p) => JSON.stringify(p)).join(', ')} twice`);
  return out.length ? [`${out.join('; ')}. It printed: ${shown(r)}`] : [];
}
