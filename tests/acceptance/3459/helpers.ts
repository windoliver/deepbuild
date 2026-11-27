// Shared test-side tools for the issue #3459 acceptance tests (README): temp homes, the installed hub as a process and
// its socket's line protocol, `deep backup` and `deep restore` as you run them, the OS confirmation's stand-in as a
// program that keeps the sentence it is shown, the record topped up to exactly 40 events the backup lacks, the kept
// folder as the command's last line names it, files by hash and inode, deep-hook as an agent's hook entry runs it, and
// the generation each connection reports. Parts are adapted from tests/acceptance/572/helpers.ts (same repo, same
// license); this suite keeps its own copy so a redraft of that suite never moves these tests. Nothing here stands in
// for DeepBuild: every test reaches it through the built CLI, the hub's socket, deep-hook and the files under the
// hub's root. Processes are stopped by PID only, never by name or port, and no test waits for time to pass.

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { catalogue, fixtures } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, EventInput } from '../../../packages/record/src/index.ts';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
/** deep-hook: the lane's binaries (DEEP_BIN_DIR) when it gives them, else this checkout's debug build. */
export const DEEP_HOOK = join(process.env.DEEP_BIN_DIR || join(REPO, 'target/debug'), 'deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
/** How many events the record holds that the backup lacks (the issue's number). */
export const LACKING = 40;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const parseObject = (raw: string): Line | undefined => {
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
  const dir = realpathSync(mkdtempSync('/tmp/dh3459-'));
  made.push(dir);
  return dir;
}
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts, so the installed hub's root is `<tmp>/h/.deepbuild`
 * and no real `~/.deepbuild` is read or written. `<tmp>/confirm` is the OS confirmation's stand-in
 * (DEEP_HUB_TEST_CONFIRM): a program that cancels until a test says otherwise.
 */
export interface Home { tmp: string; home: string; root: string; confirm: string }
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  const h = { tmp, home, root: join(home, '.deepbuild'), confirm: join(tmp, 'confirm') };
  osAnswers(h, 'cancels');
  return h;
}
/**
 * The stand-in as a program standing for the OS prompt (confirm.ts at the base runs an executable stand-in once per
 * ask, the sentence shown as its one argument, exit 0 meaning you confirmed): it keeps each sentence it is shown in
 * `<tmp>/asked`, and confirms or cancels. Nothing shows or clicks a real prompt.
 */
