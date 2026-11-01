// Shared test-side tools for issue #18's install criteria (README): temp homes with stubbed system tools, `deep
// setup` and `deep doctor` through the built CLI, Claude Code's user settings file and DeepBuild's entries in it, the
// hub as a process with its socket's line protocol, a forwarded socket that keeps the acknowledgements, and the
// Claude Code stand-in (fixtures/claude.mjs). Parts are adapted from tests/acceptance/315/helpers.ts and
// tests/acceptance/26/helpers.ts (same repo, same license); this suite keeps its own copy so a redraft of theirs
// never moves these tests. Nothing here stands in for DeepBuild: every test reaches it through the CLI, deep-hook as
// the settings run it, the hub's socket and the files under the temporary home.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const NODE = process.execPath;
export const SECOND = 1000;
export const MINUTE = 60_000;

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
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh18i-'));
  made.push(dir);
  return dir;
}
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts, so `~/.deepbuild` and `~/.claude` are
 * `<tmp>/h/.deepbuild` and `<tmp>/h/.claude`. `<tmp>/bin` comes first on PATH with stand-ins for launchctl,
 * systemctl and claude (each logs its call to `<tmp>/bin/calls.log` and exits 0) and a `deep` that runs the built CLI.
 */
export interface Home { tmp: string; home: string; bin: string }
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin);
  for (const name of ['launchctl', 'systemctl', 'claude']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  return { tmp, home, bin };
}
export const rootOf = (home: string) => join(home, '.deepbuild');
export const settingsFile = (home: string) => join(home, '.claude', 'settings.json');
export const binOf = (home: string) => join(dirname(home), 'bin');

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
/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, no DEEP_ setting or billing key of this process's. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.SHELL = '/bin/sh';
  env.PATH = `${binOf(home)}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
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
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
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
/** `deep <args>` from the built CLI, HOME the test's home. */
export function deep(home: string, args: readonly string[], o: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(home, o.env), timeoutMs: o.timeoutMs ?? 180_000 });
}

// ---- deep-hook: built once per test process; setup names the path its entries run (README: deep-hook).
const builds = new Map<string, Promise<void>>();
export function cargoBuild(release: boolean): Promise<void> {
  const key = release ? 'release' : 'debug';
  let made = builds.get(key);
  if (!made) {
    const args = ['build', '--locked', '-q', '-p', 'deep-hook', ...(release ? ['--release'] : [])];
    made = run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => {
      if (r.code !== 0) throw Error(`BLOCKED: cargo ${args.join(' ')} failed: ${r.stderr.slice(-3000)}`);
    });
    builds.set(key, made);
  }
  return made;
}
/** Builds every deep-hook binary of this checkout that an entry of DeepBuild's names, and fails BLOCKED on one that's still missing. */
export async function ensureBinaries(settings: Line): Promise<void> {
  for (const { hook } of deepEntries(settings)) {
    for (const path of String(hook.command).match(/\/[^\s'"]*deep-hook\b/g) ?? []) {
      if (existsSync(path)) continue;
      if (path === join(REPO, 'target/release/deep-hook')) await cargoBuild(true);
      else if (path === join(REPO, 'target/debug/deep-hook')) await cargoBuild(false);
      if (!existsSync(path)) throw Error(`BLOCKED: DeepBuild's entry runs ${path}, which doesn't exist: ${hook.command}`);
    }
  }
}

// ---- Claude Code's user settings and DeepBuild's entries in it (README: DeepBuild's entries).
export function readSettings(home: string): Line {
  const text = readFileSync(settingsFile(home), 'utf8');
  const parsed = parseObject(text);
  if (!parsed) throw Error(`${settingsFile(home)} is no longer a JSON object: ${text.slice(0, 500)}`);
  return parsed;
}
export function writeSettings(home: string, settings: Line): void {
  mkdirSync(dirname(settingsFile(home)), { recursive: true });
  writeFileSync(settingsFile(home), `${JSON.stringify(settings, null, 2)}\n`);
}
/** Whether a hook command is DeepBuild's: it runs deep-hook, or the deep CLI (by its built file or as `deep`). */
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
export interface Entry { event: string; group: number; index: number; matcher: unknown; hook: Line }
/** Every hook entry of the settings, by event, group and place. */
export function entries(settings: Line): Entry[] {
  const hooks = (settings.hooks ?? {}) as Record<string, Line[]>;
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((group, g) =>
    (Array.isArray(group?.hooks) ? group.hooks : []).map((hook: Line, index: number) => ({ event, group: g, index, matcher: group.matcher, hook }))));
}
export const deepEntries = (settings: Line): Entry[] => entries(settings).filter((e) => isDeepBuild(e.hook.command));
/** The hooks object with DeepBuild's entries taken out, and the groups and events they leave empty dropped. */
export function withoutDeepBuild(hooks: Line | undefined): Line {
  const out: Line = {};
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    if (!Array.isArray(groups)) { out[event] = groups; continue; }
    const kept = groups.map((group: Line) => ({ ...group, hooks: (group.hooks ?? []).filter((h: Line) => !isDeepBuild(h.command)) }))
      .filter((group: Line, i: number) => group.hooks.length > 0 || (groups[i].hooks ?? []).length === 0);
    if (kept.length) out[event] = kept;
  }
  return out;
}
/** DeepBuild's Stop entry that holds a stop: its Stop entry that runs in the foreground. */
export function stopHoldEntry(settings: Line): Entry {
  const found = deepEntries(settings).filter((e) => e.event === 'Stop' && !e.hook.async && !e.hook.asyncRewake);
  if (found.length !== 1) throw Error(`setup must write one foreground Stop entry of DeepBuild's into ~/.claude/settings.json; found ${found.length}: ${JSON.stringify(found.map((e) => e.hook))}`);
  return found[0]!;
}
/**
 * DeepBuild's waiter entries: its entries with asyncRewake, which wake an idle session (design: Getting an answer
 * back). Since the Oct 29 amendment (#85) setup writes one under Stop and one under StopFailure, with the same command
 * and timeout, since a turn that ends on an API error fires only StopFailure. A setup that writes the waiter under
 * Stop only fails here, naming StopFailure.
 */
