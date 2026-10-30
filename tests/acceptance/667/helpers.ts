// Test-side tools for the #667 checkpoint: a real hub (`deep hub run`) in a temporary home, with its clock set by
// DEEP_HUB_TEST_CLOCK at each start and its OS confirmation stubbed by DEEP_HUB_TEST_CONFIRM (#24's seam); the real
// `deep` CLI as a child process; an agent stand-in (fixtures/agent.mjs) whose hooks, `deep mcp` and shell commands
// the hub sees as a session's; a test consumer of the App API's live stream (#34) that resumes across hub starts;
// and the proof the issue names, printed at the end of each test. Processes are stopped by PID only.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection } from '../../../packages/record/src/index.ts';
import { askSources, openAsks } from '../../../packages/asks/src/index.ts';
import { withPlans } from '../plans.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const NODE = process.execPath;
export const SECOND = 1000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** How far past a deadline the hub's clock may run before an ask still open there fails (README: Readings). */
export const GRACE = 15_000;
/** How long before a deadline a restarted hub's clock starts, so the deadline passes while it runs. */
export const LEAD = 20_000;
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const parse = (raw: string): Line | undefined => { try { return JSON.parse(raw) as Line; } catch { return undefined; } };
export const load = (): string => loadavg().map((l) => l.toFixed(0)).join(' ');

/** Each criterion's tag: its number and the first 8 hex of SHA-256 of its text (README: Criteria). */
export const AC = {
  1: 'AC1 #667.84442921',
  2: 'AC2 #667.b25a1d05',
  3: 'AC3 #667.4014b343',
  4: 'AC4 #667.ca2b4f95',
  5: 'AC5 #667.b1086458',
} as const;

// ---- ULIDs, for the events the stand-ins append.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms = Date.now()): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted + Math.floor(Math.random() * 2 ** 40), i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}

// ---- Temp folders under /tmp/dh667-* (a socket path must fit in 104 bytes) and the processes this suite started.
const made: string[] = [];
const owned = new Set<number>();
export const own = (pid: number | undefined | null): void => { if (pid) owned.add(pid); };
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Stops every process this suite started, by PID (SIGTERM, then SIGKILL after 3 s), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
/** A home for one test: /tmp/dh667-XXXXXX/h, with the agent's working folder beside it. */
export function makeHome(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh667-'));
  made.push(dir);
  const home = join(dir, 'h');
  mkdirSync(home);
  return home;
}
export const rootOf = (home: string): string => join(home, '.deepbuild');

/** This environment with HOME moved to the test's home and none of the hub's test settings. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('TMUX') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
export interface Ran { code: number | null; stdout: string; stderr: string; t0: number; t1: number }
export function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs = 60_000): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(command, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, t0, t1: Date.now() }); });
  });
}
/** `deep <args>` from the built CLI, run by you: a child of this test process, under no agent. */
export const deep = (home: string, args: readonly string[]): Promise<Ran> => run(NODE, [CLI, ...args], childEnv(home));

// ---- Your ask settings, in ~/.deepbuild/config.json (#319's shape): the drafted ones with the issue's deadlines.
/**
 * The choice ask waits 4 hours and the authority ask 1 day (the issue's Scope); the rest are setup's drafts. Five
 * open asks fold the sixth (the design's drafted five). No `batch`: every ask shows when it's raised.
 */
export const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '4h', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export function writeSettings(home: string): void {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(home), 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
}

// ---- The authority ask, raised through the asks core before the hub starts, as the hub's core raises one.
export const PROJECT = 'shop';
const who = { actor: 'you', scope: 'you' };
/**
 * Seeds the agent's session and one authority ask for it (an `effect.push`), through the real record and asks core
 * on <home>/.deepbuild/ledger.db, with the hub stopped. The ask brings no deadline or default: the core fills both
 * from your settings (1 day; no). Resolves with its handle.
 */
