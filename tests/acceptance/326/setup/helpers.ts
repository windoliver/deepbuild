// Shared test-side tools for issue #326's "setup" criterion (README): temp homes with stand-ins for launchd,
// systemctl, claude and your login shell; the app's Set up click (`deep-app --set-up`), the first `deep` command and
// `deep setup` through the built binaries; what DeepBuild put in Claude Code's user files; the hub that the login
// service started, its socket and a forwarder that keeps its acknowledgements; and the Claude Code stand-in
// (fixtures/claude.mjs). Adapted from tests/acceptance/19/setup/helpers.ts (same repo, same license); this suite keeps
// its own copy so a redraft of #19's never moves these tests. Nothing here stands in for DeepBuild: every test reaches
// it through the app binary, the CLI, deep-hook as the settings run it, the hub's socket and the files under the
// temporary home.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
/** The app as `cargo build -p deep-app` builds it from the checkout (R1: "built from the checkout"). */
export const APP = join(REPO, 'target/debug/deep-app');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const TWINS = fileURLToPath(new URL('./twins/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const NODE = process.execPath;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });
export const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

/** These tests stand in for launchd only; elsewhere they can't run, which is BLOCKED, never a pass. */
export function onMac(): void {
  if (process.platform !== 'darwin') throw Error(`BLOCKED: these tests stand in for launchd, the login service on macOS; on ${process.platform} setup would reach the real service manager`);
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/da326s-'));
  made.push(dir);
  return dir;
}
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts, so `~/.deepbuild`, `~/.claude`, `~/.claude.json`
 * and `~/Library/LaunchAgents` are under `<tmp>/h`, and nothing of DeepBuild is installed there yet: a first launch.
 * `<tmp>/bin` comes first on PATH with:
 * - `launchctl`, the launchd stand-in (fixtures/launchd.mjs), its state in `<tmp>/bin/launchd/`;
 * - `systemctl` and `claude`, which log their call to `<tmp>/bin/calls.log` and exit 0;
 * - `sh-login`, your login shell (SHELL), whose PATH is `<tmp>/bin`, Node's folder and the system's;
 * - `deep`, the built CLI.
 * `<tmp>/confirm` holds `confirmed`: the OS confirmation stubbed through DEEP_HUB_TEST_CONFIRM (#24), never asked here.
 */
export interface Home { tmp: string; home: string; bin: string }
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin);
  for (const name of ['systemctl', 'claude']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  const script = (name: string, text: string) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  script('launchctl', `#!/bin/sh\nprintf 'launchctl %s\\n' "$*" >> '${bin}/calls.log'\nexec '${NODE}' '${join(FIXTURES, 'launchd.mjs')}' '${join(bin, 'launchd')}' "$@"\n`);
  script('deep', `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  script('sh-login', [
    '#!/bin/sh',
    '# Your login shell, as setup reads it: the PATH a login shell sets is this one. Login and interactive flags are',
    '# dropped, so no profile of the machine running the tests is read.',
    `PATH='${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
    '',
  ].join('\n'));
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  homes.push({ tmp, home, bin });
  return { tmp, home, bin };
}
const homes: Home[] = [];
export const rootOf = (home: string) => join(home, '.deepbuild');
export const settingsFile = (home: string) => join(home, '.claude', 'settings.json');
export const userConfig = (home: string) => join(home, '.claude.json');
export const skillsDir = (home: string) => join(home, '.claude', 'skills');
export const agentsDir = (home: string) => join(home, 'Library', 'LaunchAgents');
export const binOf = (home: string) => join(dirname(home), 'bin');
export const callsLog = (home: string) => { const f = join(binOf(home), 'calls.log'); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };

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
/** Every PID the launchd stand-in started for this home. */
function launchedPids(home: string): number[] {
  const file = join(binOf(home), 'launchd', 'started.pids');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').map(Number).filter((n) => n > 0) : [];
}
/** Stops every process this suite started, the launchd stand-in's jobs included (SIGTERM, then SIGKILL after 3 s), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const h of homes.splice(0)) for (const pid of launchedPids(h.home)) own(pid);
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) {
    if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, no DEEP_, CLAUDE*, CODEX*, GIT_ or billing variable of this process's. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.SHELL = join(binOf(home), 'sh-login');
  env.PATH = `${binOf(home)}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.LC_ALL = 'C';
  env.DEEP_HUB_TEST_CONFIRM = join(dirname(home), 'confirm');
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? '/tmp', env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('error', (error) => { stderr += `\n[spawn failed: ${error.message}]`; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/** `deep <args>` from the built CLI, HOME the test's home, in `cwd` (the temp folder by default), never in this checkout. */
export function deep(home: string, args: readonly string[], o: { env?: Record<string, string | undefined>; cwd?: string | undefined; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(home, o.env), cwd: o.cwd ?? dirname(home), timeoutMs: o.timeoutMs ?? 180_000 });
}

