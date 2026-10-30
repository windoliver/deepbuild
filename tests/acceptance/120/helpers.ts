// Shared test-side tools for issue #120 (README): temp homes with stubbed system tools, `deep setup` through the built
// CLI, the hub as a process with its socket's line protocol and its test clock (restarted to move time on), the Claude
// Code stand-in (fixtures/claude.mjs: hooks, the waiter's wake, the FileChanged route), Codex's hooks run as Codex runs
// them (deep-hook codex <event>), the record and the session rows, raw hook request lines for the budgets, and the
// reference-Mac gate. Parts are adapted from tests/acceptance/83/helpers.ts and tests/acceptance/25/routes/helpers.ts
// (same repo, same license); this suite keeps its own copy so a redraft of theirs never moves these tests. Nothing
// here stands in for DeepBuild: every test reaches it through the CLI, deep-hook as the settings run it, the hub's
// socket and the files under the temporary home.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const NODE = process.execPath;
export const MINUTE = 60_000;

/** The criteria these files prove, each named by its number in the issue's order and its ID (README: Criteria to tests). */
export const AC1 = 'AC1 #120.7edb0b65';
export const AC2 = 'AC2 #120.4c1ac190';
export const AC3 = 'AC3 #120.5f22a00c';
export const AC4 = 'AC4 #120.5568c5c4';
export const AC5 = 'AC5 #120.4494c783';
export const AC6 = 'AC6 #120.67021934';
export const AC7 = 'AC7 #120.557a037b';
export const AC8 = 'AC8 #120.af5921ee';
export const AC9 = 'AC9 #120.a3880a7d';

