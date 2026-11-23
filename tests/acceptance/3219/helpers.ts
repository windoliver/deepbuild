// Test-side tools for #3219's acceptance tests (README: The surface under test): the criterion tags; deep-show and
// deep-hook built with cargo; a world (a temp home, its own hub as a process, a bin folder with `deep`, the `holder`
// stand-in and the `claude` stub); scripted Claude Code sessions, each its own stand-in agent process
// (fixtures/agent.mjs) that is the parent of its real deep-hook calls and of its shell commands, deep-show runs
// included; deep-show's scenarios (a kit on the GPU backend over the test module `test.kit.gpu`, and a short export of a
// film); the lease table read from the hub's record (`lease.acquired`, `lease.released`); a watch on the lease file
// `~/.cache/deepbuild-gpu/lease`; and the judges. Nothing here stands in for deep-show, the hub, `deep lease` or the
// lease table: every decision is read from what they answer or record.
//
// Copied, not imported (suites don't import each other): the environment, the cargo runner, deep-hook's build, the
// socket connection and `events.read` from tests/acceptance/18/mapping/helpers.ts; the world, the stand-in agent and the
// scripted Claude Code session from tests/acceptance/1015/helpers.ts; the kit reply's shape from
// tests/acceptance/138/helpers.ts; the export call, the film and the receipt's `lease` from tests/acceptance/157 and 501;
// the reference-Mac fingerprint and the timing rule from tests/acceptance/1097/helpers.ts. Same repo, same license.
//
// Safety: every folder is under /tmp/dh3219-* and removed after the file; each test has its own HOME, so nothing here
// touches this Mac's real hub, lease table or ~/.cache/deepbuild-gpu/lease; no network, no model, no real `claude`; a
// process a test starts is stopped by its PID or its process group's ID, never by name or port.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { cpus, homedir, loadavg } from 'node:os';
import net from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, type TestContext } from 'vitest';

// ---- Criterion tags: `#3219.<first 8 hex of the SHA-256 of the criterion's text, trimmed, white space collapsed>`, as
// scripts/budget-window.mjs computes them.
export const AC = {
  1: 'AC1 #3219.6dfa18b9',
  2: 'AC2 #3219.150005e0',
  3: 'AC3 #3219.2c286a34',
  4: 'AC4 #3219.a0eeff4a',
  5: 'AC5 #3219.3e5e1a25',
  6: 'AC6 #3219.b9bc7bce',
  7: 'AC7 #3219.018fc9c7',
} as const;

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const TARGET = process.env.CARGO_TARGET_DIR ? resolve(REPO, process.env.CARGO_TARGET_DIR) : join(REPO, 'target');
export const DEEP_HOOK = join(TARGET, 'debug', 'deep-hook');
/** deep-show's build: the full set, with the test canvas module `test.kit.gpu` (#138), whose two fixtures a GPU pass fills. */
export const SHOW_FEATURES = 'full,test-kit-gpu-pass';
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
/**
 * Resolves after `ms`. Every caller races it against the event it waits for (a process's end, a table event, an output
 * line, a file event), so all it can do is turn a hang into a result: this suite has no fixed wait (scripts/wait-ratchet.mjs).
 */
export function bound(ms: number): Promise<void> {
  // deadline: only ever raced against the event a test waits for; it bounds that wait and never waits on its own.
  return new Promise<void>((done) => { setTimeout(done, ms).unref(); });
}
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
export const show = (v: unknown, n = 1200): string => JSON.stringify(v)?.slice(0, n) ?? String(v);
export const letters = (s: string): string => s.replace(/[^0-9A-Za-z]/g, '');
const q = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;

// ---- Temp folders (short real paths under /tmp: a Unix socket path must fit in 104 bytes on macOS) and processes.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh3219-'));
  made.push(dir);
  return dir;
}
const children = new Set<ChildProcess>();
const groups = new Set<number>();
const goDirs = new Set<string>();
const gone = (c: ChildProcess): boolean => c.exitCode !== null || c.signalCode !== null;
/** A child's exit, as an event. */
export const exitOf = (c: ChildProcess): Promise<void> => (gone(c) ? Promise.resolve() : new Promise((done) => c.once('exit', () => done())));
/** Every go file written; every process group and child this file started continued, stopped by its ID; every folder removed. */
export async function cleanup(): Promise<void> {
  for (const dir of goDirs) try { writeFileSync(join(dir, 'all'), 'go'); } catch { /* gone */ }
  // A group a test stopped (SIGSTOP) holds a SIGTERM until it runs again.
  for (const pgid of groups) try { process.kill(-pgid, 'SIGCONT'); } catch { /* gone */ }
  for (const pgid of groups) try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ }
  for (const child of children) if (!gone(child)) try { child.kill('SIGCONT'); child.kill('SIGTERM'); } catch { /* gone */ }
  await Promise.race([Promise.all([...children].map(exitOf)), bound(5000)]);
  for (const pgid of groups) try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
  for (const child of children) if (!gone(child)) try { child.kill('SIGKILL'); } catch { /* gone */ }
  await Promise.race([Promise.all([...children].map(exitOf)), bound(5000)]);
  children.clear();
  groups.clear();
  goDirs.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
