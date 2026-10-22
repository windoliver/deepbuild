// Shared test-side tools for the issue #16 acceptance tests: temp homes, the hub as a process, a client for
// the socket's line protocol, the agent stand-in, a socket forwarder, the forms of a scrub-list value and the
// timing judge. None of them stands in for the hub: every test reaches the hub only through `deep hub …`,
// its socket and the files the design names under its root (README, The surface under test).

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { expect, type TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const SECOND = 1000;
export const DAY = 86_400_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const parse = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};

// ---- A seeded generator.
export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function word(rng: Rng, length: number, alphabet = ALNUM): string {
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}
/** The recorded seed every generated property here starts from (README, Readings). */
export const SEED = 16;

// ---- IDs and stamps.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
/** A fresh ULID at `ms` (random part from the OS, so IDs never collide across tests). */
export function ulid(ms = Date.now()): string {
  return base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
}
let seqCounter = 0n;
/** A hook's seq: nanoseconds since the epoch, as its canonical decimal string; unique within this process. */
export function nextSeq(ms = Date.now()): string {
  seqCounter = (seqCounter + 1n) % 1_000_000n;
  return (BigInt(ms) * 1_000_000n + seqCounter).toString();
}
export const COMMIT = '4f6dec54f6dec54f6dec54f6dec54f6dec54f6de';

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh16-'));
  made.push(dir);
  return dir;
}
/** A fresh home folder: the installed hub's root is <home>/.deepbuild (README). */
export function makeHome(): string {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  return home;
}
export const installedRoot = (home: string) => join(home, '.deepbuild');

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
  // A zombie still answers signal 0; ps shows its state.
  try {
    return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  // PIDs the hub's own children wrote (sleepers, launcher-started hubs) join the list through ownFromFile.
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
/** Every PID listed one per line in a file a fixture wrote (a sleeper, the launcher), owned from now on. */
export function ownFromFile(file: string): number[] {
  if (!existsSync(file)) return [];
  const pids = readFileSync(file, 'utf8').split('\n').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  for (const pid of pids) own(pid);
  return pids;
}

/** The environment a child gets: this one with HOME moved to the test's home and no DEEP_ settings of its own. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }
/** Runs a command to its end without blocking this process's event loop (a forwarder may live here). */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 60_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
/** `deep <args>` from the built CLI, as the person or a script runs it. */
export function deep(home: string, args: readonly string[], o: { env?: Record<string, string | undefined>; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(home, o.env), cwd: o.cwd ?? REPO, ...(o.input !== undefined && { input: o.input }), timeoutMs: o.timeoutMs ?? 60_000 });
}
let built: Promise<Ran> | undefined;
/** Builds deep-hook once per test process (cargo serializes concurrent builds itself). */
export async function buildDeepHook(extra: readonly string[] = []): Promise<void> {
  const key = extra.join(' ');
  const result = key ? await run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...extra], { timeoutMs: 600_000 }) : await (built ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 600_000 }));
  if (result.code !== 0) throw Error(`BLOCKED: cargo build of deep-hook ${key} failed: ${result.stderr}`);
}

// ---- The hub as a process: `deep hub run [--root <folder>]` (README, The surface under test).
export interface Ready { v: number; ready: true; pid: number; socket: string; start: string }
export interface HubOptions {
  home: string;
  root?: string;
  plant?: string;                       // DEEP_HUB_PLANT
  vfs?: Record<string, unknown>;        // DEEP_HUB_TEST_VFS, as JSON
  clock?: number;                       // DEEP_HUB_TEST_CLOCK, ms since the epoch
  headroom?: number;                    // DEEP_HUB_TEST_HEADROOM
  umask?: string;                       // the hub started under this umask
  nofile?: number;                      // the hub started under `ulimit -n`
  preload?: string;                     // node --import <module> before the CLI
  env?: Record<string, string | undefined>;
}
export interface HubProc {
  child: ChildProcess;
  pid: number;
  stderr(): string;
  ready: Promise<Ready | undefined>;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}
export interface Hub extends Ready { home: string; root: string; proc: HubProc }