export function osAnswers(h: Home, answer: 'confirms' | 'cancels'): void {
  rmSync(h.confirm, { force: true });
  writeFileSync(h.confirm, `#!/bin/sh\nprintf '%s\\0' "$1" >> '${join(h.tmp, 'asked')}'\nexit ${answer === 'confirms' ? 0 : 1}\n`);
  chmodSync(h.confirm, 0o755);
}
/** Every sentence the OS stand-in was shown so far, in order. */
export const asked = (h: Home): string[] => (existsSync(join(h.tmp, 'asked')) ? readFileSync(join(h.tmp, 'asked'), 'utf8').split('\0').filter(Boolean) : []);
/** A fresh empty folder for one backup, under the home's temp folder. */
export function backupFolder(h: Home, name: string): string {
  const dir = join(h.tmp, 'backups', name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Map<number, Promise<void>>();
function own(child: ChildProcess): Promise<void> {
  const exit = new Promise<void>((done) => { child.on('exit', () => done()); child.on('error', () => done()); });
  if (child.pid) owned.set(child.pid, exit);
  return exit;
}
/** Stops every process this suite started that still runs (SIGKILL by PID, then its exit) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const [pid, exit] of owned) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    await exit;
  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * The environment a child gets: HOME the test's home, the OS confirmation's stand-in set, the time zone UTC (so a day
 * or a time a command prints is the UTC one the tests compute), and no DEEP_, XDG_, CLAUDE or CODEX setting or billing
 * key of this process's.
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
  env.TZ = 'UTC';
  env.DEEP_HUB_TEST_CONFIRM = h.confirm;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
/** Runs a command to its end without blocking this process's event loop. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    void own(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    // deadline: a command that never ends is killed by its PID and fails its test instead of hanging the file.
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 300_000);
    child.on('close', (code, signal) => { clearTimeout(timer); if (child.pid) owned.delete(child.pid); done({ code, signal, stdout, stderr, timedOut }); });
    child.on('error', (error) => { clearTimeout(timer); done({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
/** `deep <args>` from the built CLI, run by you: a child of this test process, under no agent, in the home's temp folder. */
export const deep = (h: Home, args: readonly string[], extra: Record<string, string | undefined> = {}): Promise<Ran> =>
  run(NODE, [CLI, ...args], { env: childEnv(h, extra), cwd: h.tmp });
/** `deep backup <folder>` through the running hub; BLOCKED unless it exits 0, as it does on the base (#572). */
export async function backup(h: Home, folder: string): Promise<void> {
  const r = await deep(h, ['backup', folder]);
  if (r.code !== 0) throw Error(`BLOCKED: \`deep backup ${folder}\` must exit 0 with the hub up: ${shown(r)}`);
}
/** `deep restore <folder>` with the hub stopped and the OS stand-in confirming you. The stand-in cancels again after. */
export async function restore(h: Home, folder: string, extra: Record<string, string | undefined> = {}): Promise<Ran> {
  osAnswers(h, 'confirms');
  try {
    return await deep(h, ['restore', folder], extra);
  } finally {
    osAnswers(h, 'cancels');
  }
}
/** `deep restore <folder>` with the OS stand-in cancelling: the sentence it was shown, and how the command ended. */
export async function askedBy(h: Home, folder: string): Promise<{ sentence: string | undefined; ran: Ran; asks: number }> {
  osAnswers(h, 'cancels');
  const before = asked(h).length;
  const ran = await deep(h, ['restore', folder]);
  const said = asked(h).slice(before);
  return { sentence: said[0], ran, asks: said.length };
}

// ---- The installed hub as a process: `deep hub run`, HOME the test's home (#16, as #572's suite starts it).
export interface Hub { pid: number; socket: string; root: string; exit: Promise<void>; output(): string }
/** Starts the hub and waits for its ready line; `ready` false when it ended without one, with what it wrote and its exit code. */
export async function tryHub(h: Home): Promise<{ ready: boolean; hub: Hub; code: number | null }> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: h.tmp, env: childEnv(h), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const exit = own(child);
  let out = '';
  let code: number | null = null;
  child.on('exit', (c) => { code = c; });
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((done) => {
    let first = '';
    // deadline: a hub that neither starts nor ends fails its test instead of hanging the file.
    const timer = setTimeout(() => done(false), 240_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); done(parseObject(first.split('\n')[0]!)?.ready === true); }
    });
    void exit.then(() => { clearTimeout(timer); done(false); });
  });
  return { ready, code, hub: { pid: child.pid!, socket: join(h.root, 'hub.sock'), root: h.root, exit, output: () => out } };
}
export async function startHub(h: Home): Promise<Hub> {
  const { ready, hub } = await tryHub(h);
  if (!ready) throw Error(`BLOCKED: the hub didn't start (deep hub run, HOME a temp folder): ${hub.output().slice(0, 2000)}`);
  return hub;
}
/** A clean stop (SIGTERM to the hub's PID), waiting for its exit; SIGKILL by PID if it takes over 60 s. */
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  // deadline: a hub that ignores its stop is killed by its PID instead of hanging the file.
  const timer = setTimeout(() => { try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ } }, 60_000);
  await hub.exit;
  clearTimeout(timer);
  owned.delete(hub.pid);
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
  static async open(path: string): Promise<Conn> {
    const conn = new Conn(net.connect(path));
    if (!(await conn.seek(() => true, 0))) throw Error(`BLOCKED: no hello from the hub at its socket`);
    return conn;
  }
  get hello(): Line { return this.received[0] ?? {}; }
  send(message: unknown): void { this.sock.write(`${JSON.stringify(message)}\n`); }
  /** The first line received at or after `from` that matches; undefined at close or after 60 s. */
  seek(match: (line: Line) => boolean, from: number): Promise<Line | undefined> {
    return new Promise((resolveLine) => {
      const done = (v: Line | undefined) => { clearTimeout(timer); this.wakers.delete(check); resolveLine(v); };
      const check = () => { const found = this.received.slice(from).find(match); if (found) done(found); else if (this.ended) done(undefined); };
      // deadline: a hub that never answers fails the read instead of hanging the test.
      const timer = setTimeout(() => done(undefined), 60_000);
      this.wakers.add(check);
      check();
    });
  }
  async call(method: string, params: unknown = {}): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const from = this.received.length;
    this.send({ v: 1, id, method, params });
    const reply = await this.seek((l) => l.id === id && ('result' in l || 'error' in l), from);
    if (!reply) throw Error(`BLOCKED: no reply to ${method}`);
    if ('error' in reply) throw Error(`BLOCKED: ${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  close(): void { this.sock.destroy(); }
}
const tokenOf = (root: string): string => readFileSync(join(root, 'control.token'), 'utf8').trim();
/** A connection that said hello as `app` or `cli` with the control token; returns it with the hub's role line. */
async function openAs(hub: Hub, role: 'app' | 'cli'): Promise<{ conn: Conn; roleLine: Line }> {
  const conn = await Conn.open(hub.socket);
  const from = conn.received.length;
  conn.send({ v: 1, hello: role, token: tokenOf(hub.root) });
  const roleLine = await conn.seek((l) => 'role' in l || 'error' in l, from);
  if (!roleLine || roleLine.role !== role) throw Error(`BLOCKED: the hub refused the ${role} hello: ${JSON.stringify(roleLine)}`);
  return { conn, roleLine };
}

// ---- Hook requests (hook.request@1), as deep-hook sends them.
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
function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  if (event === 'PreToolUse') Object.assign(base, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_3459_${++calls}` });
  return { ...base, ...extra };
}
/** One SessionStart hook exchange on a new connection, as deep-hook makes it: the hub's hello and its ack. */
async function sendHook(hub: Hub, h: Home): Promise<{ hello: Line; ack: Line }> {
  const conn = await Conn.open(hub.socket);
  try {
    conn.send({ v: 1, agent: 'claude-code', event: 'SessionStart', seq: nextSeq(), id: ulid(), matched: [], payload: payload(newSession(h), 'SessionStart'), pid: process.pid, ppid: process.ppid });
    const ack = await conn.seek((l) => 'ack' in l || 'error' in l, 1);
    if (!ack || !('ack' in ack)) throw Error(`BLOCKED: the hub didn't acknowledge a hook request: ${JSON.stringify(ack)}`);
    return { hello: conn.hello, ack };
  } finally {
    conn.close();
  }
}

