// Shared test-side tools for the #1410 acceptance tests (README): the sync shim, built and parsed; the scenario run
// under it; the power-cut model that turns the shim's log into what a disk would hold after a cut; the hub as a
// process and its socket's line protocol. Nothing here stands in for DeepBuild: the record and the evidence store are
// reached through their public entries (scenario.mjs), the hub through `deep hub run` and its socket. Processes are
// stopped by PID only.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const HERE = join(REPO, 'tests/acceptance/1410');
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };

// ---- Temp folders: short real paths under /tmp, so a socket path fits.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1410-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
export function own(pid: number | undefined): void { if (pid) owned.add(pid); }
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Stops every process this suite started, by PID (SIGTERM, then SIGKILL after 5 s), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- The sync shim (shim/syncshim.c).
/** What counts as a sync here: on macOS only F_FULLFSYNC (a plain fsync leaves the write in the drive's cache). */
export const SYNC_OPS: ReadonlySet<string> = new Set(process.platform === 'darwin' ? ['F_FULLFSYNC'] : ['fsync', 'fdatasync', 'syncfs']);
/** Builds the shim with the system's `cc`; BLOCKED where it can't be built or preloaded. */
export function buildShim(): string {
  if (process.platform !== 'linux' && process.platform !== 'darwin') throw Error(`BLOCKED: the sync shim preloads on Linux and macOS only, not ${process.platform}`);
  const out = join(tempDir(), process.platform === 'darwin' ? 'syncshim.dylib' : 'syncshim.so');
  const args = process.platform === 'darwin'
    ? ['-dynamiclib', '-O1', '-o', out, join(HERE, 'shim/syncshim.c')]
    : ['-shared', '-fPIC', '-O1', '-o', out, join(HERE, 'shim/syncshim.c'), '-ldl'];
  try {
    execFileSync('cc', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw Error(`BLOCKED: the sync shim doesn't build with cc: ${(error as { stderr?: Buffer }).stderr?.toString() ?? String(error)}`);
  }
  return out;
}
/** The environment that preloads the shim into a process and everything it starts. */
export function shimEnv(shim: string, log: string, o: { watch?: string; slowUnder?: string; slowMs?: number } = {}): Record<string, string> {
  return {
    [process.platform === 'darwin' ? 'DYLD_INSERT_LIBRARIES' : 'LD_PRELOAD']: shim,
    SYNC_SHIM_LOG: log,
    // libuv's io_uring path would sync without a libc call the shim can see.
    UV_USE_IO_URING: '0',
    ...(o.watch ? { SYNC_SHIM_WATCH: o.watch } : {}),
    ...(o.slowUnder ? { SYNC_SHIM_SLOW_UNDER: o.slowUnder, SYNC_SHIM_SLOW_MS: String(o.slowMs ?? 0) } : {}),
  };
}

export interface SyncEntry { i: number; kind: 'S'; op: string; start: number; end: number; dev: string; ino: string; path: string }
export interface WriteEntry { i: number; kind: 'W'; dev: string; ino: string; path: string }
/** A name made: R a rename onto `path`, M a folder, C a file created; with the folder holding it. */
export interface NameEntry { i: number; kind: 'R' | 'M' | 'C'; dev: string; ino: string; pdev: string; pino: string; path: string; old?: string }
export type Entry = SyncEntry | WriteEntry | NameEntry;
/** The shim's log, in order; each entry numbered by its place. */
export function readLog(path: string): Entry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line, i): Entry => {
    const f = line.split('\t');
    if (f[0] === 'S') return { i, kind: 'S', op: f[1]!, start: Number(f[2]), end: Number(f[3]), dev: f[4]!, ino: f[5]!, path: f[6]! };
    if (f[0] === 'W') return { i, kind: 'W', dev: f[1]!, ino: f[2]!, path: f[3]! };
    return { i, kind: f[0] as 'R' | 'M' | 'C', dev: f[1]!, ino: f[2]!, pdev: f[3]!, pino: f[4]!, path: f[5]!, ...(f[6] ? { old: f[6] } : {}) };
  });
}
/** True when entry `e` is a sync that covers the file or folder (dev, ino). */
export const syncs = (e: Entry, dev: string, ino: string): boolean =>
  e.kind === 'S' && SYNC_OPS.has(e.op) && e.dev === dev && (e.ino === ino || e.op === 'syncfs');
/** Every sync of (dev, ino) the log holds, of any op, for reporting what was seen. */
export const syncsSeen = (log: Entry[], dev: string, ino: string): Entry[] => log.filter((e) => e.kind === 'S' && e.dev === dev && e.ino === ino);
export const idOf = (path: string): { dev: string; ino: string } => {
  const st = statSync(path, { bigint: true });
  return { dev: String(st.dev), ino: String(st.ino) };
};