export function hubEnv(o: HubOptions): NodeJS.ProcessEnv {
  return childEnv(o.home, {
    DEEP_HUB_PLANT: o.plant,
    DEEP_HUB_TEST_VFS: o.vfs && JSON.stringify(o.vfs),
    DEEP_HUB_TEST_CLOCK: o.clock === undefined ? undefined : String(o.clock),
    DEEP_HUB_TEST_HEADROOM: o.headroom === undefined ? undefined : String(o.headroom),
    ...o.env,
  });
}
/** Starts `deep hub run` in a process group of its own; resolves at once, before it is ready. */
export function spawnHub(o: HubOptions): HubProc {
  const args = [...(o.preload ? ['--import', o.preload] : []), CLI, 'hub', 'run', ...(o.root ? ['--root', o.root] : [])];
  let command = NODE;
  let argv = args;
  if (o.umask !== undefined || o.nofile !== undefined) {
    const pre = `${o.umask !== undefined ? `umask ${o.umask}; ` : ''}${o.nofile !== undefined ? `ulimit -n ${o.nofile}; ` : ''}`;
    command = '/bin/sh';
    argv = ['-c', `${pre}exec "$0" "$@"`, NODE, ...args];
  }
  const child = spawn(command, argv, { cwd: REPO, env: hubEnv(o), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let err = '';
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise<Ready | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      const first = out.split('\n')[0];
      if (out.includes('\n') && first !== undefined) {
        const line = parse(first);
        resolve(line && line.ready === true ? (line as Ready) : undefined);
      }
    });
    void exit.then(() => resolve(undefined));
  });
  return { child, pid: child.pid!, stderr: () => err, ready, exit };
}
/** What a start came to: ready, exited, or neither within the time. */
export async function settle(proc: HubProc, timeoutMs = 15_000): Promise<{ ready?: Ready; exit?: { code: number | null; signal: NodeJS.Signals | null }; hung?: true }> {
  const r = await Promise.race([proc.ready.then((ready) => (ready ? { ready } : undefined)), proc.exit.then((exit) => ({ exit })), sleep(timeoutMs).then(() => ({ hung: true as const }))]);
  if (r) return r;
  return { exit: await proc.exit };
}
export async function startHub(o: HubOptions, timeoutMs = 20_000): Promise<Hub> {
  const proc = spawnHub(o);
  const r = await settle(proc, timeoutMs);
  if (!r.ready) {
    throw Error(`BLOCKED: the hub didn't start (deep hub run${o.root ? ` --root ${o.root}` : ''}): ${r.hung ? 'no ready line' : `exit ${JSON.stringify(r.exit)}`}; stderr: ${proc.stderr().slice(0, 2000)}`);
  }
  return { ...r.ready, home: o.home, root: o.root ?? installedRoot(o.home), proc };
}
export async function stopHub(hub: { pid: number; proc?: HubProc }, signal: NodeJS.Signals = 'SIGTERM', timeoutMs = 10_000): Promise<void> {
  try { process.kill(hub.pid, signal); } catch { return; }
  const deadline = Date.now() + timeoutMs;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  if (hub.proc) await hub.proc.exit;
}