// ---- The generation each connection is told (as #572's suite reads it).
/**
 * The writer generation the hub reports on a hook, an app and a cli connection: the `generation` field of its hello
 * line, or, where the hello carries none, of its first reply on that connection. Each role's reading, an integer or
 * what was said in its place.
 */
export async function generations(hub: Hub, h: Home): Promise<Record<'hook' | 'app' | 'cli', unknown>> {
  const seen: Record<string, unknown> = {};
  const hook = await sendHook(hub, h);
  seen.hook = hook.hello.generation ?? hook.ack.generation;
  for (const role of ['app', 'cli'] as const) {
    const { conn, roleLine } = await openAs(hub, role);
    seen[role] = conn.hello.generation ?? roleLine.generation;
    conn.close();
  }
  return seen as Record<'hook' | 'app' | 'cli', unknown>;
}
/** The one generation every connection reports; BLOCKED unless all three report the same integer (#572, on the base). */
export async function generationEverywhere(hub: Hub, h: Home): Promise<number> {
  const seen = await generations(hub, h);
  const values = new Set(Object.values(seen));
  if (values.size !== 1 || !Number.isSafeInteger(seen.hook)) throw Error(`BLOCKED: the hub reports no one writer generation on its connections: ${JSON.stringify(seen)}`);
  return seen.hook as number;
}

