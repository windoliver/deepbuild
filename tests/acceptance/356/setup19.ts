// Shared test-side tools for issue #19's setup criteria (README): temp homes with stand-ins for launchd, systemctl,
// claude and your login shell; `deep setup` and `deep setup --undo` through the built CLI; Claude Code's user files
// and what DeepBuild put in them; the hub that setup's login service started, its socket and a forwarder that keeps
// its acknowledgements; the Claude Code stand-in (fixtures/claude.mjs); and snapshots of folders, byte for byte.
// Parts are adapted from tests/acceptance/18/install/helpers.ts (same repo, same license); this suite keeps its own
// copy so a redraft of theirs never moves these tests. Nothing here stands in for DeepBuild: every test reaches it
// through the CLI, deep-hook as the settings run it, the hub's socket and the files under the temporary home.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
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
export const tag = (n = 6) => randomBytes(n).toString('hex');
export const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

/** These tests stand in for launchd only (README: The login service); elsewhere they can't run, which is BLOCKED, never a pass. */
export function onMac(): void {
  if (process.platform !== 'darwin') throw Error(`BLOCKED: these tests stand in for launchd, the login service on macOS; on ${process.platform} setup would reach the real service manager`);
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh356-'));
  made.push(dir);
  return dir;
}
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts, so `~/.deepbuild`, `~/.claude`, `~/.claude.json`
 * and `~/Library/LaunchAgents` are under `<tmp>/h`. `<tmp>/bin` comes first on PATH with:
 * - `launchctl`, the launchd stand-in (fixtures/launchd.mjs), its state in `<tmp>/bin/launchd/`;
 * - `systemctl` and `claude`, which log their call to `<tmp>/bin/calls.log` and exit 0 (`claude --version` answers
 *   the newest version the facts cover);
 * - `sh-login`, your login shell (SHELL), whose PATH is `<tmp>/bin`, Node's folder and the system's;
 * - `deep`, the built CLI.
 * `<tmp>/confirm` holds `confirmed`: the OS confirmation stubbed through DEEP_HUB_TEST_CONFIRM (#24).
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
/** Every PID the launchd stand-in started for this home (README: The login service). */
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
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/**
 * `deep <args>` from the built CLI, HOME the test's home. It runs in `cwd` (the temp folder by default), never in
 * this checkout, so a setup that writes into the folder it runs in can't touch the repository under test.
 */
export function deep(home: string, args: readonly string[], o: { env?: Record<string, string | undefined>; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(home, o.env), cwd: o.cwd ?? dirname(home), timeoutMs: o.timeoutMs ?? 180_000 });
}

// ---- deep-hook: setup names the built binary its entries run (#18's setup takes the newer of target/{release,debug}).
let build: Promise<void> | undefined;
export function cargoBuild(): Promise<void> {
  build ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, timeoutMs: 1_200_000 }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
  });
  return build;
}

/**
 * `deep setup`, HOME the test's home, with no hub running beforehand: setup starts it through its login service
 * (the launchd stand-in). Resolves with the run whatever it exits; `setup` below insists on exit 0.
 */