// ---- The line protocol (README, The socket).
export interface Received { at: number; raw: string; json: Line | undefined }
export class Conn {
  readonly received: Received[] = [];
  ended = false;
  failure: string | undefined;
  private buffer = '';
  private cursor = 1;   // the hub's hello is received[0]
  private wakers = new Set<() => void>();
  private ids = 0;
  private constructor(readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      const at = performance.now();
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const raw = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        this.received.push({ at, raw, json: parse(raw) });
      }
      this.wake();
    });
    sock.on('error', (error: NodeJS.ErrnoException) => { this.failure = error.code ?? error.message; this.wake(); });
    sock.on('close', () => { this.ended = true; this.wake(); });
  }
  private wake(): void { for (const w of [...this.wakers]) w(); }
  /** Connects and waits for the hub's hello line. Rejects with the connect error's code. */
  static open(path: string, timeoutMs = 5000): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(path);
      const conn = new Conn(sock);
      const timer = setTimeout(() => { sock.destroy(); reject(Error(`no hello from the hub at ${path} within ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        if (conn.received.length > 0) { clearTimeout(timer); conn.wakers.delete(check); resolve(conn); }
        else if (conn.failure || conn.ended) { clearTimeout(timer); conn.wakers.delete(check); reject(Object.assign(Error(`can't reach the hub at ${path}: ${conn.failure ?? 'closed before hello'}`), { code: conn.failure })); }
      };
      conn.wakers.add(check);
    });
  }
  get hello(): Line | undefined { return this.received[0]?.json; }
  /** Bytes after the last newline: a line the hub left unfinished. */
  get partial(): string { return this.buffer; }
  /** Writes text as is; returns when it was written (performance.now()). */
  write(text: string): number {
    const at = performance.now();
    this.sock.write(text);
    return at;
  }
  send(message: unknown): number { return this.write(`${JSON.stringify(message)}\n`); }
  /** The next line not yet taken, or undefined once the connection is closed or the time is up. */
  async next(timeoutMs = 5000): Promise<Line | undefined> {
    const got = await this.waitFor(() => this.cursor < this.received.length, timeoutMs);
    if (!got) return undefined;
    return this.received[this.cursor++]!.json ?? { unparsed: this.received[this.cursor - 1]!.raw };
  }
  /** The first line from here on that matches, or undefined at close or timeout. */
  async until(match: (line: Line) => boolean, timeoutMs = 5000): Promise<Received | undefined> {
    let found: Received | undefined;
    await this.waitFor(() => {
      while (this.cursor < this.received.length) {
        const r = this.received[this.cursor++]!;
        if (r.json && match(r.json)) { found = r; return true; }
      }
      return false;
    }, timeoutMs);
    return found;
  }
  /** The first line received at or after index `from` that matches, without moving the cursor; undefined at close or timeout. */
  async seek(match: (line: Line) => boolean, from = 1, timeoutMs = 5000): Promise<Received | undefined> {
    let found: Received | undefined;
    await this.waitFor(() => {
      found = this.received.slice(from).find((r) => r.json !== undefined && match(r.json));
      return found !== undefined;
    }, timeoutMs);
    return found;
  }
  private waitFor(ready: () => boolean, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (value: boolean) => { clearTimeout(timer); this.wakers.delete(check); resolve(value); };
      const check = () => { if (ready()) done(true); else if (this.ended || this.failure) done(ready()); };
      const timer = setTimeout(() => done(ready()), timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  /** One method call: `{v:1, id, method, params}`; resolves with its reply line (result or error). */
  async call(method: string, params: unknown = {}, timeoutMs = 10_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const from = this.received.length;
    this.send({ v: 1, id, method, params });
    const reply = await this.seek((line) => line.id === id && ('result' in line || 'error' in line), from, timeoutMs);
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms${this.failure ? ` (${this.failure})` : this.ended ? ' (the hub closed the connection)' : ''}`);
    return reply.json!;
  }
  async closed(timeoutMs = 5000): Promise<boolean> { return this.waitFor(() => this.ended, timeoutMs); }
  close(): void { this.sock.destroy(); }
}
/** The result of a reply line; throws, naming the refusal, when it is an error. */
export function result(line: Line): Line {
  if ('error' in line) throw Error(`refused: ${JSON.stringify(line.error)}`);
  return line.result as Line;
}
export const tokenOf = (root: string): string => readFileSync(join(root, 'control.token'), 'utf8').trim();
/** A connection that presented a role's credential: `{v:1, hello: 'app'|'cli', token}`. */
export async function openAs(socket: string, role: 'app' | 'cli', token: string): Promise<Conn> {
  const conn = await Conn.open(socket);
  conn.send({ v: 1, hello: role, token });
  const reply = await conn.next();
  if (!reply || reply.role !== role) throw Error(`BLOCKED: the hub refused the ${role} hello: ${JSON.stringify(reply)}`);
  return conn;
}
export const control = (hub: { socket: string; root: string }, role: 'app' | 'cli' = 'cli') => openAs(hub.socket, role, tokenOf(hub.root));

export interface Ev {
  id: string; kind: string; log_pos: number; writer: string; actor: string; scope: string; ts: number;
  seq?: string; subject?: string; session?: string; data: Line; evidence: string[]; verified: boolean;
}
/** Every event in the log, paged by log_pos through `events.read`. */
export async function allEvents(conn: Conn): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const page = result(await conn.call('events.read', { after, limit: 1000 }, 30_000));
    const events = page.events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
export async function health(conn: Conn): Promise<Line> { return result(await conn.call('hub.health')); }

/** A setup shared by a file's tests, made by the first test that needs it; if it fails, every test that needs it fails with it. */
export function shared<T>(make: () => Promise<T>): () => Promise<T> {
  let made: Promise<T> | undefined;
  return () => (made ??= make());
}

/** Polls until probe gives a value, or fails naming what it waited for. */
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(20);
  }
}

// ---- Hook requests (hook.request@1) and the agents' payloads.
export interface Session { agent: 'claude-code' | 'codex'; id: string; cwd: string; transcript: string }
/** A session in a fresh working folder, its transcript where its agent keeps it under <home>. */
export function newSession(home: string, agent: Session['agent'], cwd?: string): Session {
  const id = agent === 'codex' ? `01a1581d-${word(Math.random, 4, '0123456789abcdef')}-7b62-8f4f-${word(Math.random, 12, '0123456789abcdef')}` : randomUUID();
  const folder = cwd ?? join(tempDir(), 'work');
  mkdirSync(folder, { recursive: true });
  const transcript = agent === 'codex'
    ? join(home, '.codex/sessions/2026/10/21', `rollout-2026-10-21T00-00-00-${id}.jsonl`)
    : join(home, '.claude/projects', folder.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: id, cwd: folder, message: { role: 'user', content: 'start' } })}\n`);
  return { agent, id, cwd: folder, transcript };
}
let calls = 0;
/** The agent's own hook JSON for one event, shaped like the corpus's recorded payloads. */
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = s.agent === 'codex'
    ? { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'default' }
    : { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  const call = `call_${++calls}`;
  switch (event) {
    case 'SessionStart': Object.assign(base, { source: 'startup', ...(s.agent === 'claude-code' && { model: 'claude-haiku-5-5' }) }); break;
    case 'UserPromptSubmit': Object.assign(base, { prompt: 'run the tests', ...(s.agent === 'codex' ? { turn_id: 'turn-1' } : { prompt_id: randomUUID() }) }); break;
    case 'PreToolUse': Object.assign(base, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: call, ...(s.agent === 'codex' && { turn_id: 'turn-1' }) }); break;
    case 'PostToolUse': Object.assign(base, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: '', stderr: '', interrupted: false }, tool_use_id: call, ...(s.agent === 'codex' && { turn_id: 'turn-1' }) }); break;
    case 'Stop': Object.assign(base, { stop_hook_active: false, ...(s.agent === 'codex' && { turn_id: 'turn-1' }) }); break;
    case 'SessionEnd': Object.assign(base, { reason: 'other' }); break;
    default: break;
  }
  return { ...base, ...extra };
}
export interface HookRequest { v: 1; agent: string; event: string; seq: string; id: string; matched: string[]; payload: Line; pid?: number; ppid?: number }
/** A hook request line without pid and ppid: the client that sends it fills in its own (fixtures/client.mjs). */
export function hookRequest(s: Session, event: string, extra: Line = {}): HookRequest {
  return { v: 1, agent: s.agent, event, seq: nextSeq(), id: ulid(), matched: [], payload: payload(s, event, extra) };
}
/** The same request as this test process would send it itself, with its own pid and parent. */
export const fromHere = (r: HookRequest): HookRequest => ({ ...r, pid: process.pid, ppid: process.ppid });