/** The promise the agent makes for later (README: The promise): a relative time, so its due time is the stop's plus 20 minutes. */
export const QUOTE = "I'll check the deploy again in 20 minutes.";
export const PROMISE_MS = 20 * MINUTE;
/** The command that never ends on its own (the design's example: following a log). */
export const TAIL = 'tail -f /var/log/app.log';

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
export const readLines = (file: string): Line[] => (existsSync(file) ? jsonLines(readFileSync(file, 'utf8')) : []);
export const tag = (n = 4) => randomBytes(n).toString('hex');
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
export const CODEX_COVERED = (() => { const v = (JSON.parse(readFileSync(join(REPO, 'adapters/codex.facts.json'), 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

/** A duration as a line may spell it: `12 s`, `3m`, `2 min`, `1h 5m`, `10 minutes`, `0:45`. */
export const DURATION = /\b\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/i;
/** A clock time or date a line may name a due time with: `09:40`, `9:40 pm`, an ISO date, or `in 20 min`. */
export const CLOCK_TIME = /\b\d{1,2}:\d{2}(?:\s*[ap]m)?\b|\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|\bin \d+\s*(?:s|m|min|minutes?|h|hours?)\b/i;
export const hasDuration = (text: string | undefined): boolean => typeof text === 'string' && DURATION.test(text);
export const hasTime = (text: string | undefined): boolean => typeof text === 'string' && (CLOCK_TIME.test(text) || DURATION.test(text));

// ---- A checkout whose built CLI and deep-hook a test drives: this one, or the merge base's (budgets.test.ts).
export interface Checkout { label: string; root: string; cli: string; hook: string }
export const CURRENT: Checkout = { label: 'this checkout', root: REPO, cli: join(REPO, 'packages/cli/dist/main.js'), hook: join(REPO, 'target/debug/deep-hook') };

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh120-'));
  made.push(dir);
  return dir;
}
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts. `<tmp>/bin` comes first on PATH with stand-ins for
 * launchctl, systemctl, claude and codex (each logs its call and exits 0) and a `deep` that runs the checkout's built
 * CLI. `<tmp>/confirm` holds `confirmed` (the OS confirmation stubbed, #24). `<tmp>/hooks.jsonl` is the hook log.
 */
export interface Home { tmp: string; home: string; bin: string; hookLog: string; co: Checkout }
export function makeHome(co: Checkout = CURRENT): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
  mkdirSync(bin);
  for (const name of ['launchctl', 'systemctl', 'claude', 'codex']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  writeFileSync(join(bin, 'codex.version'), `${CODEX_COVERED}\n`);
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${co.cli}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  return { tmp, home, bin, hookLog: join(tmp, 'hooks.jsonl'), co };
}
export const rootOf = (h: Home) => join(h.home, '.deepbuild');
export const settingsFile = (h: Home) => join(h.home, '.claude', 'settings.json');

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
export function own(pid: number | undefined): void { if (pid) owned.add(pid); }
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
/** Process groups the stand-in started for hook entries (each entry runs in its own group, as the entry's shell pid); the waiter among them. */
const startedGroups = new Set<number>();
/** Stops every process this suite started and every group its stand-ins started for hook entries (SIGTERM, then SIGKILL) and removes its temp folders. */
export async function cleanup(): Promise<void> {
  for (const pgid of startedGroups) try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ }
  for (const pid of owned) for (const target of [pid, -pid]) try { process.kill(target, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) for (const target of [pid, -pid]) try { process.kill(target, 'SIGKILL'); } catch { /* gone */ }
  for (const pgid of startedGroups) try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  startedGroups.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export interface Proc { pid: number; ppid: number; pgid: number; rssKb: number; stat: string; cpuS: number; command: string }
/** `ps` cputime, `[[dd-]hh:]mm:ss.cc`, in seconds. */
export function cpuSeconds(text: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 86_400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}
/** Every process on the machine, from `ps`: its group, resident size in KB, state and CPU time used so far. */
export function processes(): Proc[] {
  const text = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,rss=,stat=,cputime=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return text.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), rssKb: Number(m[4]), stat: m[5]!, cpuS: cpuSeconds(m[6]!), command: m[7]! }] : [];
  });
}
/** The live (not zombie) processes of a process group. */
export const groupOf = (pgid: number, table: Proc[] = processes()): Proc[] => table.filter((p) => p.pgid === pgid && !p.stat.startsWith('Z'));

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'];
/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, no DEEP_, CLAUDE, forge or billing variable of this process's. */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), SHELL: '/bin/sh', LC_ALL: 'C',
    PATH: `${h.bin}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, DEEP_HUB_TEST_CONFIRM: join(h.tmp, 'confirm'),
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; started: number; ended: number }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const started = Date.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, started, ended: Date.now() }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
/** `deep <args>` from the home's checkout, HOME the test's home. */
export function deep(h: Home, args: readonly string[], env: Record<string, string | undefined> = {}, timeoutMs = 180_000): Promise<Ran> {
  return run(NODE, [h.co.cli, ...args], { env: childEnv(h, env), timeoutMs, cwd: h.co.root });
}

// ---- Claude Code's user settings and DeepBuild's entries in it.
export function readSettings(h: Home): Line {
  const parsed = parseObject(readFileSync(settingsFile(h), 'utf8'));
  if (!parsed) throw Error(`${settingsFile(h)} is not a JSON object`);
  return parsed;
}
/** Whether a hook command is DeepBuild's: it runs deep-hook, or the deep CLI (by its built file or as `deep`). */
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
export interface Entry { event: string; hook: Line }
export function deepEntries(settings: Line): Entry[] {
  const hooks = (settings.hooks ?? {}) as Record<string, Line[]>;
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : [])
    .flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []).map((hook: Line) => ({ event, hook }))))
    .filter((e) => isDeepBuild(e.hook.command));
}
/**
 * `deep setup` with HOME the test's home, a hub already answering and launchctl/systemctl stubbed. Fails with the
 * command's output unless it exits 0; BLOCKED when an entry names a deep-hook that isn't there (never built here).
 */
export async function setup(h: Home, env: Record<string, string | undefined> = {}): Promise<void> {
  const r = await deep(h, ['setup'], env);
  if (r.code !== 0) throw Error(`BLOCKED: deep setup (${h.co.label}) must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  for (const { hook } of deepEntries(readSettings(h))) {
    for (const path of String(hook.command).match(/\/[^\s'"]*deep-hook\b/g) ?? []) {
      if (!existsSync(path)) throw Error(`BLOCKED: DeepBuild's entry runs ${path}, which doesn't exist (build it with cargo build -p deep-hook): ${hook.command}`);
    }
  }
}

// ---- The hub as a process: `deep hub run`, HOME the test's home (#16), its clock set with DEEP_HUB_TEST_CLOCK (README: Time).
export interface Hub { pid: number; h: Home; socket: string; root: string; child: ChildProcess; plant: string | undefined; clock: number; output(): string }
export interface HubOptions { plant?: string | undefined; clock?: number | undefined }
export async function startHub(h: Home, o: HubOptions = {}): Promise<Hub> {
  const env = childEnv(h, { DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_CLOCK: o.clock === undefined ? undefined : String(Math.round(o.clock)) });
  const child = spawn(NODE, [h.co.cli, 'hub', 'run'], { cwd: h.co.root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  if (!ready) throw Error(`BLOCKED: the hub (${h.co.label}) didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${out.slice(0, 2000)}`);
  const root = rootOf(h);
  return { pid: child.pid!, h, socket: join(root, 'hub.sock'), root, child, plant: o.plant, clock: o.clock ?? Date.now(), output: () => out };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (alive(hub.pid)) await sleep(50);
}
/** A hub with `deep setup` run against it: the home's Claude Code settings hold DeepBuild's entries. */
export async function hubWithSetup(h: Home, o: HubOptions = {}): Promise<Hub> {
  const hub = await startHub(h, o);
  await setup(h, o.plant ? { DEEP_HUB_PLANT: o.plant } : {});
  return hub;
}
/**
 * Time moves on (README: Time): the hub is stopped and started again with its test clock `ms` ahead of where it was,
 * on the same record. Nothing else changes; a waiter Claude Code started keeps waiting across the restart (#25, AC6).
 */
export async function moveOn(hub: Hub, ms: number): Promise<Hub> {
  const clock = Math.max(hub.clock + ms, Date.now() + ms);
  await stopHub(hub);
  return startHub(hub.h, { plant: hub.plant, clock });
}

// ---- The line protocol (#16): a cli connection with the control token.
export class Conn {
  private buffer = '';
  readonly lines: Line[] = [];
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
    const end = () => { this.ended = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
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
  wait(match: (line: Line) => boolean, from: number, timeoutMs: number): Promise<Line | undefined> {
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
export const ofSession = (events: readonly Ev[], session: string, kind?: string): Ev[] => events.filter((e) => e.session === session && (kind === undefined || e.kind === kind));
export const evShown = (e: Ev) => `${e.kind}@${e.log_pos} ts=${e.ts} ${JSON.stringify(e.data).slice(0, 400)}`;
/** The open asks in your inbox (`inbox.read`). */
export const inboxRead = (hub: Hub): Promise<Line[]> => control(hub, async (conn) => (await conn.call('inbox.read')).asks as Line[]);
/** Each session's row as `deep status` shows it (`status.read`, README: The session's row). */
export const statusRows = (hub: Hub): Promise<Line[]> => control(hub, async (conn) => (await conn.call('status.read')).rows as Line[]);
/** Polls until probe gives a value, or fails naming what it waited for. */
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string, everyMs = 200): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(everyMs);
  }
}
/** Waits for an event of the session matching `pred` (the hub acknowledges a hook before it appends its event). */
export const awaitEvent = (hub: Hub, s: Session, pred: (e: Ev) => boolean, what: string, timeoutMs = 20_000): Promise<Ev> =>
  waitFor(async () => (await allEvents(hub)).find((e) => e.session === s.id && pred(e)), timeoutMs, `${what} in ${s.id}'s record`);

// ---- The wake-up in the record (README: The wake-up record): the event that carries the promise's quote.
/** Kinds that echo the agent's words and so aren't the wake-up's own record. */
const ECHOES = /^(agent\.|tool\.|user\.|session\.|claim\.|verdict\.|turn\.)/;
export const wakeupEvents = (events: readonly Ev[], session: string, quote = QUOTE): Ev[] =>
  events.filter((e) => e.session === session && !ECHOES.test(e.kind) && JSON.stringify(e.data).includes(quote));
/** A time a field may hold: ms since the epoch, seconds since the epoch, or an ISO string. */
export function timeOf(value: unknown): number | undefined {
  if (typeof value === 'number') return value > 1e11 ? value : value > 1e8 ? value * 1000 : undefined;
  if (typeof value === 'string') { const t = Date.parse(value); return Number.isNaN(t) ? undefined : t; }
  return undefined;
}
/** Every (key, time) in an object, one level deep into nested objects. */
export function times(data: Line): { key: string; at: number }[] {
  const out: { key: string; at: number }[] = [];
  for (const [key, value] of Object.entries(data)) {
    const at = timeOf(value);
    if (at !== undefined) out.push({ key, at });
    else if (typeof value === 'object' && value !== null && !Array.isArray(value)) for (const [k, v] of Object.entries(value as Line)) { const t = timeOf(v); if (t !== undefined) out.push({ key: `${key}.${k}`, at: t }); }
  }
  return out;
}
/** Every (key, number) in an object, one level deep. */
export function numbers(data: Line): { key: string; n: number }[] {
  const out: { key: string; n: number }[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number') out.push({ key, n: value });
    else if (typeof value === 'object' && value !== null && !Array.isArray(value)) for (const [k, v] of Object.entries(value as Line)) if (typeof v === 'number') out.push({ key: `${key}.${k}`, n: v });
  }
  return out;
}

// ---- Sessions, their hook payloads and their transcripts, shaped like the corpus's (adapters/corpus/claude-code).
export type Mode = 'default' | 'bypassPermissions';
export interface Session { id: string; cwd: string; transcript: string; prompt?: string; agent: 'claude-code' | 'codex'; turn?: string; mode: Mode }
/** A fresh session: a work folder of its own. `mode` is the agent's permission mode as its hooks report it. */
export function newSession(h: Home, o: { agent?: 'claude-code' | 'codex'; mode?: Mode } = {}): Session {
  const id = randomUUID();
  const cwd = join(h.tmp, `w${tag(3)}`);
  mkdirSync(cwd, { recursive: true });
  const agent = o.agent ?? 'claude-code';
  const transcript = agent === 'codex'
    ? join(h.home, '.codex/sessions', `rollout-${id}.jsonl`)
    : join(h.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript, agent, mode: o.mode ?? 'default' };
}
export const callId = () => `toolu_${randomBytes(12).toString('hex')}`;
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: s.mode };
  if (s.agent === 'codex') {
    Object.assign(base, { model: 'gpt-reserve' });
    if (event !== 'SessionStart') base.turn_id = s.turn ?? (s.turn = randomUUID());
    if (event === 'SessionStart') base.source = 'startup';
    if (event === 'Stop') Object.assign(base, { stop_hook_active: false, last_assistant_message: 'Done.' });
    return { ...base, ...extra };
  }
  if (s.prompt) base.prompt_id = s.prompt;
  if (event === 'SessionStart') { Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); delete base.prompt_id; }
  if (event === 'Stop') Object.assign(base, { stop_hook_active: false, last_assistant_message: 'Done.' });
  if (event === 'SessionEnd') Object.assign(base, { reason: 'other' });
  return { ...base, ...extra };
}
export function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
/** The transcript entry Claude Code writes for a prompt a person typed (its origin fields); the turn's hooks carry its prompt ID. */
export function promptEntry(s: Session, text: string): string {
  const promptId = randomUUID();
  s.prompt = promptId;
  appendTranscript(s, { promptId, type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return promptId;
}
/** The assistant's reply text, as a transcript entry. */
export function assistantSays(s: Session, text: string): void {
  appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(6)}`, type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 10 } } });
}
export const transcriptEntries = (s: Session): Line[] => jsonLines(readFileSync(s.transcript, 'utf8'));
/** The lines the chat showed: every hook_system_message attachment of the transcript, in order (#80's desktop transcript). */
export const chatLines = (s: Session): string[] => transcriptEntries(s).filter((e) => e.type === 'attachment' && e.attachment?.type === 'hook_system_message').map((e) => String(e.attachment.content));

// ---- The Claude Code stand-in (fixtures/claude.mjs): one process per session.
export interface HookRun { command: string; async: boolean; asyncRewake: boolean; timeout: number; pid: number; invocation: string; session: string; started: number; ended: number | null; code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; expired: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; blocked?: string; shown?: string[]; model?: boolean; watch?: string[]; settingsError?: string }
export interface Wake { pid: number; session: string; code: number; at: number; stderr: string; dropped?: boolean; started?: number; prompt?: string; promptId?: string; fired?: Fired }
export interface FileChange { path: string; at: number; fired?: Fired; failed?: string }
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  readonly wakes: Wake[] = [];
  readonly fileChanges: FileChange[] = [];
  exited = false;
  private constructor(private readonly child: ChildProcess, readonly h: Home) {
    child.on('exit', () => { this.exited = true; for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (!line) return;
      if (typeof line.n === 'number') this.pending.get(line.n)?.(line);
      else if (line.wake) this.wakes.push(line.wake as Wake);
      else if (line.fileChanged) { const f = line.fileChanged as FileChange; this.fileChanges.push(f); for (const r of [...(f.fired?.ran ?? []), ...(f.fired?.background ?? [])]) startedGroups.add(r.pid); }
    });
  }
  get pid(): number { return this.child.pid!; }
  /** Claude Code for one session, HOME the test's home; `env` is added to what its hooks and its deep mcp get. */
  static start(h: Home, env: Record<string, string | undefined> = {}): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), h.co.cli, FACTS, h.hookLog], { cwd: h.tmp, env: childEnv(h, env), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Claude(child, h);
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
    const fired = (await this.send({ op: 'hook', event, payload: body, settings: settingsFile(this.h) })) as unknown as Fired;
    for (const r of [...fired.ran, ...fired.background]) startedGroups.add(r.pid);
    return fired;
  }
  async background(): Promise<(HookRun & { event: string })[]> { return (await this.send({ op: 'background' })).background as (HookRun & { event: string })[]; }
  async expire(seconds: number): Promise<(HookRun & { event: string })[]> { return (await this.send({ op: 'expire', seconds })).stopped as (HookRun & { event: string })[]; }
  async configure(o: { wake: boolean }): Promise<void> { await this.send({ op: 'configure', ...o }); }
  /** The paths Claude Code watches for FileChanged, from the replies that named them. */
  async watched(): Promise<string[]> { return (await this.send({ op: 'watched' })).watched as string[]; }
  /** The live asyncRewake runs of DeepBuild's waiter for a session: started by a hook, not yet exited, with a live process in their group. */
  async liveWaiters(session: string): Promise<(HookRun & { event: string })[]> {
    const table = processes();
    return (await this.background()).filter((r) => r.asyncRewake && isDeepBuild(r.command) && r.session === session && r.ended === null && groupOf(r.pid, table).length > 0);
  }
  /** A built-in tool call's first half: its tool_use entry and PreToolUse; the call is now running. */
  async open(s: Session, tool: string, input: Line): Promise<{ call: string; fired: Fired }> {
    const call = callId();
    appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(6)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: tool, input }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
    const fired = await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: call }));
    return { call, fired };
  }
  /** A built-in tool call's second half: its tool_result entry and PostToolUse; the call has ended. */
  async close(s: Session, call: string, tool: string, input: Line, response: Line): Promise<Fired> {
    appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    return this.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: tool, tool_input: input, tool_use_id: call, tool_response: response }));
  }
  /** A built-in tool call (Edit, Write, Bash), both halves. */
  async tool(s: Session, tool: string, input: Line, response: Line): Promise<string> {
    const { call } = await this.open(s, tool, input);
    await this.close(s, call, tool, input, response);
    return call;
  }
  /** The session ends: Claude Code stops its deep mcp and exits. */
  async end(): Promise<void> {
    const gone = new Promise<void>((resolve) => { if (this.exited) resolve(); else this.child.once('exit', () => resolve()); });
    await this.send({ op: 'end' }).catch(() => undefined);
    await gone;
  }
  quit(): void { try { this.child.kill('SIGTERM'); } catch { /* gone */ } }
}
export const ours = (runs: HookRun[]): HookRun[] => runs.filter((r) => isDeepBuild(r.command));
export const firedShown = (f: Fired | undefined) => (f ? JSON.stringify({ blocked: f.blocked, shown: f.shown, watch: f.watch, runs: [...f.ran, ...f.background].map((r) => ({ command: r.command.slice(0, 120), code: r.code, signal: r.signal, timedOut: r.timedOut, stdout: r.stdout.slice(0, 600), stderr: r.stderr.slice(0, 400) })) }) : 'nothing fired');
/** The JSON reply DeepBuild's synchronous entry printed for a hook, or undefined (an empty reply, or none). */
export function replyOf(f: Fired): Line | undefined {
  const entry = ours(f.ran).find((r) => !r.async);
  return entry ? parseObject(entry.stdout.trim()) : undefined;
}
/** The one line the chat shows for a hook's reply: its systemMessage (README: Where the line shows). */
export const lineOf = (f: Fired | undefined): string | undefined => f?.shown?.[0];
/** What a reply added for the agent to read: its additionalContext, or a block's reason. */
export function contextOf(f: Fired | undefined): string | undefined {
  if (!f) return undefined;
  const reply = replyOf(f);
  if (typeof reply?.hookSpecificOutput?.additionalContext === 'string') return reply.hookSpecificOutput.additionalContext;
  if (f.blocked) return f.blocked;
  return undefined;
}
/** The Bash tool's input and a result Claude Code records for a command that ran. */
export const bash = (command: string): Line => ({ command, description: command.split(' ').slice(0, 3).join(' ') });
export const ran = (stdout = 'ok'): Line => ({ stdout, stderr: '', interrupted: false, isImage: false });

/** A Claude Code session begun: SessionStart, then a prompt you typed and its UserPromptSubmit. */
export async function begin(h: Home, s: Session, prompt = 'Fix the cart total, then stop.', env: Record<string, string | undefined> = {}): Promise<{ claude: Claude; started: Fired }> {
  const claude = Claude.start(h, env);
  const started = await claude.hook('SessionStart', payload(s, 'SessionStart'));
  promptEntry(s, prompt);
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt }));
  return { claude, started };
}
/** Work in the turn: one Edit of a file in the session's folder, through its hooks. */
export async function edits(claude: Claude, s: Session, file = 'total.ts'): Promise<void> {
  const path = join(s.cwd, file);
  writeFileSync(path, 'export const total = (n: number) => n * 1.08;\n');
  await claude.tool(s, 'Edit', { file_path: path, old_string: 'n * 1.07', new_string: 'n * 1.08' }, { filePath: path, oldString: 'n * 1.07', newString: 'n * 1.08' });
}
/** The agent's last words and its Stop. */
export async function stop(claude: Claude, s: Session, said = 'Done: the cart total is fixed.'): Promise<Fired> {
  assistantSays(s, said);
  return claude.hook('Stop', payload(s, 'Stop', { last_assistant_message: said }));
}
/** A wake of the session the stand-in reported after `after` (ms): the waiter exited 2 and a turn began from it, nobody typing. */
export const wakeAfter = (claude: Claude, s: Session, after: number): Wake | undefined => claude.wakes.find((w) => w.session === s.id && !w.dropped && w.started !== undefined && w.started >= after);
/** A FileChanged the stand-in fired after `after` whose reply carried a line the terminal shows. */
export const notificationAfter = (claude: Claude, after: number): FileChange | undefined => claude.fileChanges.find((f) => f.at >= after && (f.fired?.shown?.length ?? 0) > 0);

// ---- Codex: its hooks run as Codex runs DeepBuild's entry, `deep-hook codex <event>` with the payload on stdin (README: Codex).
export interface CodexRun { ran: Ran; reply: Line | undefined }
export async function codexHook(h: Home, s: Session, event: string, extra: Line = {}): Promise<CodexRun> {
  const body = payload(s, event, extra);
  const r = await run(h.co.hook, ['codex', event], { cwd: s.cwd, env: childEnv(h), input: JSON.stringify(body), timeoutMs: 60_000 });
  writeFileSync(h.hookLog, `${JSON.stringify({ at: Date.now(), agent: 'codex', session: s.id, event, phase: 'reply', exit: r.code, ms: r.ended - r.started, reply: parseObject(r.stdout.trim()) ?? r.stdout.slice(0, 2000), ...(body.prompt !== undefined ? { prompt: body.prompt } : {}) })}\n`, { flag: 'a' });
  return { ran: r, reply: parseObject(r.stdout.trim()) };
}
export const codexShown = (r: CodexRun) => `exit ${r.ran.code}, stdout ${JSON.stringify(r.ran.stdout.slice(0, 800))}, stderr ${JSON.stringify(r.ran.stderr.slice(0, 400))}`;
/** The line Codex's chat shows for a reply: its `systemMessage`, or the first line of a block's reason. */
export function codexLineOf(r: CodexRun): string | undefined {
  if (typeof r.reply?.systemMessage === 'string') return r.reply.systemMessage;
  if (r.reply?.decision === 'block') return String(r.reply.reason ?? '').split('\n')[0];
  if (r.ran.code === 2) return r.ran.stderr.trim().split('\n')[0];
  return undefined;
}
/** What a Codex reply added for the model: its additionalContext, a block's reason, or its systemMessage. */
export const codexContextOf = (r: CodexRun): string | undefined => (typeof r.reply?.hookSpecificOutput?.additionalContext === 'string' ? r.reply.hookSpecificOutput.additionalContext : r.reply?.decision === 'block' ? String(r.reply.reason ?? '') : codexLineOf(r));
/** A Codex session begun: SessionStart and a prompt. */
export async function codexBegin(h: Home, s: Session, prompt = 'Fix the cart total, then stop.'): Promise<void> {
  await codexHook(h, s, 'SessionStart');
  await codexHook(h, s, 'UserPromptSubmit', { prompt });
}
export async function codexCall(h: Home, s: Session, command: string, response: Line = { stdout: 'ok', stderr: '', exit_code: 0 }): Promise<string> {
  const call = `call_${tag(6)}`;
  await codexHook(h, s, 'PreToolUse', { tool_name: 'Bash', tool_input: bash(command), tool_use_id: call });
  await codexHook(h, s, 'PostToolUse', { tool_name: 'Bash', tool_input: bash(command), tool_use_id: call, tool_response: response });
  return call;
}

// ---- Permission decisions a hook reply may carry (README: No permission decision).
/** The keys of a Claude Code PreToolUse reply that decide the call or change it; a reply that asks you as without DeepBuild has none. */
export function decisionsIn(reply: Line | undefined): string[] {
  if (!reply) return [];
  const out: string[] = [];
  if ('decision' in reply) out.push('decision');
  if ('continue' in reply && reply.continue === false) out.push('continue:false');
  const hso = reply.hookSpecificOutput;
  if (hso && typeof hso === 'object') for (const key of ['permissionDecision', 'permissionDecisionReason', 'decision', 'updatedPermissions']) if (key in hso) out.push(`hookSpecificOutput.${key}`);
  return out;
}
export const updatedInputOf = (reply: Line | undefined): Line | undefined => (reply?.hookSpecificOutput?.updatedInput && typeof reply.hookSpecificOutput.updatedInput === 'object' ? reply.hookSpecificOutput.updatedInput : undefined);

// ---- Raw hook request lines (hook.request@3), as deep-hook sends them, for the budgets (README: Budgets).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID whose time part is `ms`, as deep-hook mints one (the event's ID keeps it). */
export function ulid(ms: number): string {
  let time = '';
  let t = ms;
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  const bytes = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i]! % 32];
  return time + rand;
}
export interface RawReply { ack: Line | undefined; reply: Line | undefined; ms: number }
/** One hook request line over its own connection, the way deep-hook sends it: the hub's acknowledgement, then its reply. */
export function rawHook(hub: Hub, agent: string, event: string, body: Line, timeoutMs = 10_000): Promise<RawReply> {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const line = JSON.stringify({ v: 1, agent, event, seq: `${BigInt(now) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000))}`, id: ulid(now), pid: process.pid, ppid: process.ppid, matched: [], payload: body });
    const sock = net.connect(hub.socket);
    sock.setEncoding('utf8');
    let buffer = '';
    let ack: Line | undefined;
    let reply: Line | undefined;
    const t0 = performance.now();
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to the ${event} line within ${timeoutMs} ms`)); }, timeoutMs);
    const finish = () => { clearTimeout(timer); resolve({ ack, reply, ms: performance.now() - t0 }); };
    sock.on('connect', () => sock.write(`${line}\n`));
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const parsed = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (!parsed) continue;
        if ('ack' in parsed) ack = parsed;
        else if ('exit' in parsed || 'error' in parsed) { reply = parsed; sock.end(); finish(); return; }
      }
    });
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('close', () => { if (!reply) finish(); });
  });
}
/** The hook output a raw reply printed: its stdout parsed, or undefined. */
export const rawOutput = (r: RawReply): Line | undefined => (typeof r.reply?.stdout === 'string' ? parseObject(r.reply.stdout) : undefined);