// ---- Builds: setup's entries run the built deep-hook (#18), and the click is the built app's.
const builds = new Map<string, Promise<void>>();
function cargoBuild(...args: string[]): Promise<void> {
  const key = args.join(' ');
  let build = builds.get(key);
  if (!build) {
    build = run('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, timeoutMs: 1_800_000 }).then((r) => {
      if (r.code !== 0) throw Error(`BLOCKED: cargo build ${key} failed: ${r.stderr.slice(-3000)}`);
    });
    builds.set(key, build);
  }
  return build;
}
export const buildHook = () => cargoBuild('-p', 'deep-hook');
export const buildApp = () => cargoBuild('-p', 'deep-app', '--bin', 'deep-app');

// ---- The three ways in that must leave the same state (README: The surface).
/**
 * The Set up click, headless: `deep-app --set-up`, the action the first launch's one Set up button runs (README: The
 * surface). It runs in the temp folder, as an app opened from the Dock runs outside every repo. `app` replaces the
 * built app with a planted twin (twins/), which the twin tests use to show each check fails on a wrong program.
 */
export async function click(home: string, o: { app?: string | undefined; env?: Record<string, string | undefined> } = {}): Promise<Ran> {
  await buildHook();
  if (!o.app) await buildApp();
  return run(o.app ?? APP, ['--set-up'], { env: childEnv(home, o.env), cwd: dirname(home), timeoutMs: 180_000 });
}
/**
 * The first `deep` command in a home where nothing is set up: `deep status`, run in `cwd`. `deepBin` replaces the
 * CLI with a planted twin of it.
 */
export async function firstCommand(home: string, o: { cwd?: string | undefined; deepBin?: string | undefined; args?: string[] } = {}): Promise<Ran> {
  await buildHook();
  const args = o.args ?? ['status'];
  if (o.deepBin) return run(o.deepBin, args, { env: childEnv(home), cwd: o.cwd ?? dirname(home), timeoutMs: 180_000 });
  return deep(home, args, { cwd: o.cwd });
}
/** `deep setup`, #19's merged surface: the reference the click and the first command must match. */
export async function deepSetup(home: string, o: { cwd?: string } = {}): Promise<Ran> {
  await buildHook();
  return deep(home, ['setup'], { cwd: o.cwd });
}

/** The lines of `text` that hold anything. */
export const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);
/**
 * "Says so in one line" (Scope; design, How it installs: "It tells you in one line what it added and how to remove
 * it"): exactly one non-empty line, which names the hooks, watch-only, the hub and `deep setup --undo`. Fails naming
 * `who` and what was said.
 */
export function oneLine(who: string, text: string): string {
  const said = lines(text);
  if (said.length !== 1) expect.fail(`${who} must say what it did in one line; it said ${said.length} lines: ${JSON.stringify(text.slice(0, 1500))}`);
  const line = said[0]!;
  for (const [what, pattern] of [['the hooks', /hook/i], ['watch-only mode', /watch[- ]only/i], ['the hub', /\bhub\b/i], ['how to remove it (deep setup --undo)', /deep setup --undo/]] as const) {
    if (!pattern.test(line)) expect.fail(`${who}'s one line must say ${what}: ${JSON.stringify(line)}`);
  }
  return line;
}