export interface HookResult { lines: Line[]; raw: string[]; ack?: Line; reply?: Line; error?: Line; end: string; writeAt?: number; ackAt?: number; replyAt?: number }
/** One hook exchange on a new connection, as deep-hook makes it: hello, the request, the ack, the reply. */
export async function sendHook(socket: string, request: HookRequest | string, timeoutMs = 5000): Promise<HookResult> {
  let conn: Conn;
  try {
    conn = await Conn.open(socket, timeoutMs);
  } catch (error) {
    return { lines: [], raw: [], end: `error:${(error as { code?: string }).code ?? (error as Error).message}` };
  }
  const writeAt = conn.write(typeof request === 'string' ? request : `${JSON.stringify(request)}\n`);
  const last = await conn.until((line) => 'exit' in line || 'error' in line, timeoutMs);
  const lines = conn.received.slice(1).map((r) => r.json ?? { unparsed: r.raw });
  const ackR = conn.received.slice(1).find((r) => r.json && 'ack' in r.json);
  const replyR = conn.received.slice(1).find((r) => r.json && 'exit' in r.json);
  const errorR = conn.received.slice(1).find((r) => r.json && 'error' in r.json);
  const end = last ? 'reply' : conn.failure ? `error:${conn.failure}` : conn.ended ? 'close' : 'timeout';
  conn.close();
  return {
    lines, raw: conn.received.slice(1).map((r) => r.raw), end, writeAt,
    ...(ackR && { ack: ackR.json!, ackAt: ackR.at }), ...(replyR && { reply: replyR.json!, replyAt: replyR.at }), ...(errorR && { error: errorR.json!.error as Line }),
  };
}