export function waiterEntries(settings: Line): { stop: Entry; stopFailure: Entry } {
  const all = deepEntries(settings).filter((e) => e.hook.asyncRewake === true);
  const shownAll = JSON.stringify(deepEntries(settings).map((e) => ({ event: e.event, ...e.hook })));
  const under = (event: string): Entry => {
    const found = all.filter((e) => e.event === event);
    if (found.length !== 1) throw Error(`setup must write one asyncRewake waiter entry of DeepBuild's under ${event} in ~/.claude/settings.json${event === 'StopFailure' ? ' (a turn that ends on an API error fires only StopFailure, so a waiter under Stop only never starts for it)' : ''}; found ${found.length}: ${shownAll}`);
    return found[0]!;
  };
  const stop = under('Stop');
  const stopFailure = under('StopFailure');
  const elsewhere = all.filter((e) => e.event !== 'Stop' && e.event !== 'StopFailure');
  if (elsewhere.length) throw Error(`setup must write DeepBuild's waiter only under Stop and StopFailure; found it under ${elsewhere.map((e) => e.event).join(', ')}: ${shownAll}`);
  return { stop, stopFailure };
}
/** The waiter's entry under Stop, and under StopFailure, as picks for setTimeoutOf. */
export const stopWaiter = (settings: Line): Entry => waiterEntries(settings).stop;
export const stopFailureWaiter = (settings: Line): Entry => waiterEntries(settings).stopFailure;
/** Sets one entry's timeout, in seconds, as you would in an editor; every other byte of meaning stays. */
export function setTimeoutOf(home: string, pick: (s: Line) => Entry, seconds: number): void {
  const settings = readSettings(home);
  const e = pick(settings);
  (settings.hooks[e.event][e.group].hooks[e.index] as Line).timeout = seconds;
  writeSettings(home, settings);
}

/**
 * `deep setup` with HOME the test's home. It runs with a hub already answering at the address (the tests start one
 * first) and with launchctl and systemctl stubbed, so it registers no login service on this Mac (README: Setup).
 * Fails with the command's output unless it exits 0; builds the deep-hook its entries name.
 */