afterAll(cleanup, 120_000);
/** A process group this file started, stopped (SIGSTOP) or continued (SIGCONT) by its ID. */
export const stopGroup = (pgid: number): void => { try { process.kill(-pgid, 'SIGSTOP'); } catch { /* gone */ } };
export const continueGroup = (pgid: number): void => { try { process.kill(-pgid, 'SIGCONT'); } catch { /* gone */ } };
/** Whether a process still runs (a stopped one does). */
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Variables that mark which agent runs a hook, or bill an API account: a child never inherits this process's. */
const MARKERS = /^(CLAUDE|CURSOR|GROK|CODEX|ANTHROPIC|OPENAI|AWS_BEARER|DEEP_|XDG_)/;
/** The environment a child gets: this one with HOME moved to the test's home and no agent markers, billing keys or DEEP_ settings. */
export function cleanEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (MARKERS.test(key) || key === 'AI_AGENT' || key === 'NODE_OPTIONS' || key.startsWith('GIT_') || key === 'MAKEFLAGS' || key === 'CARGO_MAKEFLAGS') continue;
    env[key] = value;
  }
  env.HOME = home;
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

interface Ran { code: number | null; stdout: string; stderr: string }
/** Runs a command to its end without blocking this process's event loop. */
function runTo(command: string, args: readonly string[], o: { cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 3_600_000); // deadline: a build that never ends is stopped, and the test fails on what cargo printed
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
    child.on('error', (e) => { clearTimeout(timer); done({ code: null, stdout, stderr: `${stderr}${e.message}` }); });
  });
}

// ---- Builds, once per file: deep-hook with the planted programs a test selects with DEEP_HUB_PLANT (#1408), and
// deep-show with SHOW_FEATURES, copied out of the target folder (README: Run them).
let hookBuilt: Promise<string> | undefined;
export function deepHook(): Promise<string> {
  hookBuilt ??= runTo('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', '--features', 'env-plants']).then((r) => {
    if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
    return DEEP_HOOK;
  });
  return hookBuilt;
}
let showBuilt: Promise<string> | undefined;
/**
 * deep-show built with SHOW_FEATURES and copied into this file's own folder; a build that fails fails the test, naming
 * cargo's error. Every test here draws on the GPU through deep-show (kits on the GPU backend, H.264 exports), which
 * draws through macOS's Metal device: elsewhere the test fails here with a message starting INCONCLUSIVE, never passes.
 */
export function deepShow(): Promise<string> {
  if (process.platform !== 'darwin') return Promise.reject(Error(`INCONCLUSIVE: this machine runs ${process.platform}; deep-show's kits on the GPU backend and its H.264 exports draw through macOS's Metal device`));
  showBuilt ??= runTo('cargo', ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', SHOW_FEATURES]).then((r) => {
    if (r.code !== 0) throw Error(`cargo build --bin deep-show --features ${SHOW_FEATURES} failed: ${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-3000)}`);
    const bin = join(tempDir(), 'deep-show');
    copyFileSync(join(TARGET, 'debug', 'deep-show'), bin);
    return bin;
  });
  return showBuilt;
}