// ---- Claude Code's user files and DeepBuild's entries in them.
export function readSettings(home: string): Line {
  if (!existsSync(settingsFile(home))) expect.fail(`no ${settingsFile(home)}: nothing added the hooks`);
  const text = readFileSync(settingsFile(home), 'utf8');
  const parsed = parseObject(text);
  if (!parsed) expect.fail(`${settingsFile(home)} is not a JSON object: ${text.slice(0, 500)}`);
  return parsed;
}
/** Whether a command is DeepBuild's: it runs deep-hook, or the deep CLI (by its built file or as `deep`). */
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(['"]?)(\s|$)/.test(command));
export interface Entry { event: string; group: number; index: number; matcher: unknown; hook: Line }
export function entries(settings: Line): Entry[] {
  const hooks = (settings.hooks ?? {}) as Record<string, Line[]>;
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((group, g) =>
    (Array.isArray(group?.hooks) ? group.hooks : []).map((hook: Line, index: number) => ({ event, group: g, index, matcher: group.matcher, hook }))));
}
export const deepEntries = (settings: Line): Entry[] => entries(settings).filter((e) => isDeepBuild(e.hook.command));

/** DeepBuild's MCP servers in ~/.claude.json's user scope: an entry whose command line runs `deep mcp`. */
export function deepMcpServers(home: string): [string, Line][] {
  const config = existsSync(userConfig(home)) ? parseObject(readFileSync(userConfig(home), 'utf8')) : undefined;
  const servers = (config?.mcpServers ?? {}) as Record<string, Line>;
  return Object.entries(servers).filter(([, s]) => {
    const line = [s?.command, ...(Array.isArray(s?.args) ? s.args : [])].map(String).join(' ');
    return isDeepBuild(line) && /(^|\s)['"]?mcp['"]?(\s|$)/.test(line);
  });
}

// ---- The login service: a plist in ~/Library/LaunchAgents whose program runs `hub run`, and the launchd stand-in's state.
export interface Job { label: string; plist: string; pid: number | null; program: string[] }
export function launchdState(home: string): Job[] {
  const out = execFileSync(NODE, [join(FIXTURES, 'launchd.mjs'), join(binOf(home), 'launchd'), '__state'], { encoding: 'utf8' });
  const jobs = JSON.parse(out) as Job[];
  for (const j of jobs) own(j.pid);
  return jobs;
}
const runsHub = (program: string[]) => { const at = program.indexOf('hub'); return at >= 0 && program[at + 1] === 'run' && isDeepBuild(program.join(' ')); };
/** The hub's login service definitions: each plist in ~/Library/LaunchAgents whose ProgramArguments run `hub run`. */
export function hubPlists(home: string): { file: string; label: string; program: string[] }[] {
  const dir = agentsDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.plist')).flatMap((name) => {
    const text = readFileSync(join(dir, name), 'utf8');
    const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1] ?? '';
    const program = [...args.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]!);
    const label = /<key>Label<\/key>\s*<string>([\s\S]*?)<\/string>/.exec(text)?.[1] ?? name;
    return runsHub(program) ? [{ file: join(dir, name), label, program }] : [];
  });
}
export const hubJobs = (home: string): Job[] => launchdState(home).filter((j) => runsHub(j.program));

// ---- The hub as the login service started it, and its socket (#16's line protocol).
export const socketOf = (home: string) => join(rootOf(home), 'hub.sock');
/** Whether a hub answers with its hello at the socket within `timeoutMs`. */
export function answers(path: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(path);
    const done = (v: boolean) => { clearTimeout(timer); sock.destroy(); resolve(v); };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => { if (d.includes('\n')) done(true); });
    sock.on('error', () => done(false));
  });
}
/** Waits for the hub the login service started to answer; fails naming `who` and what it left otherwise. */
export async function installedHub(home: string, who: string, timeoutMs = 30_000): Promise<{ pid: number | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await answers(socketOf(home))) return { pid: hubJobs(home)[0]?.pid ?? null };
    await sleep(200);
  }
  expect.fail(`${who} must start the hub through its login service: no hub answers at ${socketOf(home)} ${timeoutMs / 1000} s after it; login service definitions ${JSON.stringify(hubPlists(home))}, launchd ${JSON.stringify(launchdState(home))}, calls ${JSON.stringify(callsLog(home).slice(-1500))}`);
}
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(200);
  }
}