export async function seedAuthority(home: string, agent: Agent, subject: string): Promise<string> {
  let now = Date.now();
  const record = await openRecord({ path: join(rootOf(home), 'ledger.db'), now: () => now });
  const asks = withPlans(await openAsks({ record, now: () => now, deliver: () => undefined, home: rootOf(home) }));
  try {
    await record.append({ writer: 'hook', ...who, session: agent.session, project: PROJECT, agent: 'claude-code' }, {
      v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: agent.cwd, branch: 'main', thread: agent.session },
    });
    now += 1;
    const core: Connection = { writer: 'core', ...who, session: agent.session, project: PROJECT };
    const source = askSources().find((row) => row.kind === 'authority')!.source;
    return await asks.raise(core, source, {
      kind: 'authority', question: `Push ${subject} to origin?`,
      options: [{ id: 'approve', label: 'Push it', decision: 'allow' }, { id: 'decline', label: 'Hold the push', decision: 'deny' }],
      recommended: null, fallback: 'you', provisional: false, owner: 'you', key: sha256(`authority:${subject}`),
      pinned_to: { kind: 'evidence', ref: sha256(subject) },
    });
  } finally {
    await record.close();
  }
}

// ---- The hub: `deep hub run` with HOME at the test's home, so its root is <home>/.deepbuild.
export interface Hub {
  pid: number; home: string; socket: string; confirm: string; start: string; child: ChildProcess;
  /** DEEP_HUB_TEST_CLOCK, when the test set the hub's clock; when it moves with the wall clock from then. */
  clock: number | undefined; spawnedAt: number; readyAt: number;
  output(): string;
}
export interface HubOptions { confirm: 'confirmed' | 'cancelled'; plant?: string | undefined; clock?: number | undefined }
/**
 * Starts the hub of `home`. Its OS confirmation is #24's stub: DEEP_HUB_TEST_CONFIRM names a file holding `confirmed`
 * or `cancelled`, read at each confirmation, so no test can raise a real Touch ID prompt. `clock` is where the hub's
 * clock starts (DEEP_HUB_TEST_CLOCK); it moves with real time from there.
 */
export async function startHub(home: string, o: HubOptions): Promise<Hub> {
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, `${o.confirm}\n`);
  const env = childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_CLOCK: o.clock === undefined ? undefined : String(o.clock) });
  const spawnedAt = Date.now();
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<Line | undefined>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parse(first.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), confirm, start: String(ready.start), child, clock: o.clock, spawnedAt, readyAt: Date.now(), output: () => out };
}
/** What the stubbed OS confirmation answers from now on. */
export const confirmWith = (hub: Hub, answer: 'confirmed' | 'cancelled'): void => writeFileSync(hub.confirm, `${answer}\n`);
/** SIGTERM to the hub, by its PID, and waits for it to exit. */
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (alive(hub.pid)) await sleep(20);
}
/** The hub's clock now, at the least: it started at `clock` no earlier than its ready line came. */
export const hubNowLow = (hub: Hub): number => (hub.clock === undefined ? Date.now() : hub.clock + (Date.now() - hub.readyAt));
/** The hub's clock now, at the most: it started at `clock` no later than its process was spawned. */
export const hubNowHigh = (hub: Hub): number => (hub.clock === undefined ? Date.now() : hub.clock + (Date.now() - hub.spawnedAt));
/**
 * Stops the hub and starts it again with its clock LEAD before `deadline`, so the deadline passes while it runs
 * (README: moving the hub's clock). BLOCKED if it took so long to start that its clock may already be past it.
 */
export async function restartBefore(hub: Hub, deadline: number, o: Omit<HubOptions, 'clock'>): Promise<Hub> {
  await stopHub(hub);
  const next = await startHub(hub.home, { ...o, clock: deadline - LEAD });
  if (hubNowHigh(next) >= deadline) throw Error(`BLOCKED: the hub took ${next.readyAt - next.spawnedAt} ms to start (load ${load()}), so its clock may have passed the deadline before it was ready`);
  return next;
}

