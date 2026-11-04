// Shared test-side tools for issue #1202's criteria (README): a copy of this checkout whose deep-hook a test may remove,
// temp homes with the service manager stubbed, `deep setup`/`deep doctor` through the copy's built CLI, Claude Code's
// user settings and the entries setup wrote in them, the hub as a process with its socket's line protocol, the stepped
// clock, deep-hook's spool, the process table, and the Claude Code stand-in (fixtures/claude.mjs). Parts are adapted
// from tests/acceptance/993/helpers.ts and tests/acceptance/18/install/helpers.ts (same repo, same license); this suite
// keeps its own copy so a redraft of those never moves these tests. Nothing here stands in for DeepBuild.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const MINUTE = 60_000;
/** The hub's hook-program check interval (#993): every 10 minutes on the hub's clock. */
export const CHECK_INTERVAL_MS = 10 * MINUTE;
/** The Claude Code version the issue names, the newest the facts cover (adapters/claude-code.facts.json). */
export const COVERED = '2.1.308';

// Criterion IDs: the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
// (scripts/proof-change.mjs, criterionId). Each test's title starts with its criterion and ID.
export const AC1 = 'AC1 #1202.3792a9e0';
export const AC2 = 'AC2 #1202.d1a1edc6';
export const AC3 = 'AC3 #1202.cbf2a1cb';

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
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw.trim()); return l ? [l] : []; });

// ---- dash, and the process table (Linux's /proc): what the criteria are about.
/** dash's path, or a BLOCKED failure: the issue is about machines whose /bin/sh is dash. */
export function dash(): string {
  for (const dir of ['/usr/bin', '/bin', '/usr/local/bin']) if (existsSync(join(dir, 'dash'))) return join(dir, 'dash');
  throw Error('BLOCKED: no dash on this machine (looked in /usr/bin, /bin, /usr/local/bin), so the entries can\'t be run the way a Debian or Ubuntu Claude Code runs them; install dash and run again');
}
export function requireProc(): void {
  if (!existsSync('/proc/self/stat')) throw Error('BLOCKED: no /proc on this machine, so a running deep-hook\'s parent can\'t be read');
}
export interface Proc { pid: number; ppid: number; exe: string }
/** One process: its parent, from /proc/<pid>/stat, and the program it runs, from /proc/<pid>/exe. */
export function proc(pid: number): Proc | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    let exe = '';
    try { exe = readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, ''); } catch { /* gone, or not ours */ }
    return { pid, ppid, exe };
  } catch {
    return undefined;
  }
}
/** `root` and every process under it, read now. */
export function subtree(root: number): Proc[] {
  const all = readdirSync('/proc').filter((n) => /^\d+$/.test(n)).flatMap((n) => { const p = proc(Number(n)); return p ? [p] : []; });
  const out: Proc[] = [];
  const walk = (pid: number) => { const p = all.find((q) => q.pid === pid); if (p) out.push(p); for (const c of all.filter((q) => q.ppid === pid)) walk(c.pid); };
  walk(root);
  return out;
}
export const isDeepHook = (p: Proc) => basename(p.exe) === 'deep-hook';

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 108 bytes on Linux, 104 on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1202-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
export function own(pid: number | undefined): void {
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
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
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

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 2500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;

// ---- deep-hook as this checkout builds it (cargo only rebuilds what changed).
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
let built: Promise<string> | undefined;
export function buildDeepHook(): Promise<string> {
  built ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 1_200_000 }).then((r) => {
    if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
    return DEEP_HOOK;
  });
  return built;
}