export async function setup(home: string, env: Record<string, string | undefined> = {}): Promise<Ran> {
  await cargoBuild(false);
  const r = await deep(home, ['setup'], { env });
  if (r.code !== 0) throw Error(`deep setup must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  if (!existsSync(settingsFile(home))) throw Error(`deep setup exited 0 but wrote no ${settingsFile(home)}: ${shown(r)}`);
  await ensureBinaries(readSettings(home));
  return r;
}

// ---- deep doctor --json: one doctor.item@1 (with item and agent) per line.
export interface DoctorItem { item?: string; agent?: string; code: string; level: string; evidence: string; fix: string }
export async function doctor(home: string): Promise<{ ran: Ran; items: DoctorItem[] }> {
  const ran = await deep(home, ['doctor', '--json']);
  return { ran, items: jsonLines(ran.stdout) as DoctorItem[] };
}
export const itemText = (i: DoctorItem) => `${i.evidence ?? ''} ${i.fix ?? ''}`;

// ---- The hub as a process: `deep hub run`, HOME the test's home (#16).
export interface Hub { pid: number; home: string; socket: string; root: string; child: ChildProcess; output(): string; startedAt: number }
export interface HubOptions { plant?: string; clock?: number; env?: Record<string, string | undefined> }
export async function startHub(home: string, o: HubOptions = {}): Promise<Hub> {
  const env = childEnv(home, { DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_CLOCK: o.clock === undefined ? undefined : String(Math.round(o.clock)), ...o.env });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  if (!ready) throw Error(`BLOCKED: the hub didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), root: rootOf(home), child, output: () => out, startedAt: Date.now() };
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
export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; seq?: string; subject?: string; session?: string; data: Line }
/** Every event in the log, paged by log_pos through `events.read`. */
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
export const health = (hub: Hub): Promise<Line> => control(hub, (conn) => conn.call('hub.health'));
export const sessions = async (hub: Hub): Promise<Line[]> => (await control(hub, (conn) => conn.call('sessions.read'))).sessions as Line[];
export const inbox = async (hub: Hub): Promise<Line[]> => (await control(hub, (conn) => conn.call('inbox.read'))).asks as Line[];
/** Polls until probe gives a value, or fails naming what it waited for. */
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(200);
  }
}
/** Polls `probe` until it holds; resolves with whether it did. */
export async function eventually(probe: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

/**
 * A health reading, wherever the hub shows it (README: Readings): its `hub.health` answer, and every event in its
 * log, each as JSON text. A reading matches when its text does.
 */
export async function readingTexts(hub: Hub): Promise<string[]> {
  const [h, events] = await Promise.all([health(hub), allEvents(hub)]);
  return [JSON.stringify(h), ...events.filter((e) => !HOOK_KINDS.has(e.kind)).map((e) => JSON.stringify({ kind: e.kind, subject: e.subject, session: e.session, data: e.data }))];
}
/** The kinds a hook itself maps to: a call's own events are never the reading that names it. */
export const HOOK_KINDS = new Set(['session.start', 'session.end', 'user.ask', 'tool.before', 'tool.after', 'permission.request', 'agent.stop', 'task.completed']);
export const count = (text: string, needle: string) => text.split(needle).length - 1;

// ---- A forwarded socket at the address setting that keeps every byte both ways (#16's forwarder, #315's copy).
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
/** The address setting: `{"hub": {"address": "unix:<path>"}}` in <home>/.deepbuild/config.json (#16), other keys kept. */
export function setAddress(home: string, path: string): void {
  editConfig(home, (config) => { config.hub = { ...(config.hub as Line | undefined), address: `unix:${path}` }; });
}
/** Your settings, <home>/.deepbuild/config.json (the asks block is where an ask's deadline comes from, #318). */
export function editConfig(home: string, edit: (config: Line) => void): void {
  const file = join(rootOf(home), 'config.json');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const config = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? {}) : {};
  edit(config);
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

// ---- Sessions and their hook payloads, shaped like the corpus's Claude Code payloads (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
export function newSession(home: string): Session {
  const id = randomUUID();
  const cwd = join(dirname(home), `w${tag(3)}`);
  mkdirSync(cwd, { recursive: true });
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
    case 'SessionEnd': Object.assign(base, { reason: 'other' }); break;
    default: break;
  }
  return { ...base, ...extra };
}
/** The transcript entry Claude Code writes for a prompt you typed; returns its prompt ID, which the hooks of its turn carry. */
export function typedPrompt(s: Session, text: string): string {
  const promptId = randomUUID();
  s.prompt = promptId;
  appendTranscript(s, { type: 'user', promptId, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return promptId;
}
export function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}

// ---- The Claude Code stand-in (fixtures/claude.mjs): one process per session.
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
  get pid(): number { return this.child.pid!; }
  /** Claude Code for one session, HOME the test's home; `env` is added to what its hooks and its deep mcp get. */
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
  async background(): Promise<(HookRun & { event: string })[]> { return (await this.send({ op: 'background' })).background as (HookRun & { event: string })[]; }
  async expire(seconds: number): Promise<(HookRun & { event: string })[]> { return (await this.send({ op: 'expire', seconds })).stopped as (HookRun & { event: string })[]; }
  /** A command as the Bash tool runs it, a child of this session's process. */
  async exec(command: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string; started: number; ended: number }> {
    return (await this.send({ op: 'exec', command, cwd })) as unknown as { code: number; stdout: string; stderr: string; started: number; ended: number };
  }
  /** One JSON-RPC request to this session's own `deep mcp`. */
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
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-18-install', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.notify('notifications/initialized');
  }
  /**
   * A tool call of this session's deep mcp as Claude Code makes it: its PreToolUse first (named
   * `mcp__deep__<tool>`, the call's arguments as its input), then the call. Resolves with the call's reply.
   */
  async deepTool(s: Session, tool: string, args: Line, timeoutMs = 120_000): Promise<Line> {
    await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args, tool_use_id: callId() }));
    return this.request('tools/call', { name: tool, arguments: args }, timeoutMs);
  }
}
/** The runs of DeepBuild's entries among a hook's, and the others'. */
export const ours = (f: Fired): HookRun[] => [...f.ran, ...f.background].filter((r) => isDeepBuild(r.command));
export const theirs = (f: Fired): HookRun[] => [...f.ran, ...f.background].filter((r) => !isDeepBuild(r.command));
export const firedShown = (f: Fired) => JSON.stringify([...f.ran, ...f.background].map((r) => ({ command: r.command.slice(0, 160), code: r.code, signal: r.signal, timedOut: r.timedOut, stdout: r.stdout.slice(0, 400), stderr: r.stderr.slice(0, 400) })));