// ---- The scenario (scenario.mjs), run once under the shim.
export interface Outcome {
  cited: string; uncited: string; verdict: string; ask: string; tool: string;
  verdictEvidence: string[]; askEvidence: string[]; toolEvidence: string[];
  expected: { command: string; prompt: string };
}
export interface Scenario { tmp: string; root: string; ledger: string; markers: string; log: Entry[]; out: Outcome }
export async function runScenario(shim: string): Promise<Scenario> {
  const tmp = tempDir();
  const root = join(tmp, 'evidence');
  const markers = join(tmp, 'markers');
  const ledger = join(tmp, 'record', 'ledger.db');
  // The evidence root exists before the run, its own name already durable: the model judges only what the run makes.
  mkdirSync(root);
  mkdirSync(markers);
  mkdirSync(dirname(ledger));
  const logPath = join(tmp, 'sync.log');
  const env = { ...process.env, ...shimEnv(shim, logPath, { watch: root }) };
  delete env.NODE_OPTIONS;
  const r = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(NODE, [join(HERE, 'scenario.mjs'), root, ledger, markers], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  if (r.code !== 0) throw Error(`BLOCKED: the scenario didn't run (is the repo built? npm run build --workspaces): exit ${r.code}, ${r.stderr.slice(0, 3000)}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop()!) as Outcome;
  return { tmp, root, ledger, markers, log: readLog(logPath), out };
}
/** The index of the marker sync `name` (scenario.mjs's mark()). */
export function markerAt(s: Scenario, name: string): number {
  const found = s.log.find((e) => e.kind === 'S' && e.path === join(s.markers, name));
  if (!found) throw Error(`BLOCKED: the shim never saw the scenario's marker sync "${name}", so it doesn't see this process's syncs`);
  return found.i;
}
/** The FULL commit between two markers: the last sync of the record's WAL there. */
export function fullCommit(s: Scenario, before: string, after: string): SyncEntry {
  const [from, to] = [markerAt(s, before), markerAt(s, after)];
  const wal = s.log.filter((e): e is SyncEntry => e.kind === 'S' && e.path === `${s.ledger}-wal` && SYNC_OPS.has(e.op) && e.i > from && e.i < to);
  if (!wal.length) throw Error(`BLOCKED: the shim saw no sync of the record's WAL between "${before}" and "${after}", so that append made no FULL commit it can see`);
  return wal[wal.length - 1]!;
}
export const fileOf = (root: string, sha: string): string => join(root, sha.slice(0, 2), sha.slice(2));

// ---- The power-cut model.
/**
 * What a disk would hold of the evidence root after a power cut right after log entry `cut - 1`, as a copy at `image`.
 * A POSIX disk keeps, at a cut: a file's bytes only if the file was synced after its last write; a name made by a
 * rename or a create only if its folder was synced after it; and a folder made by mkdir only if the folder holding it
 * was synced after. A file whose bytes weren't kept is left empty, a name that wasn't kept is removed, a folder that
 * wasn't kept is removed with all it holds, and what the run made after the cut is not there. What existed before the
 * run is kept as it was.
 */
export function imageAtCut(log: Entry[], cut: number, root: string, image: string): void {
  cpSync(root, image, { recursive: true });
  const before = log.slice(0, cut);
  const syncedAfter = (dev: string, ino: string, from: number) => before.some((e) => e.i > from && syncs(e, dev, ino));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  walk(root);
  for (const path of files) {
    const target = join(image, relative(root, path));
    const { dev, ino } = idOf(path);
    const named = log.filter((e) => (e.kind === 'R' || e.kind === 'C') && e.path === path);
    if (named.length) {
      const last = before.filter((e) => (e.kind === 'R' || e.kind === 'C') && e.path === path).pop() as NameEntry | undefined;
      if (!last || !syncedAfter(last.pdev, last.pino, last.i)) { rmSync(target, { force: true }); continue; }
    }
    const writes = log.filter((e) => e.kind === 'W' && e.dev === dev && e.ino === ino);
    if (writes.length) {
      const late = writes.some((w) => w.i >= cut);
      const lastWrite = before.filter((e) => e.kind === 'W' && e.dev === dev && e.ino === ino).pop();
      if (late || !lastWrite || !syncedAfter(dev, ino, lastWrite.i)) truncateSync(target, 0);
    }
  }
  for (const made of log.filter((e): e is NameEntry => e.kind === 'M' && (e.path === root || e.path.startsWith(`${root}/`)))) {
    if (made.i >= cut || !syncedAfter(made.pdev, made.pino, made.i)) rmSync(join(image, relative(root, made.path)), { recursive: true, force: true });
  }
}

// ---- The hub as a process (`deep hub run`, HOME a temp home), and its socket's line protocol (#16).
export interface Home { tmp: string; home: string; root: string }
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  return { tmp, home, root: join(home, '.deepbuild') };
}
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
export function childEnv(h: Home, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('GIT_') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' }, extra);
  return env;
}
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; exit: Promise<void>; output(): string }
export async function startHub(h: Home, extra: Record<string, string>): Promise<Hub> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the hub isn't built (${relative(REPO, CLI)} is missing): run npm run build --workspaces`);
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: h.tmp, env: childEnv(h, extra), stdio: ['ignore', 'pipe', 'pipe'] });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(/"ready":\s*true/.test(first.split('\n')[0]!)); }
    });
    void exit.then(() => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start (deep hub run, HOME ${h.home}): ${out.slice(0, 2000)}`);
  return { pid: child.pid!, socket: join(h.root, 'hub.sock'), root: h.root, child, exit, output: () => out };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const killed = sleep(30_000).then(() => { try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ } });
  await Promise.race([hub.exit, killed]);
}

export class Conn {
  readonly received: { line: Line; at: number }[] = [];
  ended = false;
  private buffer = '';
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
        let line: Line;
        try { line = JSON.parse(raw) as Line; } catch { line = { unparsed: raw }; }
        this.received.push({ line, at });
      }
      for (const w of [...this.wakers]) w();
    });
    const end = () => { this.ended = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  /** Connects and waits for the hub's hello line. */
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
  send(message: unknown): void { this.sock.write(`${JSON.stringify(message)}\n`); }
  seek(match: (line: Line) => boolean, from: number, timeoutMs: number): Promise<{ line: Line; at: number } | undefined> {
    return new Promise((resolve) => {
      const done = (v: { line: Line; at: number } | undefined) => { clearTimeout(timer); this.wakers.delete(check); resolve(v); };
      const check = () => { const found = this.received.slice(from).find((r) => match(r.line)); if (found) done(found); else if (this.ended) done(undefined); };
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
    if ('error' in reply.line) throw Error(`${method} refused: ${JSON.stringify(reply.line.error)}`);
    return reply.line.result as Line;
  }
  close(): void { this.sock.destroy(); }
}
/** A control connection: hello as `cli` with the control token. */
export async function control(hub: Hub): Promise<Conn> {
  const conn = await Conn.open(hub.socket);
  const from = conn.received.length;
  conn.send({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() });
  const role = await conn.seek((l) => 'role' in l || 'error' in l, from, 10_000);
  if (role?.line.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(role?.line)}`);
  return conn;
}
export interface Ev { id: string; kind: string; log_pos: number; session?: string; data: Line; evidence?: string[] }
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