// ---- The socket: one JSON line each way, `v: 1` (tests/acceptance/16/README.md, The socket).
export class Conn {
  private buffer = '';
  readonly lines: { line: Line; at: number }[] = [];
  private readonly wakers = new Set<() => void>();
  private readonly listeners: ((line: Line, at: number) => void)[] = [];
  private ids = 0;
  closed = false;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8').on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = parse(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) };
        const at = Date.now();
        this.lines.push({ line, at });
        this.buffer = this.buffer.slice(i + 1);
        for (const l of this.listeners) l(line, at);
      }
      for (const w of [...this.wakers]) w();
    });
    const end = () => { this.closed = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  /** Connects, reads the hub's hello, and presents `hello`; resolves with the connection and the hub's answer. */
  static async open(socket: string, hello: Line): Promise<{ conn: Conn; answer: Line | undefined }> {
    const conn = new Conn(net.connect(socket));
    if (!(await conn.wait(0))) throw Error(`BLOCKED: no hello from the hub at ${socket}`);
    conn.sock.write(`${JSON.stringify({ v: 1, ...hello })}\n`);
    return { conn, answer: await conn.wait(1) };
  }
  private wait(index: number, timeoutMs = 10_000): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.lines.length > index || this.closed) { clearTimeout(timer); this.wakers.delete(check); resolve(this.lines[index]?.line); }
      };
      const timer = setTimeout(() => { this.wakers.delete(check); resolve(undefined); }, timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  onLine(listener: (line: Line, at: number) => void): void { this.listeners.push(listener); }
  /** One method call; resolves with its reply line, `result` or `error`: the first line with its id. */
  async call(method: string, params: Line = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `t667#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await new Promise<Line | undefined>((resolve) => {
      const check = () => {
        const found = this.lines.find((l) => l.line.id === id);
        if (found || this.closed) { clearTimeout(timer); this.wakers.delete(check); resolve(found?.line); }
      };
      const timer = setTimeout(() => { this.wakers.delete(check); resolve(undefined); }, timeoutMs);
      this.wakers.add(check);
      check();
    });
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    return reply;
  }
  close(): void { this.sock.destroy(); }
}
/** A connection holding the control token, read from <home>/.deepbuild/control.token, as `deep` and the app hold it. */
export async function control(hub: Hub): Promise<Conn> {
  const token = readFileSync(join(rootOf(hub.home), 'control.token'), 'utf8').trim();
  const { conn, answer } = await Conn.open(hub.socket, { hello: 'cli', token });
  if (answer?.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(answer)}`);
  return conn;
}
export interface Ev { id: string; kind: string; subject?: string; writer: string; session?: string; project?: string; ts: number; data: Line; log_pos: number }
/** Every event in the hub's log, through `events.read`: the record's rows as the hub serves them. */
export async function events(hub: Hub): Promise<Ev[]> {
  const conn = await control(hub);
  try {
    const all: Ev[] = [];
    for (let after = 0; ;) {
      const reply = await conn.call('events.read', { after, limit: 1000 });
      if ('error' in reply) throw Error(`BLOCKED: events.read refused: ${JSON.stringify(reply.error)}`);
      const page = reply.result.events as Ev[];
      if (!page.length) return all;
      all.push(...page);
      after = page[page.length - 1]!.log_pos;
    }
  } finally {
    conn.close();
  }
}
export interface InboxRead { start: string; log_pos: number; asks: Line[] }
/** The App API's inbox read (#34): every ask with its status and outcome, and the log_pos the read reflects. */
export async function inboxRead(hub: Hub): Promise<InboxRead> {
  const conn = await control(hub);
  try {
    const reply = await conn.call('inbox.read', {});
    if ('error' in reply) throw Error(`BLOCKED: inbox.read refused: ${JSON.stringify(reply.error)}`);
    return reply.result as InboxRead;
  } finally {
    conn.close();
  }
}
/** The events that close an ask (#318's closed set, as events). */
export const CLOSING = new Set(['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot', 'ask.unanswerable']);
/** The ask's closing events, in log order. */
export const closings = (all: readonly Ev[], handle: string): Ev[] => all.filter((e) => CLOSING.has(e.kind) && e.subject === handle);
/** The decisions saved from the ask, or applied to it. */
export const decisionsOf = (all: readonly Ev[], handle: string): Ev[] =>
  all.filter((e) => (e.kind === 'decision.created' || e.kind === 'decision.applied') && e.data?.ask === handle);
export const createdOf = (all: readonly Ev[], handle: string): Ev | undefined => all.find((e) => e.kind === 'ask.created' && `ask:${e.id}` === handle);