// ---- A copy of this checkout (README: The copy of the checkout), as #993's suite makes it: every top-level entry a
// link, except `target`, which holds a real copy of the built deep-hook at `target/debug/deep-hook` and nothing else,
// and `packages/hub` and `packages/cli`, folders of links whose `dist` is a real copy, with `node_modules/@deepbuild/*`
// pointing into the copy's `packages`, so the copy's setup names the copy's deep-hook. AC2 removes that one file.
export interface Copy { root: string; cli: string; deepHook: string }
export async function copyOfTheCheckout(at: string): Promise<Copy> {
  for (const dist of ['packages/hub/dist/index.js', 'packages/cli/dist/main.js', 'node_modules/@deepbuild']) {
    if (!existsSync(join(REPO, dist))) throw Error(`BLOCKED: ${dist} is missing; run npm ci and npm run build --workspaces first`);
  }
  const hook = await buildDeepHook();
  mkdirSync(at);
  for (const name of readdirSync(REPO)) if (!['packages', 'node_modules', 'target'].includes(name)) symlinkSync(join(REPO, name), join(at, name));
  mkdirSync(join(at, 'packages'));
  for (const name of readdirSync(join(REPO, 'packages'))) {
    if (name !== 'hub' && name !== 'cli') { symlinkSync(join(REPO, 'packages', name), join(at, 'packages', name)); continue; }
    mkdirSync(join(at, 'packages', name));
    for (const entry of readdirSync(join(REPO, 'packages', name))) {
      if (entry !== 'dist') symlinkSync(join(REPO, 'packages', name, entry), join(at, 'packages', name, entry));
    }
    cpSync(join(REPO, 'packages', name, 'dist'), join(at, 'packages', name, 'dist'), { recursive: true });
  }
  mkdirSync(join(at, 'node_modules'));
  for (const name of readdirSync(join(REPO, 'node_modules'))) if (name !== '@deepbuild') symlinkSync(join(REPO, 'node_modules', name), join(at, 'node_modules', name));
  mkdirSync(join(at, 'node_modules', '@deepbuild'));
  for (const name of readdirSync(join(REPO, 'node_modules', '@deepbuild'))) {
    const real = realpathSync(join(REPO, 'node_modules', '@deepbuild', name));
    const inPackages = dirname(real) === realpathSync(join(REPO, 'packages'));
    symlinkSync(inPackages ? join(at, 'packages', basename(real)) : real, join(at, 'node_modules', '@deepbuild', name));
  }
  const deepHook = join(at, 'target', 'debug', 'deep-hook');
  mkdirSync(dirname(deepHook), { recursive: true });
  copyFileSync(hook, deepHook);
  chmodSync(deepHook, 0o755);
  return { root: at, cli: join(at, 'packages/cli/dist/main.js'), deepHook };
}

// ---- A home: <tmp>/h is HOME for every process a test starts; <tmp>/bin holds the system-tool stand-ins.
export interface Home { tmp: string; home: string; bin: string; work: string; copy: Copy }
const STUB = [
  '#!/bin/sh',
  '# A stand-in for a system tool these tests never let `deep` reach (launchctl, systemctl, the login-service launcher):',
  '# it appends its name and arguments to calls.log beside it and exits 0, so no test registers a login service here.',
  'here=$(cd "$(dirname "$0")" && pwd -P)',
  'printf \'%s %s\\n\' "$(basename "$0")" "$*" >> "$here/calls.log"',
  'exit 0',
  '',
].join('\n');
/**
 * A fresh home with a copy of the checkout, a working folder (a git repo) and the system-tool stand-ins. Claude Code's
 * user settings start as `{}`, so every hook entry in them after `deep setup` is one setup wrote.
 */
export async function makeHome(): Promise<Home> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const work = join(tmp, 'w');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(work, { recursive: true });
  execFileSync('git', ['init', '-q', work]);
  for (const name of ['launchctl', 'systemctl', 'launcher']) {
    writeFileSync(join(bin, name), STUB);
    chmodSync(join(bin, name), 0o755);
  }
  const copy = await copyOfTheCheckout(join(tmp, 's'));
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${copy.cli}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  writeFileSync(join(home, '.claude', 'settings.json'), '{}\n');
  return { tmp, home, bin, work, copy };
}
export const rootOf = (h: Home) => join(h.home, '.deepbuild');
export const settingsFile = (h: Home) => join(h.home, '.claude', 'settings.json');

