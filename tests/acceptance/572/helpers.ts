// Shared test-side tools for the issue #572 acceptance tests (README): temp homes, the installed hub as a process and
// its socket's line protocol, 30 scripted sessions appending through hook requests, the record seeded through the
// record before the hub starts, `deep backup` / `deep restore` as you run them, the OS confirmation's stub, deep-hook
// as an agent's hook entry runs it, the copy's checks (PRAGMA integrity_check and the events it must hold), the
// projections read off a ledger, the generation each connection reports, and the reference-Mac gate with the timing
// judge. Parts are adapted from tests/acceptance/16/helpers.ts, 14/helpers.ts and 317/helpers.ts (same repo, same
// license); this suite keeps its own copy so a redraft of those suites never moves these tests. Nothing here stands in
// for DeepBuild: every test reaches it through the CLI, the hub's socket, deep-hook and the files under the hub's root.
// Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { expect, type TestContext } from 'vitest';
import { catalogue, fixtures } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { openRecord, PROJECTIONS } from '../../../packages/record/src/index.ts';
import type { Connection, EventInput } from '../../../packages/record/src/index.ts';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const SECOND = 1000;
export const COMMIT = '5725725725725725725725725725725725725725';
/** How many scripted sessions append while a backup runs (AC1). */
export const SESSIONS = 30;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};

// ---- Temp folders. Short real paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh572-'));
  made.push(dir);
  return dir;
}
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts, so the installed hub's root is `<tmp>/h/.deepbuild`.
 * `<tmp>/confirm` is the OS confirmation's stub (DEEP_HUB_TEST_CONFIRM, #24's seam): `cancelled` until a test says
 * otherwise. Every folder a backup goes to is made under `<tmp>`.
 */
export interface Home { tmp: string; home: string; root: string; confirm: string }
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'cancelled\n');
  return { tmp, home, root: join(home, '.deepbuild'), confirm };
}
/** What the stubbed OS confirmation answers from now on, for every process that asks (the hub or the CLI). */
export const confirmWith = (h: Home, answer: 'confirmed' | 'cancelled'): void => {
  rmSync(h.confirm, { force: true });
  writeFileSync(h.confirm, `${answer}\n`);
};
/**
 * The stub as a program standing for the OS prompt (confirm.ts runs an executable stub once per ask, the reason as its
 * one argument, exit 0 meaning you confirmed): it logs each ask as one line to `<tmp>/asked.log` and exits `code`.
 */
export function confirmByProgram(h: Home, code: 0 | 1): void {
  rmSync(h.confirm, { force: true });
  writeFileSync(h.confirm, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${join(h.tmp, 'asked.log')}'\nexit ${code}\n`);
  chmodSync(h.confirm, 0o755);
}
/** The asks the program stub logged so far, one per line. */
export const asked = (h: Home): string[] => (existsSync(join(h.tmp, 'asked.log')) ? readFileSync(join(h.tmp, 'asked.log'), 'utf8').split('\n').filter(Boolean) : []);
/** A fresh empty folder for one backup, under the home's temp folder. */
export function backupFolder(h: Home, name: string): string {
  const dir = join(h.tmp, 'backups', name);
  mkdirSync(dir, { recursive: true });
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

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * The environment a child gets: HOME the test's home, the OS confirmation's stub (DEEP_HUB_TEST_CONFIRM) set, and no
 * DEEP_, XDG_, CLAUDE or CODEX setting or billing key of this process's.
 */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('GIT_') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = h.home;
  env.XDG_CONFIG_HOME = join(h.home, '.config');
  env.XDG_CACHE_HOME = join(h.home, '.cache');
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  env.DEEP_HUB_TEST_CONFIRM = h.confirm;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; pid: number }
/** Runs a command to its end without blocking this process's event loop. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number; started?: (pid: number) => void } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    o.started?.(child.pid!);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, pid: child.pid! }); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut, pid: child.pid ?? 0 }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/** `deep <args>` from the built CLI, run by you: a child of this test process, under no agent, in the home's temp folder. */
export function deep(h: Home, args: readonly string[], o: { timeoutMs?: number; started?: (pid: number) => void } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(h), cwd: h.tmp, timeoutMs: o.timeoutMs ?? 600_000, ...(o.started ? { started: o.started } : {}) });
}
/** `deep backup <folder>`, which must exit 0 (README, The CLI). */
export async function backup(h: Home, folder: string, timeoutMs = 600_000): Promise<Ran> {
  const r = await deep(h, ['backup', folder], { timeoutMs });
  if (r.code !== 0) throw Error(`\`deep backup ${folder}\` must exit 0 with the hub up: ${shown(r)}`);
  return r;
}
/** `deep restore <folder>` with the hub stopped and the OS confirming you; must exit 0 (README, The CLI). */
export async function restore(h: Home, folder: string): Promise<Ran> {
  confirmWith(h, 'confirmed');
  try {
    const r = await deep(h, ['restore', folder]);
    if (r.code !== 0) throw Error(`\`deep restore ${folder}\`, with the hub stopped and the OS confirming you, must exit 0: ${shown(r)}`);
    return r;
  } finally {
    confirmWith(h, 'cancelled');
  }
}

