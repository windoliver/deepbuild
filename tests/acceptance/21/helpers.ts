// Shared test-side tools for the issue #21 acceptance tests: temp homes, the hub as a process (`deep hub run`), the
// socket's line protocol and `events.read`, deep-hook run through the hook timer (fixtures/hook-timer.rs), the
// recorded Claude Code tool calls of the fixture corpus (adapters/corpus/claude-code, #47), the spool as files, the
// reference-Mac gate and the design's five-runs judge. The process, socket, spool and timing parts are copied from
// tests/acceptance/315/helpers.ts and tests/acceptance/18/mapping/helpers.ts (same repo, same license); this suite
// keeps its own copy so a redraft of theirs never moves these tests. Nothing here stands in for deep-hook or the hub.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const DEEP_HOOK_RELEASE = join(REPO, 'target/release/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');

// Criterion tags: `#21.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #21.cd6952ad';
export const AC2 = 'AC2 #21.9a5768d4';
export const AC3 = 'AC3 #21.474533cd';
export const AC4 = 'AC4 #21.f7ca87ba';

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

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh21-'));
  made.push(dir);
  return dir;
}
/** A fresh home folder; the hub's root, deep-hook's spool and rules.json live in <home>/.deepbuild. */
export function makeHome(): string {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  return home;
}
export const rootOf = (home: string) => join(home, '.deepbuild');
/**
 * The shipped guard entries (#316's default process, stash, dispatch, git and config rules), as rules.json: what an
 * installed adapter's deep-hook matches every call against.
 */
export function writeDefaultRules(home: string): void {
  mkdirSync(rootOf(home), { recursive: true });
  copyFileSync(DEFAULT_RULES, join(rootOf(home), 'rules.json'));
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
/** The process's state letters from ps (`T` is stopped), or '' when it is gone. */
export function stateOf(pid: number): string {
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
/** Stops every process this suite started (SIGCONT and SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
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

/** Variables that mark which agent runs a hook, or bill an API account: a child never inherits this process's. */
const MARKERS = /^(CLAUDE|CURSOR|GROK|CODEX|ANTHROPIC|OPENAI|AWS_BEARER|DEEP_|XDG_|DH21_)/;
/** The environment a child gets: this one with HOME moved to the test's home and no agent markers, billing keys or DEEP_ settings. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (MARKERS.test(key) || key === 'AI_AGENT' || key === 'NODE_OPTIONS' || key.startsWith('GIT_')) continue;
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

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs a command to its end without blocking this process's event loop. */
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
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 60_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shownRan = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(-600))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;

// ---- Builds: the release deep-hook (what an installed adapter runs), and small native programs built by rustc.
let releaseBuild: Promise<string> | undefined;
export function buildDeepHook(): Promise<string> {
  releaseBuild ??= run('cargo', ['build', '--locked', '-q', '--release', '-p', 'deep-hook'], { timeoutMs: 900_000 }).then((r) => {
    if (r.code !== 0 || !existsSync(DEEP_HOOK_RELEASE)) throw Error(`BLOCKED: cargo build --release -p deep-hook failed: ${r.stderr.slice(-3000)}`);
    // The first exec of a new binary is slow on macOS (it is checked before it runs); no timed call pays for it.
    spawnSync(DEEP_HOOK_RELEASE, ['--version'], { stdio: 'ignore', timeout: 30_000 });
    return DEEP_HOOK_RELEASE;
  });
  return releaseBuild;
}
const natives = new Map<string, Promise<string>>();
/** A native program built by rustc at opt-level 3 from `source`, once per test process. */
export function buildNative(name: string, source: string): Promise<string> {
  let made = natives.get(name);
  if (!made) {
    const dir = join(tempDir(), name);
    mkdirSync(dir);
    writeFileSync(join(dir, `${name}.rs`), source);
    const binary = join(dir, name);
    made = run('rustc', ['-C', 'opt-level=3', '-o', binary, join(dir, `${name}.rs`)], { timeoutMs: 300_000 }).then((r) => {
      if (r.code !== 0) throw Error(`BLOCKED: rustc failed to build ${name}: ${r.stderr.slice(-2000)}`);
      spawnSync(binary, [], { stdio: 'ignore', input: '', timeout: 30_000 }); // the first exec of a new binary is slow on macOS
      return binary;
    });
    natives.set(name, made);
  }
  return made;
}
/** The hook timer (fixtures/hook-timer.rs). */
export const buildTimer = () => buildNative('hook-timer', readFileSync(join(FIXTURES, 'hook-timer.rs'), 'utf8'));
/** The floor: a native program that does nothing, `fn main() {}`. */
export const buildNoop = () => buildNative('noop', 'fn main() {}\n');

// ---- The hub as a process: `deep hub run` (#16).
export interface Ready { v: number; ready: true; pid: number; socket: string; start: string }
export interface HubProc { child: ChildProcess; pid: number; stderr(): string; ready: Promise<Ready | undefined>; exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> }
export interface Hub extends Ready { home: string; root: string; proc: HubProc }
export async function startHub(o: { home: string; plant?: string | undefined }, timeoutMs = 60_000): Promise<Hub> {
  const env = childEnv(o.home, { DEEP_HUB_PLANT: o.plant });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
        const line = parseObject(first);
        resolve(line && line.ready === true ? (line as Ready) : undefined);
      }
    });
    void exit.then(() => resolve(undefined));
  });
  const proc: HubProc = { child, pid: child.pid!, stderr: () => err, ready, exit };
  const r = await Promise.race([ready, sleep(timeoutMs).then(() => undefined)]);
  if (!r) throw Error(`BLOCKED: the hub didn't start (deep hub run${o.plant ? `, DEEP_HUB_PLANT=${o.plant}` : ''}): stderr: ${err.slice(0, 2000)}`);
  return { ...r, home: o.home, root: rootOf(o.home), proc };
}
export async function stopHub(hub: { pid: number; proc?: HubProc }, signal: NodeJS.Signals = 'SIGTERM', timeoutMs = 15_000): Promise<void> {
  try { process.kill(hub.pid, 'SIGCONT'); } catch { /* gone */ }
  try { process.kill(hub.pid, signal); } catch { return; }
  const deadline = Date.now() + timeoutMs;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  if (hub.proc) await hub.proc.exit;
}