// ---- The recorded "tools" session of Claude Code 2.1.304 (adapters/corpus/claude-code/2.1.304/tools, #47), replayed
// into a session of the test's own: its session ID, folder and transcript path rewritten, and its transcript
// written up to each hook's place, as Claude Code had written it when that hook fired.
const CORPUS = join(REPO, 'adapters/corpus/claude-code/2.1.304/tools');
export interface Replayed { event: string; payload: Line; transcriptLines: number }
/**
 * The first two turns of the recorded session, hook by hook: a Bash call that ran, then a Write whose permission
 * prompt the person answered by typing in the terminal (no hook answered it; its PostToolUse followed).
 */
export function corpusTurns(s: Session): Replayed[] {
  const raw = readFileSync(join(CORPUS, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).slice(0, 10);
  const first = parseObject(raw[0]!)!.payload as Line;
  const rewrite = (text: string) => text.replaceAll(first.transcript_path, s.transcript).replaceAll(first.cwd, s.cwd).replaceAll(first.session_id, s.id);
  // How many transcript entries were written when each of the ten hooks fired (the transcript's own order).
  const upTo = [0, 1, 2, 3, 4, 7, 9, 9, 10, 11];
  return raw.map((line, i) => {
    const p = JSON.parse(rewrite(line)).payload as Line;
    delete p.scratchpad_dir;
    return { event: String(p.hook_event_name), payload: p, transcriptLines: upTo[i]! };
  });
}
/** Writes the recorded transcript's first `n` entries into the session's transcript, rewritten. */
export function corpusTranscript(s: Session, n: number): void {
  const first = parseObject(readFileSync(join(CORPUS, 'events.jsonl'), 'utf8').split('\n')[0]!)!.payload as Line;
  const lines = readFileSync(join(CORPUS, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean).slice(0, n)
    .map((l) => l.replaceAll(first.cwd, s.cwd).replaceAll(first.session_id, s.id));
  writeFileSync(s.transcript, lines.length ? `${lines.join('\n')}\n` : '');
}
export const sha = (bytes: string) => execFileSync('shasum', ['-a', '256'], { input: bytes, encoding: 'utf8' }).split(' ')[0]!;
export const ULIDISH = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const spawnSyncText = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8' });