// ---- The installed hub as a process: `deep hub run`, HOME the test's home (#16).
export interface Hub { pid: number; socket: string; root: string; start: string; child: ChildProcess; exit: Promise<void>; output(): string }
export async function startHub(h: Home, o: { vfs?: Record<string, unknown>; timeoutMs?: number } = {}): Promise<Hub> {
  const env = childEnv(h, { DEEP_HUB_TEST_VFS: o.vfs && JSON.stringify(o.vfs) });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: h.tmp, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await new Promise<Line | undefined>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(undefined), o.timeoutMs ?? 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); const l = parseObject(first.split('\n')[0]!); resolve(l?.ready === true ? l : undefined); }
    });
    void exit.then(() => { clearTimeout(timer); resolve(undefined); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start (deep hub run, HOME ${h.home}): ${out.slice(0, 2000)}`);
  return { pid: child.pid!, socket: join(h.root, 'hub.sock'), root: h.root, start: String(ready.start), child, exit, output: () => out };
}
/** A clean stop (SIGTERM to the hub's PID), waiting for it to exit; SIGKILL after 30 s. */
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const killed = sleep(30_000).then(() => { try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ } });
  await Promise.race([hub.exit, killed]);
  await hub.exit;
}

// ---- The line protocol (#16).
export class Conn {
  readonly received: Line[] = [];
  ended = false;
  private buffer = '';
  private wakers = new Set<() => void>();
  private ids = 0;
  private constructor(readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const raw = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        this.received.push(parseObject(raw) ?? { unparsed: raw });
      }
      for (const w of [...this.wakers]) w();
    });
    const end = () => { this.ended = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  /** Connects and waits for the hub's hello line (received[0]). */
  static open(path: string, timeoutMs = 10_000): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const conn = new Conn(net.connect(path));
      const timer = setTimeout(() => { conn.sock.destroy(); reject(Error(`no hello from the hub at ${path} within ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        if (conn.received.length > 0) { clearTimeout(timer); conn.wakers.delete(check); resolve(conn); }
        else if (conn.ended) { clearTimeout(timer); conn.wakers.delete(check); reject(Error(`can't reach the hub at ${path}`)); }
      };
      conn.wakers.add(check);
    });
  }
  get hello(): Line { return this.received[0] ?? {}; }
  send(message: unknown): void { this.sock.write(`${JSON.stringify(message)}\n`); }
  /** The first line received at or after `from` that matches; undefined at close or timeout. */
  seek(match: (line: Line) => boolean, from: number, timeoutMs: number): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const done = (v: Line | undefined) => { clearTimeout(timer); this.wakers.delete(check); resolve(v); };
      const check = () => { const found = this.received.slice(from).find(match); if (found) done(found); else if (this.ended) done(undefined); };
      const timer = setTimeout(() => done(undefined), timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  async call(method: string, params: unknown = {}, timeoutMs = 60_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const from = this.received.length;
    this.send({ v: 1, id, method, params });
    const reply = await this.seek((l) => l.id === id && ('result' in l || 'error' in l), from, timeoutMs);
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  close(): void { this.sock.destroy(); }
}
export const tokenOf = (root: string): string => readFileSync(join(root, 'control.token'), 'utf8').trim();
/** A connection that said hello as `app` or `cli` with the control token; returns it with the hub's role line. */
export async function openAs(hub: { socket: string; root: string }, role: 'app' | 'cli'): Promise<{ conn: Conn; roleLine: Line }> {
  const conn = await Conn.open(hub.socket);
  const from = conn.received.length;
  conn.send({ v: 1, hello: role, token: tokenOf(hub.root) });
  const roleLine = await conn.seek((l) => 'role' in l || 'error' in l, from, 10_000);
  if (!roleLine || roleLine.role !== role) throw Error(`BLOCKED: the hub refused the ${role} hello: ${JSON.stringify(roleLine)}`);
  return { conn, roleLine };
}
export const control = async (hub: { socket: string; root: string }): Promise<Conn> => (await openAs(hub, 'cli')).conn;

export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; session?: string; subject?: string; data: Line }
/** Every event in the log, paged by log_pos through `events.read`. */
export async function allEvents(conn: Conn): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const events = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}