// ---- Timing (README: Budgets): the reference-Mac gate, nearest-rank percentiles and the five-run judgement, as #83's suite reads them.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export const load = (): { one: number; cores: number } => ({ one: loadavg()[0]!, cores: availableParallelism() });
/**
 * Why this machine's readings only count as readings, or null: a reference Mac (Mac15,7 or Mac15,12) with Low Power
 * Mode off and a nominal thermal state, on battery or mains alike, and not loaded past its core count at any of the
 * `loads` taken around the measurement.
 */
export function environmentProblem(loads: { one: number; cores: number }[]): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const worst = loads.reduce((a, b) => (b.one / b.cores > a.one / a.cores ? b : a), loads[0] ?? { one: 0, cores: 1 });
  if (worst.one > worst.cores) return `heavy contention: 1-minute load ${worst.one.toFixed(1)} on ${worst.cores} cores`;
  return null;
}
export interface Judged { verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; text: string }
/** The design's rule for a timing result over five runs: PASS, FAIL, or INCONCLUSIVE when the runs straddle the limit by less than their spread. */
export function judge(name: string, runs: number[], limit: number, unit: string): Judged {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.abs(Math.min(...runs)), 1e-9);
  const margin = Math.max(0.05, Math.min(spread, 10));
  const text = `${name}: ${runs.map((r) => r.toFixed(2)).join(', ')} ${unit} against under ${limit} ${unit} (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.every((r) => r < limit)) return { verdict: 'PASS', text };
  if (runs.every((r) => r > limit * (1 + margin))) return { verdict: 'FAIL', text };
  return { verdict: 'INCONCLUSIVE', text };
}
export function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
/** Skips the test as INCONCLUSIVE, printing why, when the machine's readings don't count; returns otherwise. */
export function inconclusiveIfLoaded(ctx: TestContext, loads: { one: number; cores: number }[], what: string): void {
  const problem = environmentProblem(loads);
  if (!problem) return;
  console.log(`INCONCLUSIVE (${problem}): ${what}`);
  ctx.skip(`INCONCLUSIVE (${problem}): ${what}`);
}

// ---- The merge base's side (README: Budgets, the merge base), as #83's suite builds it.
const gitAt = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const sameAs = (sha: string, paths: string[]) => spawnSync('git', ['diff', '--quiet', sha, '--', ...paths], { cwd: REPO }).status === 0
  && gitAt('ls-files', '--others', '--exclude-standard', '--', ...paths) === '';
/**
 * The merge base with origin/main, built: this checkout when its code is the base's, else a copy from `git archive`
 * at /tmp/dh120-base-<sha>, kept between runs, with its workspaces built (its node_modules linked to this checkout's
 * when the lockfiles match, else `npm ci`) and its deep-hook (copied when crates/ is the base's, else built).
 */
export async function mergeBase(): Promise<Checkout> {
  let sha: string;
  try { sha = gitAt('merge-base', 'HEAD', 'origin/main'); } catch (e) { throw Error(`BLOCKED: no merge base with origin/main to compare with: ${(e as Error).message.split('\n')[0]}`); }
  const label = `the merge base ${sha.slice(0, 12)}`;
  if (sameAs(sha, ['packages', 'crates', 'Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json'])) return { ...CURRENT, label: `${label} (this checkout's own code)` };
  const dir = `/tmp/dh120-base-${sha.slice(0, 12)}`;
  const co: Checkout = { label, root: dir, cli: join(dir, 'packages/cli/dist/main.js'), hook: join(dir, 'target/debug/deep-hook') };
  if (existsSync(join(dir, '.built'))) return co;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync('/bin/sh', ['-c', `git -C '${REPO}' archive ${sha} | tar -x -C '${dir}'`], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  const step = async (what: string, command: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
    const r = await run(command, args, { cwd: dir, env, timeoutMs: 1_800_000 });
    if (r.code !== 0) throw Error(`BLOCKED: building ${label} for the comparison: ${what} failed: ${r.stderr.slice(-2000)}`);
  };
  if (gitAt('show', `${sha}:package-lock.json`) === readFileSync(join(REPO, 'package-lock.json'), 'utf8').trim()) {
    mkdirSync(join(dir, 'node_modules/@deepbuild'), { recursive: true });
    for (const entry of readdirSync(join(REPO, 'node_modules'))) if (entry !== '@deepbuild') symlinkSync(join(REPO, 'node_modules', entry), join(dir, 'node_modules', entry));
    for (const pkg of readdirSync(join(dir, 'packages'))) {
      const file = join(dir, 'packages', pkg, 'package.json');
      const name = existsSync(file) ? String((JSON.parse(readFileSync(file, 'utf8')) as Line).name ?? '') : '';
      if (name.startsWith('@deepbuild/')) symlinkSync(join(dir, 'packages', pkg), join(dir, 'node_modules/@deepbuild', name.slice('@deepbuild/'.length)));
    }
  } else {
    await step('npm ci', 'npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund']);
  }
  await step('npm run build --workspaces', 'npm', ['run', 'build', '--workspaces']);
  if (sameAs(sha, ['crates', 'Cargo.toml', 'Cargo.lock']) && existsSync(CURRENT.hook)) {
    mkdirSync(join(dir, 'target/debug'), { recursive: true });
    copyFileSync(CURRENT.hook, co.hook);
    chmodSync(co.hook, 0o755);
  } else {
    await step('cargo build -p deep-hook', 'cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { ...process.env, CARGO_TARGET_DIR: join(dir, 'target') });
  }
  writeFileSync(join(dir, '.built'), `${sha}\n`);
  return co;
}