/** Variables that mark an agent's process or bill an API account: a child never inherits this process's. */
const MARKERS = /^(CLAUDE|CURSOR|GROK|CODEX|ANTHROPIC|OPENAI|AWS_BEARER|DEEP_|XDG_|OTEL_)/;
/**
 * The environment a child gets: HOME the test's home, PATH the stand-ins, Node's folder and the system folders only,
 * no agent marker, billing key, DEEP_ setting or GIT_ variable of this process's, and the service manager stubbed.
 */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (MARKERS.test(key) || key === 'AI_AGENT' || key === 'NODE_OPTIONS' || key.startsWith('GIT_')) continue;
    if (key === 'PATH' || key === 'HOME' || key === 'SHELL') continue;
    env[key] = value;
  }
  env.HOME = h.home;
  env.XDG_CONFIG_HOME = join(h.home, '.config');
  env.XDG_CACHE_HOME = join(h.home, '.cache');
  env.SHELL = '/bin/sh';
  env.PATH = `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.LC_ALL = 'C';
  env.NO_COLOR = '1';
  env.DEEP_HUB_LAUNCHER = join(h.bin, 'launcher');
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
/** `deep <args>` from the copy's built CLI, HOME the test's home, in the home's working folder. */
export function deep(h: Home, args: readonly string[], o: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [h.copy.cli, ...args], { env: childEnv(h, o.env), cwd: h.work, timeoutMs: o.timeoutMs ?? 180_000 });
}

// ---- Claude Code's user settings and the hook entries setup wrote in them.
export function readSettings(h: Home): Line {
  const text = readFileSync(settingsFile(h), 'utf8');
  const parsed = parseObject(text);
  if (!parsed) throw Error(`${settingsFile(h)} is not a JSON object: ${text.slice(0, 500)}`);
  return parsed;
}
export interface Entry { event: string; matcher: unknown; command: string; background: boolean; hook: Line }
/** Every command hook entry in the settings, by event: the settings started as `{}`, so each is setup's. */
export function setupEntries(h: Home): Entry[] {
  const hooks = (readSettings(h).hooks ?? {}) as Record<string, Line[]>;
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((group) =>
    (Array.isArray(group?.hooks) ? (group.hooks as Line[]) : [])
      .filter((hook) => hook.type === 'command' && typeof hook.command === 'string')
      .map((hook) => ({ event, matcher: group.matcher, command: String(hook.command), background: Boolean(hook.async || hook.asyncRewake), hook }))));
}

/** `deep setup` with a hub answering and the service manager stubbed; BLOCKED unless it exits 0 and writes entries. */
export async function setUp(h: Home): Promise<Entry[]> {
  const set = await deep(h, ['setup']);
  if (set.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 in the test home: ${shown(set)}`);
  const entries = setupEntries(h);
  if (!entries.length) throw Error(`BLOCKED: deep setup wrote no hook entry into ${settingsFile(h)}: ${JSON.stringify(readSettings(h))}`);
  return entries;
}

// ---- deep doctor --json: one doctor.item@1 (with item and agent) per line.
export interface DoctorItem { item?: string; agent?: string; code: string; level: string; evidence: string; fix: string }
export async function doctor(h: Home): Promise<{ ran: Ran; items: DoctorItem[] }> {
  const ran = await deep(h, ['doctor', '--json']);
  return { ran, items: jsonLines(ran.stdout) as DoctorItem[] };
}
export const itemText = (i: DoctorItem) => `${i.evidence ?? ''} ${i.fix ?? ''}`;
export const itemsShown = (items: DoctorItem[]) => items.map((i) => JSON.stringify(i)).join('\n');