// ---- Hook requests (hook.request@1), as deep-hook sends them, for scripted sessions.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
/** A fresh ULID at `ms`, its random part from the OS. */
export const ulid = (ms = Date.now()): string => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
let seqCounter = 0n;
const nextSeq = (ms = Date.now()): string => { seqCounter = (seqCounter + 1n) % 1_000_000n; return (BigInt(ms) * 1_000_000n + seqCounter).toString(); };
export interface Session { id: string; cwd: string; transcript: string }
/** A Claude Code session in a work folder of its own, its transcript where Claude Code keeps it under the home. */
export function newSession(h: Home): Session {
  const id = randomUUID();
  const cwd = join(h.tmp, 'work', id.slice(0, 8));
  mkdirSync(cwd, { recursive: true });
  const transcript = join(h.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: id, cwd, message: { role: 'user', content: 'start' } })}\n`);
  return { id, cwd, transcript };
}
let calls = 0;
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  const call = `toolu_572_${++calls}`;
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  if (event === 'PreToolUse') Object.assign(base, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: call });
  if (event === 'PostToolUse') Object.assign(base, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: '', stderr: '', interrupted: false }, tool_use_id: call });
  return { ...base, ...extra };
}
export interface HookRequest { v: 1; agent: string; event: string; seq: string; id: string; matched: string[]; payload: Line; pid: number; ppid: number }
export const hookRequest = (s: Session, event: string): HookRequest =>
  ({ v: 1, agent: 'claude-code', event, seq: nextSeq(), id: ulid(), matched: [], payload: payload(s, event), pid: process.pid, ppid: process.ppid });
/** One hook exchange on a new connection, as deep-hook makes it; resolves with the hello and the ack (undefined if none). */
export async function sendHook(socket: string, request: HookRequest): Promise<{ hello?: Line; ack?: Line }> {
  let conn: Conn;
  try { conn = await Conn.open(socket); } catch { return {}; }
  try {
    conn.send(request);
    const ack = await conn.seek((l) => 'ack' in l || 'error' in l, 1, 10_000);
    return { hello: conn.hello, ...(ack && 'ack' in ack ? { ack } : {}) };
  } finally {
    conn.close();
  }
}

/**
 * SESSIONS scripted sessions appending through the hub: each opens with SessionStart, then sends PreToolUse and
 * PostToolUse in turn, one at a time, `paceMs` apart (an agent's tool calls, not a flood the core can't drain),
 * until stopped. `acked` counts the acknowledged requests.
 */
export function appendLoad(h: Home, hub: { socket: string }, sessions = SESSIONS, paceMs = 100): { stop(): Promise<void>; acked(): number; sessions: Session[]; failures(): string[] } {
  const list = Array.from({ length: sessions }, () => newSession(h));
  let running = true;
  let acked = 0;
  const failures: string[] = [];
  const loops = list.map(async (s) => {
    let i = 0;
    while (running) {
      const event = i === 0 ? 'SessionStart' : i % 2 ? 'PreToolUse' : 'PostToolUse';
      const r = await sendHook(hub.socket, hookRequest(s, event));
      if (r.ack) acked++;
      else if (running) failures.push(`${s.id} ${event}`);
      i++;
      await sleep(paceMs);
    }
  });
  return {
    sessions: list,
    acked: () => acked,
    failures: () => failures,
    stop: async () => { running = false; await Promise.all(loops); },
  };
}

// ---- The record, seeded through @deepbuild/record with the hub stopped (as #19's and #16's suites seed it).
type JsonObject = { [key: string]: JsonValue };
const YOU = { actor: 'you', scope: 'you' } as const;
function kindSchema(kind: string): string {
  const entry = catalogue().find((e) => e.kind === kind);
  if (!entry) throw Error(`BLOCKED: event kind ${kind} is not in the catalogue`);
  return entry.schema;
}
function fromFixture(kind: string, at: number, over: { subject?: string; data?: JsonObject } = {}, index = 0): EventInput {
  const fx = structuredClone(fixtures(kindSchema(kind))[index]) as JsonObject;
  const input: EventInput = { v: fx.v as number, id: ulid(at), kind, ts: at, data: { ...(fx.data as JsonObject), ...(over.data ?? {}) } };
  const subject = over.subject ?? (typeof fx.subject === 'string' ? fx.subject : undefined);
  if (subject !== undefined) input.subject = subject;
  if (typeof fx.seq === 'string') input.seq = nextSeq(at);
  return input;
}
export interface Seeded {
  /** Claims whose sessions still run, with no verdict: open at any copy taken after this. */
  open: { claim: string; session: string }[];
  /** A claim that already has its PASS verdict. */
  settled: { claim: string; verdict: string; session: string };
}
/**
 * Seeds `<root>/ledger.db` before the hub's first start: three sessions, each started and running, each with a claim
 * left open, and a fourth whose claim has a PASS verdict. Closed cleanly, so the hub's start is a clean one.
 */
export async function seedClaims(h: Home): Promise<Seeded> {
  mkdirSync(h.root, { recursive: true, mode: 0o700 });
  let now = Date.now() - 60_000;
  const record = await openRecord({ path: join(h.root, 'ledger.db'), now: () => now });
  const at = () => (now += 10);
  const hookConn = (session: string): Connection => ({ writer: 'hook', ...YOU, session, agent: 'claude-code' });
  const appConn = (session: string): Connection => ({ writer: 'app', ...YOU, session });
  const startSession = async (): Promise<string> => {
    const session = randomUUID();
    await record.append(hookConn(session), fromFixture('session.start', at(), { data: { agent: 'claude-code', worktree: join(h.tmp, 'work', session.slice(0, 8)), branch: 'main', thread: session } }));
    return session;
  };
  const claim = async (session: string): Promise<string> => {
    const input = fromFixture('claim.made', at(), { data: { task_ref: `task:${ulid(now)}`, attempt: 1, commit: COMMIT, scope: 'session' } });
    await record.append(appConn(session), input);
    return input.id;
  };
  try {
    const open: Seeded['open'] = [];
    for (let i = 0; i < 3; i++) {
      const session = await startSession();
      open.push({ claim: await claim(session), session });
    }
    const session = await startSession();
    const settledClaim = await claim(session);
    const vid = ulid(at());
    const verdict: EventInput = fromFixture('verdict.made', now, { data: { outcome: 'PASS', verdict: `verdict:${vid}`, claim: `claim:${settledClaim}`, reasons: ['every requirement passed'], commit: COMMIT } }, 1);
    verdict.id = vid;
    await record.append({ writer: 'core', ...YOU }, verdict);
    await record.sync();
    return { open, settled: { claim: settledClaim, verdict: vid, session } };
  } finally {
    await record.close();
  }
}
/** A claim handle and a bare ID read the same. */
export const bare = (v: unknown): string => (typeof v === 'string' ? v.replace(/^[a-z_]+:/, '') : String(v));

// ---- Evidence and the wiki under the hub's root.
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
/** A valid 8 × 8 RGB PNG whose pixels come from `seed`. */
export function png(seed: number): Uint8Array {
  const raw = Buffer.alloc((8 * 3 + 1) * 8);
  for (let i = 0; i < raw.length; i++) if (i % 25 !== 0) raw[i] = (seed * 31 + i * 7) & 0xff;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]));
}
/** Pastes an image through the app's connection (`evidence.paste`, #15/#16), so the evidence store holds a file. */
export async function pasteEvidence(hub: Hub, seed: number): Promise<void> {
  const { conn } = await openAs(hub, 'app');
  try {
    await conn.call('evidence.paste', { bytes: Buffer.from(png(seed)).toString('base64'), type: 'image/png' });
  } finally {
    conn.close();
  }
}
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
/** Every file under a folder, by its path relative to it, with its bytes' SHA-256. */
export const filesOf = (dir: string): Map<string, string> => new Map(walk(dir).map((p) => [relative(dir, p), sha256(readFileSync(p))]));
/** Where, if anywhere, `want`'s files are missing or differ in `got`; each named. */
export function missingFiles(want: Map<string, string>, got: Map<string, string>, what: string): string[] {
  const out: string[] = [];
  for (const [path, hash] of want) {
    if (!got.has(path)) out.push(`${what}: ${path} is missing`);
    else if (got.get(path) !== hash) out.push(`${what}: ${path} differs`);
  }
  return out;
}

// ---- A ledger read off disk: copied to a scratch folder first (the database and its WAL, as SQLite would read them).
function scratchCopy(dir: string): string | undefined {
  if (!existsSync(join(dir, 'ledger.db'))) return undefined;
  const into = join(tempDir(), 'read');
  mkdirSync(into);
  for (const name of ['ledger.db', 'ledger.db-wal']) if (existsSync(join(dir, name))) copyFileSync(join(dir, name), join(into, name));
  return join(into, 'ledger.db');
}
/**
 * The checks a backup's copy must pass, as one list of problems (empty when it passes): `<dir>/ledger.db` is there,
 * `PRAGMA integrity_check` says ok, and it holds every event of each group, each missing one named by its group.
 * A copy that can't be read at all lacks every group's events, and says so by name.
 */
export function copyProblems(dir: string, groups: { name: string; ids: Iterable<string> }[]): string[] {
  const lacking = (have: Set<string>) => groups.flatMap((g) => {
    const missing = [...g.ids].filter((id) => !have.has(id));
    return missing.length ? [`the copy lacks ${missing.length} of ${g.name}: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}`] : [];
  });
  const file = scratchCopy(dir);
  if (!file) return [`no ledger.db in ${dir}`, ...lacking(new Set())];
  const problems: string[] = [];
  let db: Database.Database | undefined;
  try {
    db = new Database(file);
    const said = db.pragma('integrity_check') as { integrity_check: string }[];
    const text = said.map((r) => r.integrity_check).join('; ');
    if (text !== 'ok') problems.push(`PRAGMA integrity_check on the copy says: ${text.slice(0, 600)}`);
    const have = new Set((db.prepare('SELECT id FROM events').pluck().all() as string[]));
    problems.push(...lacking(have));
  } catch (error) {
    problems.push(`the copy can't be read as a SQLite record: ${(error as Error).message}`, ...lacking(new Set()));
  } finally {
    db?.close();
  }
  return problems;
}
/** The event IDs a ledger on disk holds (read off a scratch copy). */
export function idsIn(dir: string): Set<string> {
  const file = scratchCopy(dir);
  if (!file) return new Set();
  const db = new Database(file);
  try {
    return new Set(db.prepare('SELECT id FROM events').pluck().all() as string[]);
  } finally {
    db.close();
  }
}