// ---- A forwarded socket at the address setting that keeps every byte both ways (#16's address setting).
export interface Forwarder { path: string; upText(): string; downText(): string; close(): Promise<void> }
export function forwarder(dir: string, target: string): Promise<Forwarder> {
  const path = join(dir, `fwd-${randomBytes(3).toString('hex')}.sock`);
  const up: Buffer[] = [];
  const down: Buffer[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(target);
    sockets.add(client); sockets.add(upstream);
    client.on('data', (d: Buffer) => up.push(d));
    upstream.on('data', (d: Buffer) => down.push(d));
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.end());
    upstream.on('close', () => client.end());
  });
  const f: Forwarder = {
    path,
    upText: () => Buffer.concat(up).toString('utf8'),
    downText: () => Buffer.concat(down).toString('utf8'),
    close: () => new Promise((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, () => resolve(f)); });
}
/** The address setting `{"hub": {"address": "unix:<path>"}}` in ~/.deepbuild/config.json (#16), its other keys kept. */
export function setAddress(home: string, path: string): void {
  const file = join(rootOf(home), 'config.json');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const config = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? {}) : {};
  config.hub = { ...(config.hub as Line | undefined), address: `unix:${path}` };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

// ---- Repositories.
/** A git repository at `dir` with one commit; returns its SHA. */
export function gitRepo(home: string, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env: childEnv(home), encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  return git('rev-parse', 'HEAD');
}
/** A repo `shop` whose `.deepbuild/done.yaml` was drafted (its one check fails) and that nobody approved. */
export function draftedRepo(home: string): { repo: string; commit: string } {
  const repo = join(dirname(home), 'shop');
  mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  writeFileSync(join(repo, '.deepbuild', 'done.yaml'), '# Drafted for you; not approved yet.\nchecks:\n  unit:\n    run: exit 1\n');
  writeFileSync(join(repo, 'app.js'), 'export const header = "blue";\n');
  return { repo, commit: gitRepo(home, repo) };
}

// ---- The state a way in leaves, comparable across homes (README: "The same state").
/** The files setup writes, each with its text ('' when absent): a later command that sets up again changes one. */
export const written = (home: string): Record<string, string> => Object.fromEntries(
  [settingsFile(home), userConfig(home), join(rootOf(home), 'rules.json'), join(rootOf(home), 'config.json')]
    .map((f) => [f, existsSync(f) ? readFileSync(f, 'utf8') : '']));
/**
 * After setup, another `deep` command sets nothing up again: it says nothing about setup on stderr (`line`, the
 * setup's own line, or any line naming watch-only or the undo) and leaves every file setup writes as it was.
 */
export function setsNothingUpAgain(who: string, ran: Ran, before: Record<string, string>, after: Record<string, string>, line?: string): void {
  if (lines(ran.stderr).some((l) => l === line || /watch[- ]only|deep setup --undo/i.test(l))) {
    expect.fail(`#326 only the first deep command sets DeepBuild up: ${who} said so again: ${JSON.stringify(ran.stderr.slice(0, 1000))}`);
  }
  const changed = Object.keys(before).filter((f) => before[f] !== after[f]);
  if (changed.length) expect.fail(`#326 only the first deep command sets DeepBuild up: ${who} wrote ${changed.join(', ')} again`);
}
/** Every file under `dir`, relative, with its SHA-256. */
function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(dir, path)] = sha(readFileSync(path));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}
/**
 * What setup installs, with the home's temp folder written `<tmp>` so two homes compare: the settings it drafts in
 * ~/.deepbuild/config.json, DeepBuild's hook entries in ~/.claude/settings.json (event, matcher and the entry), its
 * status line, its MCP servers in ~/.claude.json, the guard entries in ~/.deepbuild/rules.json, the hub's login
 * service (label and program) and DeepBuild's skill files.
 */
export function installedState(home: string): Line {
  const tmp = dirname(home);
  const norm = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null).split(tmp).join('<tmp>'));
  const settings = existsSync(settingsFile(home)) ? parseObject(readFileSync(settingsFile(home), 'utf8')) ?? {} : {};
  const skill = existsSync(skillsDir(home)) ? readdirSync(skillsDir(home)).filter((n) => {
    const f = join(skillsDir(home), n, 'SKILL.md');
    return existsSync(f) && /^name:\s*deepbuild\b/m.test(readFileSync(f, 'utf8'));
  }) : [];
  const rules = join(rootOf(home), 'rules.json');
  const config = join(rootOf(home), 'config.json');
  return {
    config: existsSync(config) ? norm(parseObject(readFileSync(config, 'utf8')) ?? 'unreadable') : null,
    hooks: norm(deepEntries(settings).map((e) => ({ event: e.event, matcher: e.matcher ?? null, hook: e.hook }))),
    statusLine: norm(isDeepBuild(settings.statusLine?.command) ? settings.statusLine : null),
    mcp: norm(deepMcpServers(home)),
    rules: existsSync(rules) ? norm(parseObject(readFileSync(rules, 'utf8')) ?? 'unreadable') : null,
    service: norm(hubPlists(home).map((p) => ({ label: p.label, program: p.program }))),
    skill: skill.map((n) => ({ name: n, files: files(join(skillsDir(home), n)) })),
  };
}