export async function runSetup(home: string, o: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<Ran> {
  await cargoBuild();
  return deep(home, ['setup'], o);
}
export async function setup(home: string, o: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<Ran> {
  const r = await runSetup(home, o);
  if (r.code !== 0) expect.fail(`deep setup must exit 0 and install DeepBuild: ${shown(r)}`);
  return r;
}
/** `deep setup --undo`, the OS confirmation stubbed `confirmed` (README: The OS confirmation). */
export function undo(home: string, o: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<Ran> {
  return deep(home, ['setup', '--undo'], o);
}

// ---- Claude Code's user files and DeepBuild's entries in them (README: What DeepBuild adds).
export function readSettings(home: string): Line {
  const text = readFileSync(settingsFile(home), 'utf8');
  const parsed = parseObject(text);
  if (!parsed) expect.fail(`${settingsFile(home)} is no longer a JSON object: ${text.slice(0, 500)}`);
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
/** The status line forwarder: a statusLine whose command is DeepBuild's and names `statusline` (#159's `deep-hook statusline`). */
export const forwarderInstalled = (settings: Line): boolean => isDeepBuild(settings.statusLine?.command) && /statusline/.test(String(settings.statusLine?.command));

/** DeepBuild's MCP servers in ~/.claude.json's user scope: an entry whose command line runs `deep mcp`. */
export function deepMcpServers(home: string): string[] {
  const config = existsSync(userConfig(home)) ? parseObject(readFileSync(userConfig(home), 'utf8')) : undefined;
  const servers = (config?.mcpServers ?? {}) as Record<string, Line>;
  return Object.entries(servers).filter(([, s]) => {
    const line = [s?.command, ...(Array.isArray(s?.args) ? s.args : [])].map(String).join(' ');
    return isDeepBuild(line) && /(^|\s)['"]?mcp['"]?(\s|$)/.test(line);
  }).map(([name]) => name);
}
/** The names `claude mcp add` (or `add-json`) registered through the claude stand-in, and those `claude mcp remove` removed after. */
export function mcpCalls(home: string): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const raw of callsLog(home).split('\n')) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (words[0] !== 'claude' || words[1] !== 'mcp') continue;
    const sub = words[2];
    const rest = words.slice(3);
    const name = (() => {
      for (let i = 0; i < rest.length; i++) {
        const w = rest[i]!;
        if (w === '--') return undefined;
        if (/^-(s|t|e|H)$|^--(scope|transport|env|header)$/.test(w)) { i++; continue; }
        if (w.startsWith('-')) continue;
        return w;
      }
      return undefined;
    })();
    if (!name) continue;
    if ((sub === 'add' || sub === 'add-json') && /(deep|main\.js)/.test(raw) && /\bmcp\b/.test(rest.join(' '))) added.push(name);
    if (sub === 'remove') removed.push(name);
  }
  return { added, removed };
}
/** DeepBuild's skill: a folder under ~/.claude/skills whose SKILL.md is named deepbuild or is the checkout's own skill. */
export function deepSkills(home: string): string[] {
  const dir = skillsDir(home);
  if (!existsSync(dir)) return [];
  const ours = readFileSync(join(REPO, 'skills/deepbuild/SKILL.md'), 'utf8');
  return readdirSync(dir).filter((name) => {
    const file = join(dir, name, 'SKILL.md');
    if (!existsSync(file)) return false;
    const text = readFileSync(file, 'utf8');
    return text === ours || /^name:\s*deepbuild\b/m.test(text);
  }).map((name) => join(dir, name));
}

// ---- The login service: a plist in ~/Library/LaunchAgents whose program runs `hub run`, and the launchd stand-in's state.
export interface Job { label: string; plist: string; pid: number | null; program: string[] }
export function launchdState(home: string): Job[] {
  const out = execFileSync(NODE, [join(FIXTURES, 'launchd.mjs'), join(binOf(home), 'launchd'), '__state'], { encoding: 'utf8' });
  const jobs = JSON.parse(out) as Job[];
  for (const j of jobs) own(j.pid);
  return jobs;
}
/** A logout and a new login, as launchd runs them: every job stopped, then every plist in ~/Library/LaunchAgents loaded. */
export function relogin(home: string): string[] {
  const out = execFileSync(NODE, [join(FIXTURES, 'launchd.mjs'), join(binOf(home), 'launchd'), '__relogin', agentsDir(home)], { encoding: 'utf8', env: childEnv(home) });
  for (const pid of launchedPids(home)) own(pid);
  return JSON.parse(out) as string[];
}
const runsHub = (program: string[]) => { const at = program.indexOf('hub'); return at >= 0 && program[at + 1] === 'run' && isDeepBuild(program.join(' ')); };
/** The hub's login service definitions: each plist in ~/Library/LaunchAgents whose ProgramArguments run `hub run`. */
export function hubPlists(home: string): { file: string; label: string }[] {
  const dir = agentsDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.plist')).flatMap((name) => {
    const text = readFileSync(join(dir, name), 'utf8');
    const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1] ?? '';
    const program = [...args.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]!);
    const label = /<key>Label<\/key>\s*<string>([\s\S]*?)<\/string>/.exec(text)?.[1] ?? name;
    return runsHub(program) ? [{ file: join(dir, name), label }] : [];
  });
}
export const hubJobs = (home: string): Job[] => launchdState(home).filter((j) => runsHub(j.program));