/** One projection as stored: its rows, each as canonical JSON text, sorted. */
export type Projections = Map<string, string[]>;
const canon = (value: unknown): string => {
  if (typeof value === 'bigint') return JSON.stringify(`${value}n`);
  if (value instanceof Uint8Array) return `bytes:${Buffer.from(value).toString('hex')}`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon((value as Line)[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
};
/** Every projection the record names (PROJECTIONS) as stored in `<dir>/ledger.db`, read off a scratch copy. */
export function projectionsIn(dir: string): Projections {
  const file = scratchCopy(dir);
  if (!file) throw Error(`no ledger.db in ${dir}`);
  const db = new Database(file);
  db.defaultSafeIntegers(true);
  try {
    const out: Projections = new Map();
    for (const name of PROJECTIONS) {
      const rows = db.prepare(`SELECT * FROM "${name}"`).all() as Line[];
      out.set(name, rows.map(canon).sort());
    }
    return out;
  } finally {
    db.close();
  }
}
/**
 * Where the restored projections differ from the backup's, each difference naming its table and row (README, AC2:
 * read as `deep restore` exits, before the hub starts again, so no difference is allowed).
 */
export function projectionDifferences(backup: Projections, restored: Projections): string[] {
  const out: string[] = [];
  for (const [name, want] of backup) {
    const got = restored.get(name);
    if (!got) { out.push(`${name}: missing after the restore`); continue; }
    const gotSet = new Set(got);
    const wantSet = new Set(want);
    for (const r of want) if (!gotSet.has(r)) out.push(`${name}: the backup's row ${r.slice(0, 300)} is not in the restored record`);
    for (const r of got) if (!wantSet.has(r)) out.push(`${name}: the restored row ${r.slice(0, 300)} is not the backup's`);
  }
  return out;
}

// ---- deep-hook as an agent's hook entry runs it (#317).
let built: Promise<void> | undefined;
export function buildDeepHook(release = false): Promise<void> {
  if (!release) {
    built ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 900_000 }).then((r) => {
      if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
    });
    return built;
  }
  return run('cargo', ['build', '--locked', '-q', '--release', '-p', 'deep-hook'], { timeoutMs: 1_800_000 }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: cargo build --release -p deep-hook failed: ${r.stderr.slice(-3000)}`);
  });
}
/** The core's shipped guard@1 entries, installed verbatim as `<root>/rules.json` (#316, #317). */
export function installDefaultRules(h: Home): void {
  mkdirSync(h.root, { recursive: true });
  writeFileSync(join(h.root, 'rules.json'), readFileSync(DEFAULT_RULES));
}
/** A PreToolUse for a Bash command, as Claude Code sends deep-hook its hook JSON. */
export const bashCall = (s: Session, command: string): Line => payload(s, 'PreToolUse', { tool_input: { command } });
/** `deep-hook claude-code <event>`, the hook JSON on stdin, HOME the agent's. */
export function hook(h: Home, s: Session, body: Line, binary = DEEP_HOOK): Promise<Ran> {
  return run(binary, ['claude-code', String(body.hook_event_name)], { cwd: s.cwd, env: childEnv(h), input: JSON.stringify(body), timeoutMs: 30_000 });
}
/** What deep-hook's output tells Claude Code about a PreToolUse: exit 2 or a deny decision denies; exit 0 allows. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
/**
 * Text compared for "naming the command": `~/` and `$HOME/` read as the home folder, quotes dropped and whitespace
 * collapsed (as #317's suite compares it).
 */
export function plain(text: string, home: string): string {
  return text.replace(/\$\{HOME\}\/|\$HOME\//g, `${home}/`).replace(/(^|[\s'"=:(`])~\//g, `$1${home}/`).replace(/['"`]/g, '').replace(/\s+/g, ' ').trim();
}
export const names = (r: Ran, what: string, home: string) => plain(`${r.stdout}\n${r.stderr}`, home).includes(plain(what, home));