// ---- The hub's socket (#16): a cli connection with the control token, and the record's events.
export interface Hub { home: string; root: string; socket: string; pid: number; plant?: string; stderr(): string }
export class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private readonly wakers = new Set<() => void>();
  private ids = 0;
  ended = false;
  /** Called with each event a `stream.subscribe` on this connection carries. */
  onEvent: ((event: Ev) => void) | undefined;
  private constructor(readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = parseObject(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) };
        this.buffer = this.buffer.slice(i + 1);
        if (line.event && typeof line.event === 'object' && !('result' in line)) this.onEvent?.(line.event as Ev);
        else this.lines.push(line);
      }
      for (const w of [...this.wakers]) w();
    });
    const end = () => { this.ended = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  static open(path: string, timeoutMs = 10_000): Promise<Conn> {
    return new Promise((done, fail) => {
      const conn = new Conn(net.connect(path));
      // deadline: a hub that never says hello turns into a failure naming its socket.
      const timer = setTimeout(() => { conn.sock.destroy(); fail(Error(`no hello from the hub at ${path}`)); }, timeoutMs);
      const check = () => {
        if (conn.lines.length > 0) { clearTimeout(timer); conn.wakers.delete(check); done(conn); }
        else if (conn.ended) { clearTimeout(timer); conn.wakers.delete(check); fail(Error(`can't reach the hub at ${path}`)); }
      };
      conn.wakers.add(check);
    });
  }
  private wait(match: (line: Line) => boolean, from: number, timeoutMs: number): Promise<Line | undefined> {
    return new Promise((done) => {
      const finish = (v: Line | undefined) => { clearTimeout(timer); this.wakers.delete(check); done(v); };
      const check = () => { const found = this.lines.slice(from).find(match); if (found) finish(found); else if (this.ended) finish(undefined); };
      const timer = setTimeout(() => finish(undefined), timeoutMs); // deadline: a reply that never comes turns into a failure naming the call
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
async function connect(hub: Hub): Promise<Conn> {
  const conn = await Conn.open(hub.socket);
  await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
  return conn;
}
/** One event as `events.read` returns it. */
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; data: Line }

// ---- The lease table, folded from the record's `lease.acquired` and `lease.released` events (#237).
/**
 * One lease: its ID (the `lease.acquired` event's subject, `lease:<ULID>`), resource, mode, holder and run; `at`, the
 * time it was granted (that event's `ts`, ms since the Unix epoch); `asked`, when it was asked for, as the table records
 * it (README: the table's `asked`, chosen); and `released`, its `lease.released` event's `ts`.
 */
export interface LeaseRow { id: string; kind: string; key: string; mode: string; holder: string; run?: string; at: number; asked?: number; released?: number }
/**
 * The table as the hub records it, followed as it changes: one `stream.subscribe` on a cli connection from the record's
 * start, each event folded as its frame arrives, so a test waits for the table event it needs, never polls for it.
 * `read` is the table so far, after an `events.read` of whatever the stream hasn't carried yet.
 */
export class Table {
  private conn: Conn | undefined;
  private opened: Promise<void> | undefined;
  private after = 0;
  private readonly rows = new Map<string, LeaseRow>();
  private readonly watchers = new Set<() => void>();
  constructor(readonly hub: Hub) {}
  private open(): Promise<void> {
    this.opened ??= (async () => {
      const conn = await connect(this.hub);
      conn.onEvent = (e) => this.take([e]);
      this.conn = conn;
      await conn.call('stream.subscribe', { after: 0 });
    })();
    return this.opened;
  }
  private take(events: readonly Ev[]): void {
    for (const e of events) {
      if (typeof e.log_pos === 'number' && e.log_pos <= this.after) continue;
      this.fold(e);
      if (typeof e.log_pos === 'number') this.after = e.log_pos;
    }
    for (const w of [...this.watchers]) w();
  }
  /** The table so far: the stream's events, and any the record holds past them. */
  async read(): Promise<LeaseRow[]> {
    await this.open();
    for (;;) {
      const events = (await this.conn!.call('events.read', { after: this.after, limit: 1000 })).events as Ev[];
      if (!events.length) break;
      this.take(events);
    }
    return [...this.rows.values()];
  }
  /** Calls `watch` with the table at once and after each event, until it returns true; resolves with the rows then. */
  async until(watch: (rows: LeaseRow[]) => boolean, ms: number): Promise<boolean> {
    if (watch(await this.read())) return true;
    let fn: () => void = () => undefined;
    const held = new Promise<boolean>((done) => { fn = () => { if (watch([...this.rows.values()])) done(true); }; this.watchers.add(fn); });
    const result = await Promise.race([held, bound(ms).then(() => false)]);
    this.watchers.delete(fn);
    return result || watch(await this.read());
  }
  private fold(e: Ev): void {
    if (e.kind === 'lease.acquired') {
      const r = e.data.resource as Line | undefined;
      const id = String(e.subject ?? e.id);
      this.rows.set(id, {
        id, kind: String(r?.kind), key: String(r?.key), mode: String(e.data.mode), holder: String(e.data.holder), at: e.ts,
        ...(e.data.run ? { run: String(e.data.run) } : {}), ...(typeof e.data.asked === 'number' ? { asked: e.data.asked } : {}),
      });
    }
    if (e.kind === 'lease.released') {
      const row = this.rows.get(String(e.subject));
      if (row && row.released === undefined) row.released = e.ts;
    }
  }
  close(): void { this.conn?.close(); this.conn = undefined; }
}
export const gpuRows = (rows: readonly LeaseRow[]): LeaseRow[] => rows.filter((r) => r.kind === 'gpu');
export const shownRows = (rows: readonly LeaseRow[]): string =>
  rows.map((r) => `${r.id} ${r.kind}/${r.key} ${r.mode} by ${r.holder}${r.asked !== undefined ? ` asked ${r.asked}` : ''} granted ${r.at}${r.released !== undefined ? ` released ${r.released}` : ' (held)'}`).join('; ') || 'none';

// ---- The world: a home, its hub, and the commands sessions run.
export class World {
  readonly dir = tempDir();
  readonly home = join(this.dir, 'h');
  readonly bin = join(this.dir, 'bin');
  readonly root = join(this.home, '.deepbuild');
  /** Where the holder stand-in reads `go/<label>`. */
  readonly runs = join(this.dir, 'runs');
  hub: Hub | undefined;
  private hubChild: ChildProcess | undefined;
  constructor(readonly o: { plant?: string } = {}) {
    mkdirSync(join(this.home, '.claude'), { recursive: true });
    mkdirSync(this.bin);
    mkdirSync(join(this.runs, 'go'), { recursive: true });
    goDirs.add(join(this.runs, 'go'));
    // `deep` as an installed CLI is: the built CLI on PATH.
    writeFileSync(join(this.bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`, { mode: 0o755 });
    writeFileSync(join(this.bin, 'holder'), readFileSync(join(FIXTURES, 'holder.pl'), 'utf8').replaceAll('__DIR__', this.runs));
    chmodSync(join(this.bin, 'holder'), 0o755);
    // The hub reads the sessions' Claude Code home with `claude plugin list --json`: a home with no plugins.
    writeFileSync(join(this.bin, 'claude'), `#!/bin/sh\n[ "$1 $2" = "plugin list" ] && echo '[]'\nexit 0\n`, { mode: 0o755 });
  }
  /** deep-show's lease file in this home: `~/.cache/deepbuild-gpu/lease` (crates/deep-show/src/kit/goldens.rs, `GpuLease`). */
  get leaseFile(): string { return join(this.home, '.cache', 'deepbuild-gpu', 'lease'); }
  /** The environment of the hub, of every hook and of every command a session runs, with `extra` on top. */
  env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return cleanEnv(this.home, {
      PATH: `${this.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      SHELL: '/bin/sh',
      // A temporary HOME would leave rustup and Cargo homeless: theirs stay put.
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
      CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
      DEEP_HUB_TEST_CORES: '12',
      DEEP_HUB_PLANT: this.o.plant,
      ...extra,
    });
  }
  /** `deep hub run` for this home. A hub that doesn't start fails the test here, naming the plant when one is set. */
  async startHub(): Promise<Hub> {
    if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
    await deepHook();
    const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    children.add(child);
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    const ready = await new Promise<Line | undefined>((done) => {
      let first = '';
      const timer = setTimeout(() => done(undefined), 120_000); // deadline: a hub that never says it is ready fails the start, naming its stderr
      child.stdout!.setEncoding('utf8').on('data', (d: string) => { first += d; if (first.includes('\n')) { clearTimeout(timer); done(parseObject(first.split('\n')[0]!)); } });
      child.on('exit', () => { clearTimeout(timer); done(undefined); });
    });
    if (!ready || ready.ready !== true) {
      expect.fail(`the hub didn't start${this.o.plant ? ` with DEEP_HUB_PLANT=${this.o.plant} (the planted wrong program this test runs against)` : ''}: ${err.slice(0, 1500)}`);
    }
    this.hubChild = child;
    this.hub = { home: this.home, root: this.root, socket: String(ready!.socket), pid: child.pid!, ...(this.o.plant ? { plant: this.o.plant } : {}), stderr: () => err };
    return this.hub;
  }
  /** Stops the hub by its PID and waits for it to exit. */
  async stopHub(): Promise<void> {
    const child = this.hubChild;
    if (!child) return;
    try { process.kill(child.pid!, 'SIGTERM'); } catch { /* gone */ }
    await Promise.race([exitOf(child), bound(30_000)]);
    if (!gone(child)) try { process.kill(child.pid!, 'SIGKILL'); } catch { /* gone */ }
    this.hub = undefined;
    this.hubChild = undefined;
  }
  /** Lets the holder labelled `label` end. */
  go(label: string): void { writeFileSync(join(this.runs, 'go', label), 'go'); }
  /** A plain folder named `name`, as a session's working folder. */
  folder(name: string): string {
    const dir = join(this.dir, name);
    mkdirSync(dir, { recursive: true });
    return realpathSync(dir);
  }
}

// ---- The stand-in agent process and a scripted Claude Code session.
export interface Hooked { code: number | null; stdout: string; stderr: string; ms: number }
/** A shell command's end: its exit, its output, and when it started and ended (ms since the Unix epoch, the agent's clock). */
export interface Ended { code: number | null; signal: string | null; output: string; pid: number; t0: number; t1: number }
/**
 * A shell command the session's agent runs: its shell's PID (its process group's ID), its output so far (stdout and
 * stderr, in order), its end, and `said`, which resolves true once its output matches, false once it ended without
 * matching or `ms` passed.
 */
export interface Bash { command: string; pid: Promise<number>; output(): string; done: Promise<Ended>; finished(): boolean; said(re: RegExp, ms: number): Promise<boolean> }
interface Stream { pid?: (p: number) => void; output: string; heard: Set<() => void> }
class Agent {
  private readonly child: ChildProcess;
  private readonly waiting = new Map<number, (l: Line) => void>();
  private readonly streams = new Map<number, Stream>();
  private n = 0;
  constructor(env: NodeJS.ProcessEnv) {
    this.child = spawn(NODE, [join(FIXTURES, 'agent.mjs')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
    children.add(this.child);
    createInterface({ input: this.child.stdout! }).on('line', (raw) => {
      const l = parseObject(raw);
      if (!l || typeof l.n !== 'number') return;
      const s = this.streams.get(l.n);
      if (typeof l.started === 'number') { groups.add(l.started); s?.pid?.(l.started); }
      if (typeof l.output === 'string' && s) { s.output += l.output; for (const h of [...s.heard]) h(); }
      if (l.done) { this.waiting.get(l.n)?.(l); if (s) for (const h of [...s.heard]) h(); }
    });
  }
  private send(command: Line): { n: number; reply: Promise<Line> } {
    const n = ++this.n;
    const reply = new Promise<Line>((done) => this.waiting.set(n, done));
    this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    return { n, reply };
  }
  async hook(agent: string, event: string, payload: Line, cwd: string, env: NodeJS.ProcessEnv): Promise<Hooked> {
    const l = await this.send({ op: 'hook', binary: await deepHook(), agent, event, payload, cwd, env }).reply;
    if (l.failed) throw Error(`the stand-in agent couldn't run deep-hook: ${String(l.failed)}`);
    return { code: l.code as number | null, stdout: String(l.stdout ?? ''), stderr: String(l.stderr ?? ''), ms: Number(l.ms) };
  }
  bash(command: string, cwd: string, env: NodeJS.ProcessEnv): Bash {
    const n = this.n + 1;
    const stream: Stream = { output: '', heard: new Set() };
    const pid = new Promise<number>((done) => { stream.pid = done; });
    this.streams.set(n, stream);
    let over = false;
    const { reply } = this.send({ op: 'bash', command, cwd, env });
    const done = reply.then((l) => {
      over = true;
      return { code: l.code as number | null, signal: (l.signal as string | null) ?? null, output: String(l.output ?? stream.output), pid: Number(l.pid), t0: Number(l.t0), t1: Number(l.t1) };
    });
    const said = async (re: RegExp, ms: number): Promise<boolean> => {
      let fn: () => void = () => undefined;
      const heard = new Promise<boolean>((resolve) => {
        fn = () => { if (re.test(stream.output)) resolve(true); else if (over) resolve(false); };
        stream.heard.add(fn);
        // The command's end, once `over` is set.
        void done.then(() => fn());
        fn();
      });
      const result = await Promise.race([heard, bound(ms).then(() => false)]);
      stream.heard.delete(fn);
      return result;
    };
    return { command, pid, output: () => stream.output, done, finished: () => over, said };
  }
  stop(): void { try { this.child.stdin!.write(`${JSON.stringify({ n: 0, op: 'exit' })}\n`); } catch { /* gone */ } }
}

const CLAUDE_VERSION = '2.1.304';
const MODEL = 'claude-haiku-5-5';
/**
 * One scripted Claude Code session (payloads and transcript as Claude Code 2.1.304 writes them, in bypassPermissions
 * mode, as an unattended scripted session runs), in its own folder `name`; its own stand-in agent process is the parent
 * of its hooks and of its commands, so the hub finds it above each command it runs.
 */
export class Session {
  readonly id = randomUUID();
  readonly cwd: string;
  private readonly agent: Agent;
  private readonly transcript: string;
  private parent: string | null = null;
  private promptId: string | undefined;
  constructor(readonly w: World, readonly name: string) {
    this.cwd = w.folder(name);
    this.agent = new Agent(w.env());
    this.transcript = join(w.home, '.claude/projects', this.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
  }
  /** The lease table's holder for this session: `session:<its ID's letters and digits>` (#1015). */
  get holder(): string { return `session:${letters(this.id)}`; }
  /** The environment the agent gives its hooks and its shell commands. */
  env(): NodeJS.ProcessEnv {
    return this.w.env({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: this.cwd });
  }
  private entry(value: Line): void {
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: CLAUDE_VERSION, gitBranch: 'main' };
    this.parent = uuid;
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  hook(event: string, fields: Line = {}): Promise<Hooked> {
    const payload: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, ...(this.promptId ? { prompt_id: this.promptId } : {}), permission_mode: 'bypassPermissions', effort: { level: 'medium' }, hook_event_name: event, ...fields };
    return this.agent.hook('claude-code', event, payload, this.cwd, this.env());
  }
  /** SessionStart, then your prompt (its transcript entry first), then UserPromptSubmit. */
  async begin(prompt = 'Run the canvas kit on the GPU and export the film.'): Promise<void> {
    await this.hook('SessionStart', { source: 'startup', model: MODEL });
    this.promptId = randomUUID();
    this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: prompt }, origin: { kind: 'human' }, turnOrigin: 'human', turnPosition: { promptIndex: 1, turnIndex: 1 } });
    await this.hook('UserPromptSubmit', { prompt });
  }
  /** The agent runs `command` with its shell tool, in the session's folder, with `env` on top of the session's. */
  run(command: string, env: Record<string, string> = {}): Bash {
    const id = `toolu_${randomBytes(12).toString('hex')}`;
    this.entry({ type: 'assistant', message: { model: MODEL, id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }], stop_reason: 'tool_use', usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 } } });
    return this.agent.bash(command, this.cwd, { ...this.env(), ...env });
  }
  stop(): void { this.agent.stop(); }
}

// ---- deep-show's scenarios (README: The surface under test).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonObject = { [key: string]: any };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB3219D', 1);
const YOU_PEER = { pid: 3002, start: 3_000 };
/** The scenario's own process table (#501's): your terminal, your shell, and the `deep show` you ran, which presents the film. */
const PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
/** The kit call every test runs: the test module `test.kit.gpu`'s fixtures on the GPU backend alone (#138). */
export const KIT_CALL: JsonObject = { call: 'kit', modules: ['test.kit.gpu'], parts: ['fixtures'], backends: ['gpu'] };
function scenario(evidence: string, calls: JsonObject[], planted?: string): JsonObject {
  return { evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } }, ...(planted ? { planted } : {}), calls };
}
/** A scenario of one kit call; `planted` names a deep-show wrong program. */
export const kitScenario = (evidence: string, planted?: string): JsonObject => scenario(evidence, [KIT_CALL], planted);
/** A 160 × 90 film at 24 fps, `frames` long: a ground and a block sliding across it, so every frame differs (after #501's). */
export function film(frames: number): JsonObject {
  const rect = (id: string, box: number[], role: string, order: string): JsonObject => ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } } });
  const span = `${frames / 24}s`;
  return {
    format: 1, id: 'film-3219', profile: 'film', title: 'A GPU lease film', description: 'The film the #3219 acceptance tests export.', size: [160, 90],
    items: Object.fromEntries([
      { id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [80, 45, 0], view_width: 160 } },
      rect('back', [0, 0, 160, 90], 'ground', 'a1'), rect('mover', [0, 30, 20, 30], 'accent', 'a2'),
    ].map((i) => [String(i.id), i])),
    camera: 'cam', transport: { span, frame_rate: [24, 1] },
    channels: { slide: { target: 'items/mover/params/box/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: span, value: 140, interp: 'linear' } } } },
  };
}
/** A scenario that presents the film and exports it as H.264 to `out` (#157's export call, no `session`: the hub names the caller). */
export const exportScenario = (evidence: string, out: string, frames: number, planted?: string): JsonObject =>
  scenario(evidence, [{ call: 'deep show', peer: YOU_PEER, doc: DOC, document: film(frames), include: ['issues'] }, { call: 'export', doc: DOC, out, video: { codec: 'h264' } }], planted);