// ---- The hub as setup's login service started it, and its socket (#16's line protocol, a cli connection with the token).
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
/** Waits for the hub the login service started to answer; fails naming what setup left otherwise. */
export async function installedHub(home: string, timeoutMs = 30_000): Promise<{ pid: number | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await answers(socketOf(home))) return { pid: hubJobs(home)[0]?.pid ?? null };
    await sleep(200);
  }
  expect.fail(`deep setup must start the hub through its login service: no hub answers at ${socketOf(home)}; login service definitions ${JSON.stringify(hubPlists(home))}, launchd ${JSON.stringify(launchdState(home))}, calls ${JSON.stringify(callsLog(home).slice(-1500))}`);
}
export class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private wakers = new Set<() => void>();
  private ids = 0;
  ended = false;
  private constructor(readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        this.lines.push(parseObject(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) });
        this.buffer = this.buffer.slice(i + 1);
      }
      for (const w of [...this.wakers]) w();
    });
    sock.on('error', () => { this.ended = true; for (const w of [...this.wakers]) w(); });
    sock.on('close', () => { this.ended = true; for (const w of [...this.wakers]) w(); });
  }
  static open(path: string, timeoutMs = 5000): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const conn = new Conn(net.connect(path));
      const timer = setTimeout(() => { conn.sock.destroy(); reject(Error(`no hello from the hub at ${path}`)); }, timeoutMs);
      const check = () => {
        if (conn.lines.length > 0) { clearTimeout(timer); conn.wakers.delete(check); resolve(conn); }
        else if (conn.ended) { clearTimeout(timer); conn.wakers.delete(check); reject(Error(`can't reach the hub at ${path}`)); }
      };
      conn.wakers.add(check);
    });
  }
  private wait(match: (line: Line) => boolean, from: number, timeoutMs: number): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const done = (v: Line | undefined) => { clearTimeout(timer); this.wakers.delete(check); resolve(v); };
      const check = () => { const found = this.lines.slice(from).find(match); if (found) done(found); else if (this.ended) done(undefined); };
      const timer = setTimeout(() => done(undefined), timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  async hello(token: string, role: 'cli' | 'app' = 'cli'): Promise<void> {
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, hello: role, token })}\n`);
    const reply = await this.wait((l) => 'role' in l || 'error' in l, from, 10_000);
    if (!reply || reply.role !== role) throw Error(`BLOCKED: the hub refused the ${role} hello: ${JSON.stringify(reply)}`);
  }
  async call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await this.wait((l) => l.id === id && ('result' in l || 'error' in l), from, timeoutMs);
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  close(): void { this.sock.destroy(); }
}
export async function control<T>(home: string, use: (conn: Conn) => Promise<T>, role: 'cli' | 'app' = 'cli'): Promise<T> {
  const conn = await Conn.open(socketOf(home));
  try {
    await conn.hello(readFileSync(join(rootOf(home), 'control.token'), 'utf8').trim(), role);
    return await use(conn);
  } finally {
    conn.close();
  }
}
/** Every event ID in the hub's log, paged through `events.read`. */
export function eventIds(home: string): Promise<string[]> {
  return control(home, async (conn) => {
    const out: string[] = [];
    let after = 0;
    for (;;) {
      const events = (await conn.call('events.read', { after, limit: 1000 })).events as { id: string; log_pos: number }[];
      if (!events.length) return out;
      out.push(...events.map((e) => e.id));
      after = events[events.length - 1]!.log_pos;
    }
  });
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

// ---- A forwarded socket at the address setting that keeps every byte both ways (#16's address setting, #18's forwarder).
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

// ---- Repositories and snapshots.
/** A git repository at `dir` with one commit; returns its SHA. */
export function gitRepo(home: string, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env: childEnv(home), encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  return git('rev-parse', 'HEAD');
}
/**
 * Every entry under `dir` as one comparable line each: its type, and a file's SHA-256 and mode, a link's target.
 * `times` adds each entry's modification time in nanoseconds, the folder's own included as `.`, so a write of the
 * same bytes, or a file made and removed, shows too. `keep` decides which paths (relative to `dir`) count, and
 * `enter` which folders are walked (by default, those that count).
 */
export function snapshot(dir: string, o: { times?: boolean; keep?: (rel: string) => boolean; enter?: (rel: string) => boolean } = {}): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  const keep = o.keep ?? (() => true);
  const enter = o.enter ?? keep;
  if (o.times) out.set('.', `dir mtime ${lstatSync(dir, { bigint: true }).mtimeNs}`);
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const rel = relative(dir, path);
      const s = lstatSync(path, { bigint: true });
      const time = o.times ? ` mtime ${s.mtimeNs}` : '';
      if (keep(rel)) {
        if (s.isSymbolicLink()) out.set(rel, `link -> ${readlinkSync(path)}${time}`);
        else if (s.isDirectory()) out.set(rel, `dir${time}`);
        else out.set(rel, `file ${sha(readFileSync(path))} mode ${(Number(s.mode) & 0o7777).toString(8)}${time}`);
      }
      if (s.isDirectory() && !s.isSymbolicLink() && enter(rel)) walk(path);
    }
  };
  walk(dir);
  return out;
}
/** What differs between two snapshots, one line per path. */
export function changes(before: Map<string, string>, after: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [path, was] of before) {
    const now = after.get(path);
    if (now === undefined) out.push(`${path} removed (was ${was})`);
    else if (now !== was) out.push(`${path} changed (was ${was}, now ${now})`);
  }
  for (const [path, now] of after) if (!before.has(path)) out.push(`${path} added (${now})`);
  return out;
}
/** Every file under `dir` whose bytes are `bytes`, other than `except`. */
export function copiesOf(dir: string, bytes: Buffer, except: string): string[] {
  const want = sha(bytes);
  const out: string[] = [];
  const walk = (at: string) => {
    let names: string[] = [];
    try { names = readdirSync(at); } catch { return; }
    for (const name of names) {
      const path = join(at, name);
      let s;
      try { s = lstatSync(path); } catch { continue; }
      if (s.isDirectory()) walk(path);
      else if (s.isFile() && path !== except && s.size === bytes.length && sha(readFileSync(path)) === want) out.push(path);
    }
  };
  walk(dir);
  return out;
}
export const inode = (path: string) => statSync(path).ino;

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
  static start(home: string, env: Record<string, string | undefined> = {}): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), CLI, FACTS], { cwd: dirname(home), env: childEnv(home, env), stdio: ['pipe', 'pipe', 'inherit'] });
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
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-19-setup', version: '0' } });
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

// ---- Your own files, as a person who used Claude Code before DeepBuild has them (README: Your files).
/**
 * Your Claude Code user settings, written by hand: tabs, spaces before a colon, a \u escape, keys in your order and
 * no newline at the end, so only the original bytes put back read the same. Your status line, your hooks.
 */
export const MY_STATUS_LINE = { type: 'command', command: '/bin/echo my-status', padding: 0 };
export const MY_SETTINGS = String.raw`{
	"$schema": "https://json.schemastore.org/claude-code-settings.json",
	"model" : "opus",
	"statusLine": {"type": "command", "command": "/bin/echo my-status", "padding": 0},
	"permissions": { "allow": ["Bash(npm test:*)"], "deny": ["Read(./.env)"] },
	"env": {"MY_FLAG": "1", "GREETING": "café"},
	"hooks": {
		"Stop": [ { "hooks": [ { "type": "command", "command": "/bin/echo my-stop" } ] } ],
		"PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "/bin/echo my-guard", "timeout": 10 } ] } ]
	}
}`;
/** Your ~/.claude.json, Claude Code's own state with your MCP server, also by hand. */
export const MY_CLAUDE_JSON = `{"numStartups": 12, "theme": "dark",
 "mcpServers": {"notes": {"type": "stdio", "command": "/usr/bin/true", "args": ["--notes"]}},
 "projects": {"/tmp/elsewhere": {"allowedTools": [], "hasTrustDialogAccepted": true}}
}
`;
export const MY_SKILL = '---\nname: mine\ndescription: My own skill.\n---\n\nDo it my way.\n';
export const MY_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.example.mine</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/true</string>
  </array>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
/** Writes your files into the home; returns the paths, each with its bytes. */
export function seedYours(home: string): Map<string, Buffer> {
  const files: [string, string][] = [
    [settingsFile(home), MY_SETTINGS],
    [userConfig(home), MY_CLAUDE_JSON],
    [join(skillsDir(home), 'mine', 'SKILL.md'), MY_SKILL],
    [join(agentsDir(home), 'com.example.mine.plist'), MY_PLIST],
  ];
  for (const [path, text] of files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return new Map(files.map(([path, text]) => [path, Buffer.from(text)]));
}
/** Where two byte strings first differ, with a little of each around it. */
export function firstDifference(was: Buffer, now: Buffer): string {
  let i = 0;
  while (i < was.length && i < now.length && was[i] === now[i]) i++;
  const around = (b: Buffer) => JSON.stringify(b.subarray(Math.max(0, i - 40), i + 80).toString('utf8'));
  return `${was.length} bytes before, ${now.length} now; first difference at byte ${i}: was ${around(was)}, now ${around(now)}`;
}