// ---- A Claude Code session's hooks, sent as deep-hook sends them (hook.request@1), one connection each.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const base32 = (value: bigint, length: number): string => {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
};
export const ulid = (ms = Date.now()): string => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
let seqCounter = 0n;
const nextSeq = (): string => { seqCounter += 1n; return (BigInt(Date.now()) * 1_000_000n + (seqCounter % 1_000_000n)).toString(); };
export class Session {
  readonly id = randomUUID();
  readonly cwd: string;
  readonly transcript: string;
  private parent: string | null = null;
  constructor(h: Home, private readonly hub: Hub) {
    this.cwd = join(h.tmp, 'work');
    mkdirSync(this.cwd, { recursive: true });
    this.transcript = join(h.home, '.claude/projects', this.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
  }
  /** A transcript entry, as Claude Code writes one before the hook that follows it. */
  entry(value: Line): void {
    const uuid = randomUUID();
    writeFileSync(this.transcript, `${JSON.stringify({ parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', cwd: this.cwd, sessionId: this.id, gitBranch: 'main' })}\n`, { flag: 'a' });
    this.parent = uuid;
  }
  /** One hook call: the time from sending the request to the hub's reply line (`exit`), and the reply. */
  async hook(event: string, fields: Line = {}): Promise<{ ms: number; ack?: Line; reply?: Line }> {
    const conn = await Conn.open(this.hub.socket);
    try {
      const from = conn.received.length;
      const t0 = performance.now();
      conn.send({ v: 1, agent: 'claude-code', event, seq: nextSeq(), id: ulid(), pid: process.pid, ppid: process.ppid, matched: [],
        payload: { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...fields } });
      const ack = await conn.seek((l) => 'ack' in l || 'error' in l, from, 30_000);
      const reply = await conn.seek((l) => 'exit' in l || 'error' in l, from, 60_000);
      return { ms: (reply?.at ?? Number.POSITIVE_INFINITY) - t0, ...(ack ? { ack: ack.line } : {}), ...(reply ? { reply: reply.line } : {}) };
    } finally {
      conn.close();
    }
  }
  async prompt(text: string): Promise<{ ms: number; ack?: Line; reply?: Line }> {
    this.entry({ type: 'user', message: { role: 'user', content: text } });
    return this.hook('UserPromptSubmit', { prompt: text });
  }
}