// ---- Sessions and their hook payloads, shaped like the corpus's Claude Code payloads (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
export function newSession(home: string, cwd: string): Session {
  const id = randomUUID();
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
export const callId = () => `toolu_${randomBytes(12).toString('hex')}`;
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt) base.prompt_id = s.prompt;
  switch (event) {
    case 'SessionStart': Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); delete base.prompt_id; break;
    case 'Stop': Object.assign(base, { stop_hook_active: false, last_assistant_message: 'Done.' }); break;
    default: break;
  }
  return { ...base, ...extra };
}
export function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
/** The transcript entry Claude Code writes for a prompt you typed; the hooks of its turn carry its prompt ID. */
export function typedPrompt(s: Session, text: string): void {
  const promptId = randomUUID();
  s.prompt = promptId;
  appendTranscript(s, { type: 'user', promptId, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
}
/** An assistant tool call in the transcript, as Claude Code writes it before the call's PreToolUse. */
export function toolCall(s: Session, id: string, name: string, input: Line): void {
  appendTranscript(s, { type: 'assistant', message: { role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id, name, input }] } });
}

// ---- The Claude Code stand-in (fixtures/claude.mjs, #18's): one process per session.
export interface HookRun { command: string; async: boolean; asyncRewake: boolean; timeout: number; pid: number; started: number; ended: number | null; code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; expired: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; settingsError?: string }
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private rpc = 0;
  private constructor(private readonly child: ChildProcess, readonly home: string) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
    });
  }
  static start(home: string): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), CLI, FACTS], { cwd: dirname(home), env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Claude(child, home);
  }
  private send(command: Line, timeoutMs = 900_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the Claude Code stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the Claude Code stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** Fires one hook: every entry of the user settings file for it, as Claude Code runs them. */
  async hook(event: string, body: Line): Promise<Fired> {
    return (await this.send({ op: 'hook', event, payload: body, settings: settingsFile(this.home) })) as unknown as Fired;
  }
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const id = `${method}#${++this.rpc}`;
    const r = await this.send({ op: 'mcp', line: { jsonrpc: '2.0', id, method, params }, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    await this.send({ op: 'mcp', line: { jsonrpc: '2.0', method, params } });
  }
  async initialize(): Promise<void> {
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-326-setup', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.notify('notifications/initialized');
  }
  /** A deep_* tool call as Claude Code makes it: its PreToolUse (`mcp__deep__<tool>`), then the call. */
  async deepTool(s: Session, tool: string, args: Line, timeoutMs = 120_000): Promise<Line> {
    await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args, tool_use_id: callId() }));
    return this.request('tools/call', { name: tool, arguments: args }, timeoutMs);
  }
}
/** The runs of DeepBuild's entries among a hook's. */
export const ours = (f: Fired): HookRun[] => [...f.ran, ...f.background].filter((r) => isDeepBuild(r.command));
export const firedShown = (f: Fired) => JSON.stringify([...f.ran, ...f.background].map((r) => ({ command: r.command.slice(0, 160), code: r.code, signal: r.signal, timedOut: r.timedOut, stdout: r.stdout.slice(0, 400), stderr: r.stderr.slice(0, 400) })));
/** Whether DeepBuild's PreToolUse entry denied the call: exit 2, or a deny in its JSON (Claude Code reads either). */
export const denied = (f: Fired): boolean => ours(f).filter((r) => !r.async).some((r) => r.code === 2 || /"permissionDecision"\s*:\s*"deny"/.test(r.stdout) || /"decision"\s*:\s*"block"/.test(r.stdout));