// ---- Evidence, through the app's connection (`evidence.paste`, #15/#16), so the evidence store holds a real file.
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
/** A valid 8 × 8 RGB PNG whose pixels come from `seed`. */
function png(seed: number): Uint8Array {
  const raw = Buffer.alloc((8 * 3 + 1) * 8);
  for (let i = 0; i < raw.length; i++) if (i % 25 !== 0) raw[i] = (seed * 31 + i * 7) & 0xff;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]));
}
export async function pasteEvidence(hub: Hub, seed: number): Promise<void> {
  const { conn } = await openAs(hub, 'app');
  try {
    await conn.call('evidence.paste', { bytes: Buffer.from(png(seed)).toString('base64'), type: 'image/png' });
  } finally {
    conn.close();
  }
}

// ---- Files, by hash and inode.
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}
export interface FileAt { hash: string; inode: number; device: number }
const fileAt = (path: string): FileAt => {
  const s = statSync(path);
  return { hash: sha256(readFileSync(path)), inode: s.ino, device: s.dev };
};
/**
 * What a restore replaces, as a backup lays it out: `ledger.db` and every file under `evidence/` and `wiki/` of `dir`,
 * by its path relative to `dir`, with its bytes' SHA-256 and its inode.
 */
export function recordFiles(dir: string): Map<string, FileAt> {
  const out = new Map<string, FileAt>();
  if (existsSync(join(dir, 'ledger.db'))) out.set('ledger.db', fileAt(join(dir, 'ledger.db')));
  for (const name of ['evidence', 'wiki']) for (const path of walk(join(dir, name))) out.set(relative(dir, path), fileAt(path));
  return out;
}

// ---- A ledger read off disk: copied to a scratch folder first (the database and its WAL, as SQLite would read them).
export interface Ev { id: string; kind: string; log_pos: number; ts: number }
/** The events `<dir>/ledger.db` holds, in log order; none when there is no ledger. */
export function eventsIn(dir: string): Ev[] {
  if (!existsSync(join(dir, 'ledger.db'))) return [];
  const into = join(tempDir(), 'read');
  mkdirSync(into);
  for (const name of ['ledger.db', 'ledger.db-wal']) if (existsSync(join(dir, name))) copyFileSync(join(dir, name), join(into, name));
  const db = new Database(join(into, 'ledger.db'));
  try {
    return db.prepare('SELECT id, kind, log_pos, ts FROM events ORDER BY log_pos').all() as Ev[];
  } finally {
    db.close();
  }
}
/** An event as a failure names it. */
export const named = (e: Ev): string => `${e.kind} ${e.id} (log position ${e.log_pos}, ${new Date(e.ts).toISOString()})`;

type JsonObject = { [key: string]: JsonValue };
/**
 * Appends `count` events to `<root>/ledger.db` with the hub stopped, through @deepbuild/record as #572's suite seeds
 * its record: each a `session.start` of a session of its own, 10 ms apart, the last at the time of the call. Closed
 * cleanly, so the next start is a clean one.
 */