// ---- The hub as a process: `deep hub run` from the copy, HOME the test's home (#16).
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; output(): string }
export async function startHub(h: Home, env: Record<string, string | undefined> = {}): Promise<Hub> {
  const child = spawn(NODE, [h.copy.cli, 'hub', 'run'], { cwd: h.work, env: childEnv(h, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, socket: join(rootOf(h), 'hub.sock'), root: rootOf(h), child, output: () => out };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (alive(hub.pid)) await sleep(20);
}

// ---- The line protocol (#16): a cli connection with the control token.
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
  async hello(token: string): Promise<void> {
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    const reply = await this.wait((l) => 'role' in l || 'error' in l, from, 10_000);
    if (!reply || reply.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(reply)}`);
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
export async function control<T>(hub: Hub, use: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await use(conn);
  } finally {
    conn.close();
  }
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; agent?: string; verified?: boolean; data: Line }
export function allEvents(hub: Hub): Promise<Ev[]> {
  return control(hub, async (conn) => {
    const out: Ev[] = [];
    let after = 0;
    for (;;) {
      const events = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos;
    }
  });
}
/** Steps the hub's clock (DEEP_HUB_TEST_CLOCK_STEPS=1, #965's `test.clock`); the hub's now after the step. */
export const stepClock = (hub: Hub, ms: number): Promise<number> => control(hub, async (conn) => Number((await conn.call('test.clock', { advance_ms: ms })).now));
/** The kinds a Claude Code hook itself maps to (#18): the events whose `verified` the criteria read. */
export const HOOK_KINDS = new Set(['session.start', 'session.end', 'user.ask', 'tool.before', 'tool.after', 'permission.request', 'agent.stop', 'task.completed']);

export async function eventually(probe: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

// ---- deep-hook's spool: with the hub down, each hook's request saved byte for byte (design: Hook protocol), with
// the `pid` and `ppid` deep-hook sends.
export function spooled(h: Home): Line[] {
  const dir = join(rootOf(h), 'spool');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort().flatMap((n) => jsonLines(readFileSync(join(dir, n), 'utf8')));
}

// ---- Sessions and their hook payloads, shaped like the corpus's Claude Code payloads (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string }
export function newSession(h: Home): Session {
  const id = randomUUID();
  const cwd = h.work;
  const transcript = join(h.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
/** The transcript entry Claude Code writes for a prompt you typed. */
export function typedPrompt(s: Session, text: string): void {
  const line = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: text }, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', promptSource: 'typed' };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
export const TOOL_USE = () => `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
/** One hook's payload for the session, as Claude Code 2.1.308 sends it. */
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  switch (event) {
    case 'SessionStart': Object.assign(base, { source: 'startup', model: 'claude-haiku-4-5' }); break;
    case 'UserPromptSubmit': Object.assign(base, { prompt: 'List the files here.' }); break;
    case 'PreToolUse': case 'PermissionRequest': Object.assign(base, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: TOOL_USE() }); break;
    case 'PostToolUse': Object.assign(base, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: 'README.md', stderr: '', interrupted: false }, tool_use_id: TOOL_USE() }); break;
    case 'PostToolUseFailure': Object.assign(base, { tool_name: 'Bash', tool_input: { command: 'false' }, error: 'Exit code 1', tool_use_id: TOOL_USE() }); break;
    case 'Stop': Object.assign(base, { stop_hook_active: false, last_assistant_message: 'Done.' }); break;
    case 'StopFailure': Object.assign(base, { error: 'server_error' }); break;
    case 'SessionEnd': Object.assign(base, { reason: 'other' }); break;
    case 'FileChanged': Object.assign(base, { file_path: join(s.cwd, 'README.md') }); break;
    default: break;
  }
  return { ...base, ...extra };
}

// ---- The Claude Code stand-in (fixtures/claude.mjs): one process is one session's Claude Code.
export interface EntryRun { command: string; shellPid: number; code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }
export interface Fired { standin: number; ran: EntryRun[]; background: EntryRun[]; settingsError?: string }
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess, private readonly h: Home) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
    });
  }
  get pid(): number { return this.child.pid!; }
  /** Claude Code for one session, HOME the test's home, with the variables Claude Code gives its hooks. */
  static start(h: Home): Claude {
    const env = childEnv(h, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: h.work });
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs')], { cwd: h.work, env, stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Claude(child, h);
  }
  private send(command: Line, timeoutMs = 180_000): Promise<Line> {
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
  /** Fires one hook: every entry of the user settings for it, each run with `<shell> -c <command>`, as Claude Code runs them. */
  async hook(shell: string, event: string, body: Line): Promise<Fired> {
    return (await this.send({ op: 'hook', shell, event, payload: body, settings: settingsFile(this.h) })) as unknown as Fired;
  }
  /** Stops this session's background entries and exits, as Claude Code does when the session ends. */
  async exit(): Promise<void> {
    await this.send({ op: 'exit' }).catch(() => undefined);
    const deadline = Date.now() + 5000;
    while (alive(this.pid) && Date.now() < deadline) await sleep(20);
  }
}
export const firedShown = (f: Fired) => JSON.stringify([...f.ran, ...f.background].map((r) => ({ command: r.command.slice(0, 160), code: r.code, signal: r.signal, timedOut: r.timedOut, stdout: r.stdout.slice(0, 400), stderr: r.stderr.slice(0, 400) })));