// ---- The line protocol (#16): a cli connection with the control token, and `events.read`.
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
    const end = () => { this.ended = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  static open(path: string, timeoutMs = 10_000): Promise<Conn> {
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
/** One event as `events.read` returns it. */
export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; seq?: string; subject?: string; session?: string; agent?: string; data: Line }
/** Every event in the log, paged by log_pos through `events.read`. */
export async function allEvents(hub: { socket: string; root: string }): Promise<Ev[]> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    const out: Ev[] = [];
    let after = 0;
    for (;;) {
      const events = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos;
    }
  } finally {
    conn.close();
  }
}
/**
 * Polls the log until `done` holds and then for `quietMs` more (so a late duplicate shows), or until it stops
 * changing for `quietMs` or `timeoutMs` passes; resolves with the last read either way, so the test's own
 * assertions say what is missing.
 */
export async function settle(hub: { socket: string; root: string }, done: (events: Ev[]) => boolean, o: { timeoutMs?: number; quietMs?: number } = {}): Promise<Ev[]> {
  const deadline = Date.now() + (o.timeoutMs ?? 60_000);
  const quiet = o.quietMs ?? 5000;
  let last = -1;
  let since = Date.now();
  let doneAt: number | undefined;
  for (;;) {
    const events = await allEvents(hub);
    if (events.length !== last) { last = events.length; since = Date.now(); }
    if (done(events)) doneAt ??= Date.now();
    if ((doneAt !== undefined && Date.now() - doneAt >= quiet) || Date.now() - since > Math.max(quiet, 15_000) || Date.now() > deadline) return events;
    await sleep(250);
  }
}
/** A setup shared by a file's tests, made by the first test that needs it. */
export function shared<T>(make: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined;
  return () => (value ??= make());
}
/** The tool event for one call: the record keeps the call's tool_use_id in `data.call` (#18). */
export const forCall = (events: readonly Ev[], kind: 'tool.before' | 'tool.after', call: string): Ev[] => events.filter((e) => e.kind === kind && e.data?.call === call);
export const HOOK_KIND: Record<string, 'tool.before' | 'tool.after'> = { PreToolUse: 'tool.before', PostToolUse: 'tool.after' };