// ---- The agent stand-in (fixtures/agent.mjs): a real process whose children carry its hooks and its deep mcp.
export interface AgentHook { pid: number; ppid: number; lines: Line[]; ack?: Line; reply?: Line; error?: Line; end: string }
export class Agent {
  private n = 0;
  private pending = new Map<number, (line: Line) => void>();
  private constructor(readonly child: ChildProcess, readonly cwd: string) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
      }
    });
  }
  get pid(): number { return this.child.pid!; }
  static start(home: string, cwd: string): Agent {
    const child = spawn(NODE, [join(FIXTURES, 'agent.mjs')], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Agent(child, cwd);
  }
  private send(command: Line, timeoutMs = 20_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the agent stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the agent stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** A hook sent by a child of this agent (via 'child'), or by a shell this agent ran that runs it (via 'shell'). */
  async hook(socket: string, request: HookRequest, o: { via?: 'child' | 'shell'; cwd?: string } = {}): Promise<AgentHook> {
    const r = await this.send({ op: 'hook', address: socket, request, via: o.via ?? 'child', cwd: o.cwd ?? this.cwd });
    const lines = (r.lines as string[]).slice(1).map((raw) => parse(raw) ?? { unparsed: raw });
    const ack = lines.find((l) => 'ack' in l);
    const reply = lines.find((l) => 'exit' in l);
    const error = lines.find((l) => 'error' in l);
    return { pid: r.pid as number, ppid: r.ppid as number, lines, end: r.end as string, ...(ack && { ack }), ...(reply && { reply }), ...(error && { error: error.error as Line }) };
  }
  /** Starts this agent's deep mcp stand-in: `{v:1, hello:'mcp', parent:{pid, start}}`; resolves with the hub's answer. */
  async mcpOpen(socket: string): Promise<Line> {
    const r = await this.send({ op: 'mcp-open', address: socket, cwd: this.cwd });
    const lines = (r.lines as string[]).map((raw) => parse(raw) ?? { unparsed: raw });
    return lines[1] ?? {};
  }
  private ids = 0;
  /** One call on this agent's deep mcp connection. */
  async mcp(method: string, params: unknown = {}): Promise<Line> {
    const id = `mcp-${method}#${++this.ids}`;
    const r = await this.send({ op: 'mcp', line: { v: 1, id, method, params } });
    return r.line as Line;
  }
  /** Any line on this agent's deep mcp connection (a hook request, say); resolves with the line answering its `id`. */
  async mcpSend(line: Line): Promise<Line> {
    return (await this.send({ op: 'mcp', line })).line as Line;
  }
  /** Raw lines the deep mcp stand-in received so far. */
  async mcpRaw(): Promise<string[]> { return (await this.send({ op: 'mcp-raw' })).lines as string[]; }
  async stop(): Promise<void> {
    try { await this.send({ op: 'exit' }, 3000); } catch { /* already gone */ }
  }
}
/** A session whose SessionStart and first PreToolUse came from this agent's children, so the hub can check it. */
export async function establish(agent: Agent, socket: string, s: Session): Promise<void> {
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse']) {
    const h = await agent.hook(socket, hookRequest(s, event));
    if (!h.ack) throw Error(`BLOCKED: the hub didn't acknowledge ${event} for ${s.id}: ${JSON.stringify(h)}`);
  }
}
/** deep_claim's arguments: claim.made@1's data fields. */
export const claimArgs = (task = `task:${ulid()}`) => ({ task_ref: task, attempt: 1, commit: COMMIT, scope: 'session' });