async function appendEvents(h: Home, count: number): Promise<void> {
  const entry = catalogue().find((e) => e.kind === 'session.start');
  if (!entry) throw Error('BLOCKED: event kind session.start is not in the catalogue');
  const end = Date.now();
  let now = end - 10 * (count - 1);
  const record = await openRecord({ path: join(h.root, 'ledger.db'), now: () => now });
  try {
    for (let i = 0; i < count; i++, now += 10) {
      const fx = structuredClone(fixtures(entry.schema)[0]) as JsonObject;
      const session = randomUUID();
      const input: EventInput = { v: fx.v as number, id: ulid(now), kind: 'session.start', ts: now, data: { ...(fx.data as JsonObject), agent: 'claude-code', worktree: join(h.tmp, 'work', session.slice(0, 8)), branch: 'main', thread: session } };
      if (typeof fx.subject === 'string') input.subject = fx.subject;
      if (typeof fx.seq === 'string') input.seq = nextSeq(now);
      const conn: Connection = { writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' };
      await record.append(conn, input);
    }
    await record.sync();
  } finally {
    await record.close();
  }
}

// ---- The scene every criterion starts from: a record that holds 40 events its backup lacks.
export const WIKI_PAGE = 'restore-3459.md';
const WIKI_AT_BACKUP = '# Restore\n\nThe page as it was when the backup was taken.\n';
const WIKI_AFTER = '# Restore\n\nThe page as edited after the backup: a restore that keeps nothing loses this.\n';
export interface Scene {
  h: Home;
  /** The backup `deep backup` wrote, an earlier copy of the record. */
  folder: string;
  /** The generation the hub reported on every connection when the backup was taken. */
  generationAtBackup: number;
  /** The replaced record's events, in log order, read just before any restore. */
  events: Ev[];
  /** The 40 of them the backup lacks, in log order: the last is the newest. */
  lacking: Ev[];
  /** The replaced ledger, evidence and wiki, each file by hash and inode, read just before any restore. */
  files: Map<string, FileAt>;
}
/**
 * A record under a fresh home with a wiki page and one pasted image, `deep backup` of it through its running hub, then
 * the record moved on with the hub stopped: a second image, the page edited, a page added, and events appended until
 * the record holds exactly 40 the backup lacks. The log is checkpointed whole into `ledger.db` before it is hashed, so
 * the file's bytes are the record's.
 */
export async function makeScene(): Promise<Scene> {
  const h = makeHome();
  mkdirSync(join(h.root, 'wiki'), { recursive: true, mode: 0o700 });
  writeFileSync(join(h.root, 'wiki', WIKI_PAGE), WIKI_AT_BACKUP);
  const hub = await startHub(h);
  let generationAtBackup: number;
  const folder = backupFolder(h, 'earlier-copy');
  try {
    await pasteEvidence(hub, 1);
    generationAtBackup = await generationEverywhere(hub, h);
    await backup(h, folder);
    await pasteEvidence(hub, 2);
  } finally {
    await stopHub(hub);
  }
  writeFileSync(join(h.root, 'wiki', WIKI_PAGE), WIKI_AFTER);
  writeFileSync(join(h.root, 'wiki', 'added-after-3459.md'), '# Added after the backup\n');
  const inBackup = new Set(eventsIn(folder).map((e) => e.id));
  const since = eventsIn(h.root).filter((e) => !inBackup.has(e.id)).length;
  if (since >= LACKING) throw Error(`BLOCKED: the hub appended ${since} events between the backup and its stop; the scene needs fewer than ${LACKING}`);
  await appendEvents(h, LACKING - since);
  const db = new Database(join(h.root, 'ledger.db'), { fileMustExist: true });
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
  const events = eventsIn(h.root);
  const lacking = events.filter((e) => !inBackup.has(e.id));
  if (lacking.length !== LACKING) throw Error(`BLOCKED: the record holds ${lacking.length} events the backup lacks, not ${LACKING}`);
  const files = recordFiles(h.root);
  if (![...files.keys()].some((p) => p.startsWith(`evidence${sep}`)) || !files.has(join('wiki', WIKI_PAGE))) throw Error(`BLOCKED: the record holds no evidence file or wiki page to keep: ${[...files.keys()].join(', ')}`);
  return { h, folder, generationAtBackup, events, lacking, files };
}

// ---- The kept folder, as behavior names it.
/**
 * The kept folder as the command's last line names it (the issue's Scope: "the command's last line names the kept
 * folder and the command that puts it back"): the folder of a `deep restore <folder>` on the last line of stdout that
 * is a folder under the root, other than the one just restored. Undefined when the last line names none.
 */
export function keptNamedBy(r: Ran, h: Home, restored: string): string | undefined {
  const last = r.stdout.split('\n').filter((l) => l.trim()).pop() ?? '';
  for (const [, word] of last.matchAll(/deep restore\s+(\S+)/g)) {
    const bare = word!.replace(/^['"`]+/, '').replace(/['"`.,;:)]+$/, '');
    const path = resolve(bare.startsWith('~/') ? join(h.home, bare.slice(2)) : bare);
    if (path !== resolve(restored) && path.startsWith(h.root + sep) && existsSync(path) && statSync(path).isDirectory()) return path;
  }
  return undefined;
}
/**
 * Every folder under the root, at most two levels down, that holds a `ledger.db`: where a restore cut before its last
 * line can have moved the replaced ledger, with the inode it finds there.
 */
export function foldersWithLedger(h: Home): string[] {
  const out: string[] = [];
  const look = (dir: string, depth: number) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (existsSync(join(path, 'ledger.db'))) out.push(path);
      if (depth < 2) look(path, depth + 1);
    }
  };
  if (existsSync(h.root)) look(h.root, 1);
  return out;
}
/** Where the kept folder's files differ from the replaced record's: each file named, missing or differing by hash. */
export function keptProblems(kept: string, replaced: Map<string, FileAt>): string[] {
  const got = recordFiles(kept);
  const out: string[] = [];
  for (const [path, was] of replaced) {
    const what = path === 'ledger.db' ? `the kept ledger ${join(kept, path)}` : `the kept file ${join(kept, path)}`;
    if (!got.has(path)) out.push(`${what} is missing`);
    else if (got.get(path)!.hash !== was.hash) out.push(`${what} differs by hash from what was there`);
  }
  return out;
}

// ---- Days and times, as a sentence may print them. Every child runs with TZ=UTC, so these are UTC's.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const two = (n: number) => String(n).padStart(2, '0');
/**
 * A pattern for the day of `at`, in any of the usual spellings: 2026-11-26, 26 Nov 2026, 26 November, Nov 26,
 * November 26th, 26/11/2026, 11/26/2026 or 26.11.2026.
 */
export function dayPattern(at: Date): RegExp {
  const [y, m, d] = [at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate()];
  const month = `(?:${MONTHS[m - 1]}|${MONTHS[m - 1]!.slice(0, 3)})\\.?`;
  const day = `0?${d}(?:st|nd|rd|th)?`;
  return new RegExp(`${y}-${two(m)}-${two(d)}|\\b${day} ${month}(?![a-z])|\\b${month} ${day}\\b|\\b${two(d)}[/.]${two(m)}[/.]${y}\\b|\\b${two(m)}/${two(d)}/${y}\\b`, 'gi');
}
/** A pattern for the hour and minute of `at`: 21:07, 21:07:33, T21:07 or 9:07 PM. */
export function timePattern(at: Date): RegExp {
  const [h, min] = [at.getUTCHours(), two(at.getUTCMinutes())];
  const half = h < 12 ? 'am' : 'pm';
  return new RegExp(`(?<![\\d:])${two(h)}:${min}(?!\\d)|(?<![\\d:])${h}:${min}(?!\\d)|(?<![\\d:])0?${h % 12 || 12}:${min}(?::\\d\\d)?\\s?${half[0]}\\.?m`, 'i');
}
/** How many times a sentence names the day of `at`. */
export const dayCount = (sentence: string, at: Date): number => [...sentence.matchAll(dayPattern(at))].length;
/** The day of `at` as a failure prints it. */
export const dayOf = (at: Date): string => at.toISOString().slice(0, 10);
/** A sentence with the folders it names taken out, so no digit of a temp folder's name reads as a count or a time. */
export const withoutPaths = (sentence: string, ...paths: string[]): string => paths.sort((a, b) => b.length - a.length).reduce((text, path) => text.split(path).join('<folder>'), sentence);

// ---- deep-hook as an agent's hook entry runs it (#317).
/** The core's shipped guard@1 entries, installed verbatim as `<root>/rules.json`. */
export function installDefaultRules(h: Home): void {
  mkdirSync(h.root, { recursive: true });
  writeFileSync(join(h.root, 'rules.json'), readFileSync(DEFAULT_RULES));
}
/** `deep-hook claude-code PreToolUse` for a Bash command, the hook JSON on stdin, HOME the agent's. No agent call is run. */
export function hookOnBash(h: Home, s: Session, command: string): Promise<Ran> {
  const body = payload(s, 'PreToolUse', { tool_input: { command } });
  return run(DEEP_HOOK, ['claude-code', 'PreToolUse'], { cwd: s.cwd, env: childEnv(h), input: JSON.stringify(body), timeoutMs: 60_000 });
}
/** What deep-hook's output tells Claude Code about a PreToolUse: exit 2 or a deny decision denies; exit 0 allows. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
/** Text compared for "naming the command": quotes dropped and whitespace collapsed (as #317's and #572's suites compare it). */
const plain = (text: string): string => text.replace(/['"`\\]/g, '').replace(/\s+/g, ' ').trim();
export const names = (r: Ran, what: string): boolean => plain(`${r.stdout}\n${r.stderr}`).includes(plain(what));