// ---- The App API's live stream, read throughout by a test consumer (#34: stream.subscribe, frames by log_pos).
export interface Frame { log_pos: number; event: Ev; at: number; start: string }
export class Stream {
  readonly frames: Frame[] = [];
  /** Log positions framed more than once: the stream sends each event once. */
  readonly twice: number[] = [];
  readonly starts: string[] = [];
  private conn: Conn | undefined;
  private readonly wakers = new Set<() => void>();
  private constructor(readonly from: number) {}
  /** Subscribes after `after`: the log_pos an inbox read reflected, so it misses nothing after that read. */
  static async open(hub: Hub, after: number): Promise<Stream> {
    const stream = new Stream(after);
    await stream.attach(hub, after);
    return stream;
  }
  last(): number { return this.frames.length ? Math.max(...this.frames.map((f) => f.log_pos)) : this.from; }
  /** After a hub start: a new subscription after the last log_pos it holds, as #34's consumer resumes. */
  async resume(hub: Hub): Promise<void> {
    this.conn?.close();
    await this.attach(hub, this.last());
  }
  private async attach(hub: Hub, after: number): Promise<void> {
    const conn = this.conn = await control(hub);
    const reply = await conn.call('stream.subscribe', { after }, 20_000);
    if (!reply.result) throw Error(`BLOCKED: stream.subscribe refused: ${JSON.stringify(reply)}`);
    const sub = reply.id as string;
    const start = String(reply.result.start);
    this.starts.push(start);
    const take = (line: Line, at: number) => {
      if (line.id !== sub || !line.event) return;
      const event = line.event as Ev;
      if (this.frames.some((f) => f.log_pos === event.log_pos)) this.twice.push(event.log_pos);
      else this.frames.push({ log_pos: event.log_pos, event, at, start });
      for (const w of [...this.wakers]) w();
    };
    for (const { line, at } of conn.lines) take(line, at);
    conn.onLine(take);
  }
  /** The first frame matching `pred`, waiting up to `timeoutMs`. */
  waitFor(pred: (e: Ev) => boolean, timeoutMs: number): Promise<Frame | undefined> {
    return new Promise((resolve) => {
      const check = () => {
        const found = this.frames.find((f) => pred(f.event));
        if (found) { clearTimeout(timer); this.wakers.delete(check); resolve(found); }
      };
      const timer = setTimeout(() => { this.wakers.delete(check); resolve(undefined); }, timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  close(): void { this.conn?.close(); }
}
/** The stream frames the record's event, at its log_pos, within 5 s (#34 holds the stream to 50 ms at p95). */
export async function expectFramed(tag: string, stream: Stream, e: Ev, what: string): Promise<Frame | undefined> {
  const frame = await stream.waitFor((x) => x.log_pos === e.log_pos, 5000);
  expect(frame && [frame.event.id, frame.event.kind], `${tag}: the stream frames ${what} (${e.kind} ${e.subject ?? `ask:${e.id}`}) at log_pos ${e.log_pos}, where the record holds it`).toEqual([e.id, e.kind]);
  return frame;
}
/**
 * Every step shows the same on the stream: each ask, answer and decision event the record holds after the stream's
 * start is framed exactly once (within 5 s), at its log_pos, as the same event, and no frame differs from the record.
 */
export async function expectStreamMatchesRecord(tag: string, stream: Stream, hub: Hub): Promise<void> {
  const all = await events(hub);
  const steps = all.filter((e) => e.log_pos > stream.from && /^(ask|answer|decision)\./.test(e.kind));
  const until = Date.now() + 5000;
  while (Date.now() < until && steps.some((e) => !stream.frames.some((f) => f.log_pos === e.log_pos))) await sleep(100);
  expect(stream.twice, `${tag}: the stream framed these log positions more than once`).toEqual([]);
  const at = new Map(all.map((e) => [e.log_pos, e]));
  for (const f of stream.frames) {
    const held = at.get(f.log_pos);
    if (!held) continue;   // appended after the record was read
    expect([held.id, held.kind], `${tag}: the stream's frame at log_pos ${f.log_pos} (${f.event.kind} ${f.event.id}) is the record's event there`).toEqual([f.event.id, f.event.kind]);
  }
  for (const e of steps) {
    const framed = stream.frames.filter((f) => f.log_pos === e.log_pos).map((f) => [f.event.id, f.event.kind]);
    expect(framed, `${tag}: the stream shows ${e.kind} ${e.subject ?? `ask:${e.id}`} at log_pos ${e.log_pos}, as the record holds it`).toEqual([[e.id, e.kind]]);
  }
}

/**
 * The ask closes by its deadline: the test waits, reading only the record (no inbox read and no answer, which could
 * close an overdue ask on the way), until the hub's clock is GRACE past the deadline. Throws naming the criterion
 * and the ask when nothing closed it.
 */
export async function expectClosedByDeadline(tag: string, hub: Hub, handle: string, deadline: number, label: string): Promise<Ev[]> {
  let closed: Ev[] = [];
  for (;;) {
    closed = closings(await events(hub), handle);
    if (closed.length || hubNowLow(hub) >= deadline + GRACE) break;
    await sleep(500);
  }
  const past = Math.round((hubNowLow(hub) - deadline) / 1000);
  expect(closed.length, `${tag}: ask ${handle} (${label}) is still open ${past} s past its deadline ${new Date(deadline).toISOString()} on the hub's clock: every ask ends by its deadline`).toBeGreaterThan(0);
  return closed;
}

// ---- `deep inbox` output (#24): one line per open ask, its first four fields the handle, kind, session and age.
export interface Listed { ask: string; kind: string; session: string; age: string; line: string }
export function listed(stdout: string): Listed[] {
  return stdout.split('\n').map((l) => l.trim()).filter((l) => /^ask:[0-9A-Za-z]+\s/.test(l)).map((line) => {
    const [ask, kind, session, age] = line.split(/\s+/);
    return { ask: ask!, kind: kind!, session: session!, age: age!, line };
  });
}
/** `deep inbox`, which must exit 0; its rows. */
export async function inbox(home: string, proof: Proof, step: string): Promise<Listed[]> {
  const r = await deep(home, ['inbox']);
  proof.ran(`deep inbox: ${step}`, r);
  expect(r.code, `deep inbox exits 0 (${step}): ${r.stdout}${r.stderr}`).toBe(0);
  return listed(r.stdout);
}

// ---- The agent stand-in (fixtures/agent.mjs) and its session, as the hub sees it through its hooks.
export interface Outcome { isError: boolean; value: any; reply: Line }
export class Agent {
  private n = 0;
  private rpc = 0;
  private seq = BigInt(Date.now()) * 1_000_000n;
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess, readonly home: string, readonly cwd: string, readonly session: string, readonly transcript: string) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the agent stand-in exited' }); });
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
      }
    });
  }
  get pid(): number { return this.child.pid!; }
  /** An agent process working in a folder beside the home, with its transcript where Claude Code keeps it. */
  static start(home: string): Agent {
    const cwd = join(dirname(home), 'work');
    mkdirSync(cwd, { recursive: true });
    const session = randomUUID();
    const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${session}.jsonl`);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: session, cwd, message: { role: 'user', content: 'start' } })}\n`);
    const child = spawn(NODE, [AGENT], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Agent(child, home, cwd, session, transcript);
  }
  private send(command: Line, timeoutMs = 150_000): Promise<Line> {
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
  /** Its SessionStart, prompt and first tool call, each from a hook process it started, so the hub knows its process. */
  async establish(hub: Hub): Promise<void> {
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse']) {
      const payload: Line = { session_id: this.session, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default' };
      if (event === 'SessionStart') Object.assign(payload, { source: 'startup', model: 'claude-haiku-5-5' });
      if (event === 'UserPromptSubmit') Object.assign(payload, { prompt: 'fix the login page', prompt_id: randomUUID() });
      if (event === 'PreToolUse') Object.assign(payload, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomUUID()}` });
      const request = { v: 1, agent: 'claude-code', event, seq: String(this.seq += 1000n), id: ulid(), matched: [], payload };
      const r = await this.send({ op: 'hook', socket: hub.socket, request, cwd: this.cwd });
      if (!((r.lines as string[] | undefined) ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} from the agent: ${JSON.stringify(r)}`);
    }
  }
  /** `deep <args>` run by the agent through its own shell, as its Bash tool runs a command: the agent is above it. */
  async deep(args: readonly string[]): Promise<Ran> {
    const t0 = Date.now();
    const r = await this.send({ op: 'run', argv: [NODE, CLI, ...args], cwd: this.cwd });
    return { code: r.code as number, stdout: r.stdout as string, stderr: r.stderr as string, t0, t1: Date.now() };
  }
  /** One JSON-RPC request to the agent's own `deep mcp`, which the agent starts on first use. */
  async mcp(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const line = { jsonrpc: '2.0', id: `${method}#${++this.rpc}`, method, params };
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async initialize(): Promise<void> {
    const reply = await this.mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-667', version: '0' } });
    if (!reply?.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
  }
  /** A deep_* tool call; its value is the structured content, else the first text block's JSON. */
  async tool(name: string, args: Line, timeoutMs = 120_000): Promise<Outcome> {
    const reply = await this.mcp('tools/call', { name, arguments: args }, timeoutMs);
    const result = (reply?.result ?? {}) as Line;
    const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
    return { isError: !!reply?.error || result.isError === true, value: result.structuredContent ?? (typeof text === 'string' ? parse(text) ?? text : reply?.error), reply };
  }
  /** `ps -o lstart=` of this agent: how the hub tells its process from a reused PID. */
  started(): string { return execFileSync('ps', ['-o', 'lstart=', '-p', String(this.pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(); }
}
/** A call left running while the test goes on: its outcome, or why it failed. Never rejects. */
export function pending<T>(call: Promise<T>): Promise<{ returned?: T; failed?: string }> {
  return call.then((returned) => ({ returned }), (error: unknown) => ({ failed: String(error) }));
}
/** A question the session asks through deep_ask, as the agent's tool call writes it. */
export function question(kind: 'taste' | 'choice', text: string, options: [string, string][], recommended: string): Line {
  return { kind, question: text, options: options.map(([id, label]) => ({ id, label })), recommended, steps: null, where: null, why: null, check: null };
}
/** deep_ask from the agent's deep mcp, left waiting; the ask.created the hub filed for it, read from the record. */
export async function raise(agent: Agent, hub: Hub, args: Line): Promise<{ call: Promise<{ returned?: Outcome; failed?: string }>; created: Ev }> {
  const call = pending(agent.tool('deep_ask', args, 150_000));
  const until = Date.now() + 30_000;
  for (;;) {
    const created = (await events(hub)).find((e) => e.kind === 'ask.created' && e.data?.question === args.question);
    if (created) return { call, created };
    const ended = await Promise.race([call, sleep(200).then(() => undefined)]);
    if (ended) throw Error(`BLOCKED: deep_ask "${String(args.question)}" ended before the hub filed its ask: ${ended.failed ?? JSON.stringify(ended.returned?.reply).slice(0, 1500)}`);
    if (Date.now() > until) throw Error(`BLOCKED: the hub filed no ask.created for deep_ask "${String(args.question)}" within 30 s`);
  }
}

// ---- The proof the issue names: `deep inbox` output at each step, the stream's frames with their log positions,
// and the record's ask and decision rows. Printed at the end of each test, passed or failed.
export class Proof {
  private readonly out: string[] = [];
  constructor(readonly name: string) {}
  note(step: string, text: string): void { this.out.push(`-- ${step}\n${text.trimEnd()}`); }
  ran(step: string, r: Ran): void { this.note(`${step} (exit ${r.code}, ${r.t1 - r.t0} ms)`, `${r.stdout}${r.stderr}`); }
  frames(stream: Stream): void {
    this.note('the stream: frames with their log positions', stream.frames.map((f) => `${f.log_pos}\t${f.event.kind}\t${f.event.subject ?? `ask:${f.event.id}`}\tstart ${f.start}`).join('\n'));
  }
  rows(all: readonly Ev[]): void {
    this.note('the record: ask and decision rows', all.filter((e) => /^(ask|answer|decision)\./.test(e.kind))
      .map((e) => `${e.log_pos}\t${e.kind}\t${e.subject ?? `ask:${e.id}`}\tts ${e.ts}\t${JSON.stringify(e.data)}`).join('\n'));
  }
  async close(hub: Hub | undefined, stream: Stream | undefined): Promise<void> {
    if (stream) this.frames(stream);
    if (hub && alive(hub.pid)) await events(hub).then((all) => this.rows(all), (error: unknown) => this.note('the record', `unread: ${String(error)}`));
    console.log(`==== proof: ${this.name}\n${this.out.join('\n')}\n`);
  }
}