// ---- deep-show runs: as a session's shell command, or (with no hub) as this process's child.
/** A deep-show run's end: the shell's exit and times, the one answer line, and stderr. */
export interface ShowEnd extends Ended { answer: Line | undefined; stdout: string; stderr: string; label: string }
/** A deep-show run: its PID (its process group's ID), its end, its stderr so far, and `said` on its stderr (Bash's). */
export interface ShowRun { label: string; pid: Promise<number>; done: Promise<ShowEnd>; finished(): boolean; stderr(): string; said(re: RegExp, ms: number): Promise<boolean> }
let runs = 0;
/**
 * `deep-show run` with the scenario on stdin, as `session`'s shell command: `exec`, so the shell's PID (its process
 * group's ID) is deep-show's, its stdout (the answer line) to a file, its stderr to the agent as the command's output,
 * and `env` on top of the session's environment. `delay` seconds, when given, are the shell's own `sleep` before it
 * runs deep-show: a wait the criterion itself sets (AC3's "1 s later"), not one this suite waits on.
 */
export function showIn(s: Session, bin: string, sc: JsonObject, label: string, o: { env?: Record<string, string>; delay?: number } = {}): ShowRun {
  const dir = join(s.w.dir, 'show', `${++runs}-${label.replace(/[^A-Za-z0-9-]/g, '-')}`);
  mkdirSync(dir, { recursive: true });
  const [input, out] = ['in.json', 'out.json'].map((f) => join(dir, f)) as [string, string];
  writeFileSync(input, `${JSON.stringify(sc)}\n`);
  const bash = s.run(`cd ${q(REPO)} && ${o.delay ? `sleep ${o.delay} && ` : ''}exec ${q(bin)} run < ${q(input)} > ${q(out)}`, o.env ?? {});
  const read = (f: string): string => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
  const done = bash.done.then((e) => {
    const stdout = read(out);
    return { ...e, label, stdout, stderr: e.output, answer: parseObject(stdout.split('\n').find((l) => l.trim()) ?? '') };
  });
  return { label, pid: bash.pid, done, finished: bash.finished, stderr: bash.output, said: bash.said };
}
/** `deep-show run` as this process's own child, with `env` (no session: a home with no hub). */
export function showDirect(bin: string, sc: JsonObject, label: string, env: NodeJS.ProcessEnv): ShowRun {
  const child = spawn(bin, ['run'], { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  children.add(child);
  if (child.pid) groups.add(child.pid);
  const t0 = Date.now();
  let stdout = '';
  let stderr = '';
  let over = false;
  child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  child.stdin!.on('error', () => undefined);
  child.stdin!.end(`${JSON.stringify(sc)}\n`);
  let t1 = 0;
  child.on('exit', () => { t1 = Date.now(); });
  const done = new Promise<ShowEnd>((finish) => child.on('close', (code, signal) => {
    over = true;
    finish({ code, signal, output: stdout + stderr, pid: child.pid!, t0, t1: t1 || Date.now(), label, stdout, stderr, answer: parseObject(stdout.split('\n').find((l) => l.trim()) ?? '') });
  }));
  const said = async (re: RegExp, ms: number): Promise<boolean> => {
    let fn: () => void = () => undefined;
    const heard = new Promise<boolean>((resolve) => {
      fn = () => { if (re.test(stderr)) resolve(true); else if (over) resolve(false); };
      child.stderr!.on('data', fn);
      void done.then(fn);
      fn();
    });
    const result = await Promise.race([heard, bound(ms).then(() => false)]);
    child.stderr!.off('data', fn);
    return result;
  };
  return { label, pid: Promise.resolve(child.pid!), done, finished: () => over, stderr: () => stderr, said };
}
/** A run's end, or a stand-in end that says it didn't end within `ms` (the run is stopped by its group's ID after the file). */
export async function ended(run: ShowRun, ms: number): Promise<ShowEnd> {
  const timedOut = bound(ms).then((): ShowEnd => ({ code: null, signal: 'still running', output: '', pid: 0, t0: 0, t1: Infinity, label: run.label, stdout: '', stderr: run.stderr(), answer: undefined }));
  return Promise.race([run.done, timedOut]);
}
/** Why a run gave no answer this suite can read, or null: it exited 0 with one `ok` answer holding `calls` replies. */
export function unanswered(e: ShowEnd, calls: number): string | null {
  if (e.code !== 0) return `${e.label}: deep-show run exited ${e.code ?? e.signal}; stdout ${e.stdout.slice(0, 600)}; stderr ${e.stderr.slice(-1200)}`;
  if (!e.answer || e.answer.ok !== true || !Array.isArray(e.answer.replies)) return `${e.label}: deep-show run didn't answer the scenario ok: ${e.stdout.slice(0, 600)}`;
  if (e.answer.replies.length !== calls) return `${e.label}: deep-show run answered ${e.answer.replies.length} replies for ${calls} calls`;
  return null;
}

/** What a kit reply says (#138's report): its verdict, its `lease`, and its cases on the GPU backend. */
export interface KitSeen { verdict: string; lease: Line; gpu: { case: string; verdict: string; probe?: string }[]; drew: boolean; blocked: boolean; raw: Line }
/** The kit's reply, or the reason it has none. A GPU case drew when its verdict is PASS or FAIL; it is BLOCKED when it didn't. */
export function kitOf(e: ShowEnd): KitSeen | string {
  const why = unanswered(e, 1);
  if (why) return why;
  const r = e.answer!.replies[0] as Line;
  if (typeof r !== 'object' || r === null || !Array.isArray(r.modules)) return `${e.label}: the kit's reply has no modules: ${show(r)}`;
  const gpu: KitSeen['gpu'] = [];
  for (const m of r.modules as Line[]) for (const p of (m.parts ?? []) as Line[]) for (const c of (p.cases ?? []) as Line[]) {
    if (c.backend === 'gpu') gpu.push({ case: String(c.case), verdict: String(c.verdict), ...(typeof c.probe === 'string' ? { probe: c.probe } : {}) });
  }
  return {
    verdict: String(r.verdict), lease: (typeof r.lease === 'object' && r.lease !== null ? r.lease : {}) as Line, gpu,
    drew: gpu.some((c) => c.verdict === 'PASS' || c.verdict === 'FAIL'), blocked: gpu.length > 0 && gpu.every((c) => c.verdict === 'BLOCKED'), raw: r,
  };
}
/** The export's receipt `lease` record (#157), or the reason there is none. */
export interface ReceiptLease { id?: string; asked?: number; acquired?: number; released?: number; holder?: string; raw: Line }
export function receiptLeaseOf(e: ShowEnd): ReceiptLease | string {
  const why = unanswered(e, 2);
  if (why) return why;
  const [shown, exported] = e.answer!.replies as Line[];
  if (shown?.outcome !== 'presented') return `${e.label}: the film wasn't presented: ${show(shown)}`;
  if (exported?.outcome !== 'exported') return `${e.label}: the film wasn't exported: ${show(exported)}`;
  const l = exported.receipt?.lease;
  if (typeof l !== 'object' || l === null) return `${e.label}: the receipt has no lease record: ${show(exported.receipt, 600)}`;
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  return {
    ...(typeof l.id === 'string' ? { id: l.id } : {}), ...(num(l.asked) !== undefined ? { asked: l.asked } : {}),
    ...(num(l.acquired) !== undefined ? { acquired: l.acquired } : {}), ...(num(l.released) !== undefined ? { released: l.released } : {}),
    ...(typeof l.holder === 'string' ? { holder: l.holder } : {}), raw: l,
  };
}

// ---- The lease file, watched: every sighting of `~/.cache/deepbuild-gpu/lease` while the watch runs.
export interface Sighting { at: number; pid: string | null }
/**
 * Watches the lease file through its folder with fs.watch, which reports the file made, written or removed however
 * briefly it lived: each event is a sighting, with the PID the file held when it was read (null when it was already gone
 * or empty). A file there when the watch starts is a sighting too. The folder is made first, so the watch can start;
 * making it takes no lease.
 */
export class LeaseFileWatch {
  readonly seen: Sighting[] = [];
  private readonly watcher: FSWatcher;
  private readonly heard = new Set<() => void>();
  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    const look = (named: boolean): void => {
      let pid: string | null = null;
      try { pid = readFileSync(file, 'utf8').trim() || null; } catch { if (!named) return; /* gone, or never there */ }
      this.seen.push({ at: Date.now(), pid });
      for (const h of [...this.heard]) h();
    };
    this.watcher = watch(dirname(file), (_event, name) => { if (name === null || name === basename(file)) look(true); });
    look(false);
  }
  /** Resolves true once a sighting holds `pid`, false after `ms`. */
  async holds(pid: string, ms: number): Promise<boolean> {
    let fn: () => void = () => undefined;
    const heard = new Promise<boolean>((resolve) => { fn = () => { if (this.seen.some((s) => s.pid === pid)) resolve(true); }; this.heard.add(fn); fn(); });
    const result = await Promise.race([heard, bound(ms).then(() => false)]);
    this.heard.delete(fn);
    return result;
  }
  stop(): void { this.watcher.close(); }
  pids(): string[] { return [...new Set(this.seen.map((s) => s.pid).filter((p): p is string => Boolean(p)))]; }
}

// ---- Judges.
/** Runs `check` and returns the message of the assertion it fails, or null when it passes. */
export async function failureOf(check: () => unknown): Promise<string | null> {
  try {
    await check();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
/** Fails with every failure listed, so the message names everything that went wrong. */
export function none(failures: readonly string[], what: string): void {
  if (failures.length) expect.fail(`${what}:\n- ${failures.join('\n- ')}`);
}
/** Runs `assertion` against a planted wrong program: it must fail, and its message must name each of `names`. */
export async function mustFail(what: string, assertion: () => unknown, names: readonly string[]): Promise<string> {
  const message = await failureOf(assertion);
  expect(message, `${what}: the planted wrong program passed the assertion, so the assertion proves nothing`).not.toBeNull();
  for (const n of names) expect(message, `${what}: the failure must name ${n}`).toContain(n);
  return message!;
}
/** The machine's 1-minute load and cores, for the record of a run. */
export const loadNow = (): string => `load ${loadavg()[0]!.toFixed(1)} on ${cpus().length} cores`;

// ---- Budgets (#1097's rule): the reference Macs the design names, and the five-run judge.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
  { model: 'Mac17,10', chip: 'Apple M5 Max', gib: 64 },
];
const read = (cmd: string, ...args: string[]): string => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
  return r.stdout.trim();
};
/** Why this machine can't give a budget reading, or null: a reference Mac on mains, Low Power Mode off, nominal thermal state, load under its cores. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const load = loadavg()[0]!;
  if (load > cpus().length) return `load ${load.toFixed(1)} is past the ${cpus().length} cores`;
  return null;
}
export function p50(samples: readonly number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE (a skip). */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.abs(Math.min(...runs)), 1e-9);
  const margin = Math.max(0.05, spread);
  const text = `${name}: ${runs.map((r) => r.toFixed(2)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(text);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${text}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${text}`);
}