// ---- Settings and a forwarded socket.
/** The one address setting: <home>/.deepbuild/config.json, `{"hub": {"address": "unix:<path>"}}`. */
export function setAddress(home: string, address: string): void {
  const file = join(installedRoot(home), 'config.json');
  mkdirSync(dirname(file), { recursive: true });
  const config = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Line) : {};
  config.hub = { ...(config.hub as Line | undefined), address };
  writeFileSync(file, `${JSON.stringify(config)}\n`);
}
export interface Forwarder { path: string; connections: number; up: Buffer[]; down: Buffer[]; upText(): string; downText(): string; close(): Promise<void> }
/** A socket that carries bytes both ways to the hub's socket, as an SSH or TLS forward would, and keeps a copy. */
export function forwarder(dir: string, target: string): Promise<Forwarder> {
  const path = join(dir, 'fwd.sock');
  const f: Forwarder = {
    path, connections: 0, up: [], down: [],
    upText: () => Buffer.concat(f.up).toString('utf8'),
    downText: () => Buffer.concat(f.down).toString('utf8'),
    close: () => new Promise((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    f.connections++;
    const upstream = net.connect(target);
    sockets.add(client); sockets.add(upstream);
    client.on('data', (d: Buffer) => f.up.push(d));
    upstream.on('data', (d: Buffer) => f.down.push(d));
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.end());
    upstream.on('close', () => client.end());
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, () => resolve(f)); });
}

// ---- Bytes.
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
/** A valid RGB PNG of seeded noise. */
export function png(width: number, height: number, seed: number): Uint8Array {
  const rng = mulberry32(seed);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 3; x++) raw[y * (width * 3 + 1) + 1 + x] = Math.floor(rng() * 256);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]));
}
/** The evidence store's layout: <root>/evidence/ab/cdef… (#15). */
export const evidenceFile = (root: string, hash: string) => join(root, 'evidence', hash.slice(0, 2), hash.slice(2));
export function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

// ---- The forms #15 names for a scrub-list value: raw, URL-encoded with hex of either case, base64 at each offset in both alphabets.
const pct = (bytes: Uint8Array, upper: boolean) => {
  let s = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if (/[A-Za-z0-9\-_.~]/.test(ch)) s += ch;
    else { const h = b.toString(16).padStart(2, '0'); s += `%${upper ? h.toUpperCase() : h}`; }
  }
  return s;
};
const toUrlSafe = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export interface Form { name: string; printed: string; core: string }
export function everyForm(value: string): Form[] {
  const bytes = new Uint8Array(Buffer.from(value, 'utf8'));
  const forms: Form[] = [
    { name: 'raw', printed: value, core: value },
    { name: 'URL-encoded, upper-case hex', printed: pct(bytes, true), core: pct(bytes, true) },
    { name: 'URL-encoded, lower-case hex', printed: pct(bytes, false), core: pct(bytes, false) },
  ];
  for (const alphabet of ['standard', 'url-safe'] as const) {
    for (const k of [0, 1, 2]) {
      const lead = Buffer.from('r:'.slice(2 - k), 'utf8');
      const std = Buffer.concat([lead, bytes]).toString('base64');
      const start = Math.ceil((8 * k) / 6);
      const end = Math.floor((8 * (k + bytes.length)) / 6);
      const pick = alphabet === 'standard' ? (s: string) => s : toUrlSafe;
      forms.push({ name: `base64 ${alphabet} at offset ${k}`, printed: pick(std), core: pick(std.slice(start, end)) });
    }
  }
  return forms;
}
/** Each form of each value found in the text, as "<label> <form>". */
export function formsIn(text: string, values: Record<string, string>): string[] {
  const hits: string[] = [];
  for (const [label, value] of Object.entries(values)) for (const form of everyForm(value)) if (text.includes(form.core)) hits.push(`${label} ${form.name}`);
  return hits;
}

// ---- Timing.
export function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.NaN;
}
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state (#14's rule). */
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
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