// ---- The generation each connection is told (README, The generation).
export type Role = 'hook' | 'app' | 'cli';
/**
 * The writer generation the hub reports on one new connection of `role`: the `generation` field of its hello line, or,
 * where the hello carries none, of its first reply on that connection (the role line for app and cli, the ack for a
 * hook). Where both carry one they must agree. Returns what was reported (undefined for nothing), with the lines read.
 */
export async function generationOn(hub: { socket: string; root: string }, role: Role, h: Home): Promise<{ generation: unknown; lines: Line[] }> {
  let hello: Line;
  let reply: Line | undefined;
  if (role === 'hook') {
    const r = await sendHook(hub.socket, hookRequest(newSession(h), 'SessionStart'));
    if (!r.ack) throw Error(`BLOCKED: the hub didn't acknowledge a hook request: ${JSON.stringify(r)}`);
    hello = r.hello ?? {};
    reply = r.ack;
  } else {
    const { conn, roleLine } = await openAs(hub, role);
    hello = conn.hello;
    reply = roleLine;
    conn.close();
  }
  const lines = [hello, reply];
  const said = [hello.generation, reply.generation].filter((g) => g !== undefined);
  if (said.length === 2 && said[0] !== said[1]) throw Error(`the hub told one ${role} connection two generations: ${JSON.stringify(lines)}`);
  return { generation: said[0], lines };
}
/** The generation reported on a hook, an app and a cli connection; throws unless all three report the same integer. */
export async function generationEverywhere(hub: { socket: string; root: string }, h: Home): Promise<number> {
  const seen: Record<string, unknown> = {};
  for (const role of ['hook', 'app', 'cli'] as Role[]) {
    const { generation, lines } = await generationOn(hub, role, h);
    if (!Number.isSafeInteger(generation)) throw Error(`the hub reports no writer generation (an integer \`generation\`) on a ${role} connection: it said ${JSON.stringify(lines)}`);
    seen[role] = generation;
  }
  const values = new Set(Object.values(seen));
  if (values.size !== 1) throw Error(`the hub reports different generations on different connections: ${JSON.stringify(seen)}`);
  return seen.hook as number;
}

// ---- Timing: the reference-Mac gate and the design's judge for timing results (as #14's and #16's suites).
export function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.NaN;
}
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state (#14's rule). */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = sh('pmset', '-g', 'batt');
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
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
  const text = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(text);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${text}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${text}`);
}

/** Polls until probe gives a value, or fails naming what it waited for. */
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(50);
  }
}