// ---- The address setting: <home>/.deepbuild/config.json, `{"hub": {"address": "unix:<path>"}}` (#16).
export function setAddress(home: string, address: string | undefined): void {
  const file = join(rootOf(home), 'config.json');
  mkdirSync(dirname(file), { recursive: true });
  const config = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Line) : {};
  if (address === undefined) delete config.hub;
  else config.hub = { ...(config.hub as Line | undefined), address };
  writeFileSync(file, `${JSON.stringify(config)}\n`);
}
// ---- A forwarded socket that keeps a copy of the bytes both ways (#16's forwarder, as #315's suite has it).
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

// ---- The spool: <home>/.deepbuild/spool/*.jsonl, every request line it holds.
export function spooled(home: string): Line[] {
  const dir = join(rootOf(home), 'spool');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => jsonLines(readFileSync(join(dir, f), 'utf8')));
}

// ---- The hook timer's files (fixtures/hook-timer.rs).
export interface Timed { spawnNs: bigint; endNs: bigint; pid: number; watched: boolean; payload: Line; file: string }
export function readTimings(dir: string): Timed[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().flatMap((f) => {
    const l = parseObject(readFileSync(join(dir, f), 'utf8'));
    if (!l) return [];
    return [{ spawnNs: BigInt(l.spawn_ns), endNs: BigInt(l.end_ns), pid: Number(l.pid), watched: l.watched === true, payload: (l.payload ?? {}) as Line, file: f }];
  });
}
/** ns between two wall-clock stamps, in ms. */
export const msBetween = (from: bigint, to: bigint): number => Number(to - from) / 1e6;

// ---- The fixture corpus's recorded Claude Code tool calls (adapters/corpus/claude-code/<version>/<set>/events.jsonl).
export interface RecordedCall { pre: Line; post: Line; from: string }
/** Every recorded tool call with both its PreToolUse and its PostToolUse payload, as Claude Code sent them. */
export function corpusToolCalls(): RecordedCall[] {
  const root = join(REPO, 'adapters/corpus/claude-code');
  const out: RecordedCall[] = [];
  for (const version of readdirSync(root).sort()) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    for (const set of readdirSync(join(root, version)).sort()) {
      const file = join(root, version, set, 'events.jsonl');
      if (!existsSync(file)) continue;
      const payloads = jsonLines(readFileSync(file, 'utf8')).map((l) => l.payload as Line).filter(Boolean);
      for (const pre of payloads.filter((p) => p.hook_event_name === 'PreToolUse')) {
        const post = payloads.find((p) => p.hook_event_name === 'PostToolUse' && p.tool_use_id === pre.tool_use_id);
        if (post) out.push({ pre, post, from: `${version}/${set}` });
      }
    }
  }
  return out;
}
/** A recorded payload moved into the test's session: its session, folder, transcript and call ID rewritten, the rest as recorded. */
export function rehome(payload: Line, s: { id: string; cwd: string; transcript: string }, call: string): Line {
  const text = JSON.stringify(payload).split(String(payload.cwd)).join(s.cwd);
  const out = JSON.parse(text) as Line;
  return { ...out, session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, tool_use_id: call };
}
export const newCallId = () => `toolu_dh21${randomBytes(10).toString('hex')}`;
export function newSession(home: string): { id: string; cwd: string; transcript: string } {
  const id = randomUUID();
  const cwd = join(tempDir(), 'work');
  mkdirSync(cwd, { recursive: true });
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}

// ---- Timing (#14's, #16's and #315's rule).
export function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.NaN;
}
export function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
export const isReferenceMachine = (m: Line | undefined): boolean =>
  !!m && REFERENCE_MACS.some((r) => r.model === m.model && r.chip === m.chip && Math.round(Number(m.memoryBytes) / 2 ** 30) === r.gib)
  && m.power === 'ac' && m.lowPowerMode === false && m.thermalState === 'nominal' && typeof m.macosBuild === 'string' && m.macosBuild.length > 0;
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state. */
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
/** The design's rule: PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const text = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(text);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${text}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${text}`);
}
/** hyperfine on PATH, or null. */
export function hyperfinePath(): string | null {
  const r = spawnSync('/bin/sh', ['-c', 'command -v hyperfine'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}
/** Runs `check` and returns the message of the assertion it fails, or null when it passes. */
export async function failureOf(check: () => unknown): Promise<string | null> {
  try {
    await check();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
