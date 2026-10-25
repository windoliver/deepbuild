// Test-side tools for the #26 acceptance tests: a real hub (`deep hub run`) in a temporary home, its record seeded
// beforehand through the real record and asks core, the real `deep` CLI and `deep mcp` as child processes, an agent
// stand-in (fixtures/agent.mjs) whose hooks and `deep mcp` are its children, so the hub sees a true process tree, and
// a `deep mcp` started by hand from this test process (no agent above it). Every observation goes through the MCP
// protocol, the hub's socket, `deep` commands or files under the hub's root; no hub or CLI module is imported.
// Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import { openRecord, type Connection, type RecordStore } from '../../../packages/record/src/index.ts';
import { askSources, openAsks, type AskKind, type Asks } from '../../../packages/asks/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const NODE = process.execPath;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
const parse = (raw: string): Line | undefined => { try { return JSON.parse(raw) as Line; } catch { return undefined; } };
/** A short random word of lower-case letters and digits, starting with a letter. */
export const word = (n = 8): string => `q${randomBytes(n).toString('hex').slice(0, n - 1)}`;

/** The tools #26 names: its scope's, the two the base already serves, and deep_run (criterion 16 and Done when). */
export const REQUIRED_TOOLS = ['deep_ask', 'deep_wait', 'deep_open_item', 'deep_status', 'deep_search', 'deep_claim', 'deep_evidence', 'deep_run'];

// ---- ULIDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms = Date.now()): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted + Math.floor(Math.random() * 2 ** 40), i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}

// ---- Temp folders (short: a socket path must fit in 104 bytes on macOS) and the processes this suite started.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh26-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
export const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
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

/** This environment with HOME moved to the test's home and none of the hub's settings, plus `extra`. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('TMUX') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
export interface Ran { code: number | null; stdout: string; stderr: string; ms: number }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 60_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: performance.now() - t0 }); });
  });
}
/** `deep <args>` from the built CLI, run by you: a child of this test process, under no agent. */
export const deep = (home: string, args: readonly string[]): Promise<Ran> => run(NODE, [CLI, ...args], { env: childEnv(home) });

// ---- A home and a worktree: a git repo with the repo's spec, .deepbuild/done.yaml.
export const rootOf = (home: string): string => join(home, '.deepbuild');
/** A temp folder with a home in it: <tmp>/h. */
export function makeHome(): { tmp: string; home: string } {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  return { tmp, home };
}
/**
 * The repo's spec. Two command checks that fail (`false`), and the values the ask rules leave open, as the design's
 * done.yaml declares them (a value nobody declares makes what depends on it BLOCKED).
 */
export function doneYaml(extraChecks: string[] = []): string {
  return [
    'claims:',
    '  done:',
    '    checks: [unit, lint]',
    'checks:',
    '  unit: { type: command, run: "false" }',
    '  lint: { type: command, run: "false" }',
    ...extraChecks.map((line) => `  ${line}`),
    'asks:',
    '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
    '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
    '  fallback: [change-owner]',
    '',
  ].join('\n');
}
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
/** A worktree at `dir`: a fresh git repo of its own (never this checkout) whose one commit holds `files` and the spec. */
export function makeWorktree(dir: string, o: { checks?: string[] | undefined; files?: Record<string, string> | undefined } = {}): { path: string; commit: string } {
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), doneYaml(o.checks));
  for (const [name, text] of Object.entries(o.files ?? {})) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const env = { ...process.env, ...GIT_ENV, HOME: dir };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return { path: realpathSync(dir), commit: git('rev-parse', 'HEAD') };
}

// ---- The record, seeded before the hub starts, through the real record and asks core (as the hub's core would).
const who = { actor: 'you', scope: 'you' };
export const PROJECT = 'shop';
const core = (session: string): Connection => ({ writer: 'core', ...who, session, project: PROJECT });
const OPTIONS: Record<string, Line[]> = {
  authority: [{ id: 'approve', label: 'Push it', decision: 'allow' }, { id: 'decline', label: 'Hold the push', decision: 'deny' }],
  taste: [{ id: 'blue', label: 'Blue header', decision: 'none' }, { id: 'green', label: 'Green header', decision: 'none' }],
  choice: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }],
};
const DEFAULT: Record<string, string> = { authority: 'decline', taste: 'blue', choice: 'sqlite' };
/** An ask as ask.created@1 data, open until `deadline`. */
export function askData(kind: 'authority' | 'taste' | 'choice', question: string, raised: number, deadline = raised + DAY): Line {
  return {
    kind, question, options: structuredClone(OPTIONS[kind]), recommended: kind === 'authority' ? null : DEFAULT[kind], deadline,
    fallback: 'you', default: DEFAULT[kind], provisional: false, owner: 'you', key: sha256(`${kind}:${question}`),
    pinned_to: { kind: 'evidence', ref: sha256(question) },
  };
}
const sourceOf = (kind: AskKind): string => askSources().find((row) => row.kind === kind && !/^(asks|request)\./.test(row.source))!.source;

export interface Seeding {
  record: RecordStore;
  asks: Asks;
  /** Moves the seeding clock. */
  at(ms: number): void;
  now(): number;
  /** session.start for a session of the repo `shop` in `worktree`, as its hook would append it. */
  start(session: string, worktree?: string): Promise<void>;
  /** An ask raised for the session by DeepBuild's core, now; its handle. */
  raise(session: string, kind: 'authority' | 'taste' | 'choice', question: string, deadline?: number): Promise<string>;
}
/** Seeds <home>/.deepbuild/ledger.db with the hub stopped, then closes it. */
export async function seed(home: string, fill: (s: Seeding) => Promise<void>, start = Date.now()): Promise<void> {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  let now = start;
  const record = await openRecord({ path: join(rootOf(home), 'ledger.db'), now: () => now });
  const asks = await openAsks({ record, now: () => now, deliver: () => undefined });
  try {
    await fill({
      record, asks,
      at: (ms) => { now = ms; },
      now: () => now,
      start: async (session, worktree = '/work/shop') => {
        await record.append({ writer: 'hook', ...who, session, project: PROJECT, agent: 'claude-code' }, { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree, branch: 'main', thread: session } });
      },
      raise: (session, kind, question, deadline) => asks.raise(core(session), sourceOf(kind), askData(kind, question, now, deadline)),
    });
  } finally {
    await record.close();
  }
}

/**
 * A heavy month (README: Budgets): 30 days of 20 sessions, each with its start, five asks and a decision saved from
 * the first, and an open item, so search reads 30 days of what it searches: 3,000 asks, 600 decisions and 600 open
 * items, appended through the record as the core would; `term` is in a share of each. The asks past their deadlines
 * take their defaults before the hub starts, so its start has none left to close.
 */
export async function seedMonth(s: Seeding, worktree: string, term: string): Promise<void> {
  const end = Date.now() - MINUTE;
  const conn = (session: string) => ({ writer: 'core', actor: 'you', scope: 'you', session, project: PROJECT });
  for (let d = 0; d < 30; d++) {
    const dayStart = end - (30 - d) * DAY;
    for (let n = 0; n < 20; n++) {
      const session = `D${d}S${n}`;
      let at = dayStart + n * 30 * MINUTE;
      s.at(at);
      await s.start(session, worktree);
      const appends: Promise<unknown>[] = [];
      for (let k = 0; k < 5; k++) {
        at += MINUTE;
        const question = `Keep the ${k % 3 ? 'store' : term} ${d}-${n}-${k} on SQLite or plain files?`;
        const id = ulid(at);
        appends.push(s.record.append(conn(session), { v: 1, id, kind: 'ask.created', ts: at, data: askData('choice', question, at) }));
        if (k === 0) appends.push(s.record.append(conn(session), { v: 1, id: ulid(at + 1), kind: 'decision.created', ts: at + 1, data: { key: sha256(question), scope: `repo:${PROJECT}`, answer: 'files', ask: `ask:${id}` } }));
      }
      appends.push(s.record.append(conn(session), { v: 1, id: ulid(at + 2), kind: 'open_item.opened', ts: at + 2, data: { task_ref: `task:${ulid(at)}`, text: `the ${n % 4 ? 'journey' : term} for day ${d} is still open` } }));
      await Promise.all(appends);
    }
  }
  s.at(end);
  await s.asks.tick();
}

// ---- The hub: `deep hub run` with HOME at the test's home, so its root is <home>/.deepbuild.
export interface Hub { pid: number; home: string; socket: string; child: ChildProcess; output(): string }
export interface HubOptions {
  /** DEEP_HUB_PLANT: a planted wrong program (README: Wrong programs). */
  plant?: string | undefined;
  /** DEEP_HUB_TEST_INDEX: a module whose default export returns the index@1 fill the hub uses for the wiki. */
  index?: string | undefined;
}
/**
 * Starts the installed hub of `home`. Its OS confirmation is #24's stub (DEEP_HUB_TEST_CONFIRM), always `confirmed`
 * here, so `deep inbox answer` run by you counts.
 */
export async function startHub(home: string, o: HubOptions = {}): Promise<Hub> {
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const env = childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_INDEX: o.index });
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
      if (first.includes('\n')) { clearTimeout(timer); resolve(parse(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), child, output: () => out };
}
/** SIGTERM to the hub, by its PID, and waits for it to exit. */
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(10);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (alive(hub.pid)) await sleep(10);
}

// ---- The socket: one JSON line each way, `v: 1` (tests/acceptance/16/README.md, The socket).
export class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private readonly wakers = new Set<() => void>();
  private ids = 0;
  private closed = false;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8').on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        this.lines.push(parse(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) });
        this.buffer = this.buffer.slice(i + 1);
      }
      for (const w of [...this.wakers]) w();
    });
    const end = () => { this.closed = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  /** Connects, reads the hub's hello, and presents `hello`; resolves with the connection and the hub's answer to it. */
  static async open(socket: string, hello: Line): Promise<{ conn: Conn; answer: Line | undefined }> {
    const conn = new Conn(net.connect(socket));
    if (!(await conn.wait(0))) throw Error(`BLOCKED: no hello from the hub at ${socket}`);
    conn.sock.write(`${JSON.stringify({ v: 1, ...hello })}\n`);
    return { conn, answer: await conn.wait(1) };
  }
  private wait(index: number, timeoutMs = 10_000): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.lines.length > index || this.closed) { clearTimeout(timer); this.wakers.delete(check); resolve(this.lines[index]); }
      };
      const timer = setTimeout(() => { this.wakers.delete(check); resolve(undefined); }, timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  /** One method call; resolves with its reply line, `result` or `error`. */
  async call(method: string, params: Line = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `t26#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await new Promise<Line | undefined>((resolve) => {
      const check = () => {
        const found = this.lines.find((l) => l.id === id);
        if (found || this.closed) { clearTimeout(timer); this.wakers.delete(check); resolve(found); }
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
/** A connection holding the control token, read from <home>/.deepbuild/control.token, as `deep` holds it. */
export async function control(hub: Hub): Promise<Conn> {
  const token = readFileSync(join(rootOf(hub.home), 'control.token'), 'utf8').trim();
  const { conn, answer } = await Conn.open(hub.socket, { hello: 'cli', token });
  if (answer?.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(answer)}`);
  return conn;
}
export interface Ev { id: string; kind: string; subject?: string; writer: string; session?: string; ts: number; data: Line; log_pos: number }
/** Every event in the hub's log, through `events.read`. */
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
/** The first event matching `pred`, polling the log until `timeoutMs`; undefined if none came. */
export async function eventMatching(hub: Hub, pred: (e: Ev) => boolean, timeoutMs = 10_000): Promise<Ev | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await events(hub)).find(pred);
    if (found || Date.now() > deadline) return found;
    await sleep(100);
  }
}
/** A call left running while the test goes on: its outcome, or why it failed. Never rejects. */
export function pending(call: Promise<Outcome>): Promise<{ returned?: Outcome; failed?: string }> {
  return call.then((o) => ({ returned: o }), (error: unknown) => ({ failed: String(error) }));
}
/**
 * The event a waiting call files: whichever comes first, the event matching `pred` or the call ending. A call that
 * ends first, or nothing filed in 20 s, throws naming `what`.
 */
export async function filedWhileWaiting(call: ReturnType<typeof pending>, hub: Hub, pred: (e: Ev) => boolean, what: string): Promise<Ev> {
  const first = await Promise.race([
    call.then((ended) => ({ ended })),
    eventMatching(hub, pred, 20_000).then((event) => ({ event }), (error: unknown) => ({ event: undefined, error: String(error) })),
  ]);
  if ('ended' in first) throw Error(`${what}: the call ended before it filed anything: ${first.ended.failed ?? JSON.stringify(first.ended.returned?.reply).slice(0, 1500)}`);
  if (!first.event) throw Error(`${what}: nothing was filed within 20 s${'error' in first ? ` (${first.error})` : ''}`);
  return first.event;
}

// ---- MCP: newline-delimited JSON-RPC 2.0 over a `deep mcp` process's stdio, as a real MCP client speaks it.
export interface Exchange { reply: Line; ms: number; pid: number }
/** A `deep mcp` this suite talks to: the agent stand-in's own, or one started by hand. */
export interface Mcp {
  request(method: string, params?: Line, timeoutMs?: number): Promise<Exchange>;
  notify(method: string, params?: Line): Promise<void>;
}
/** A tool call's outcome: `isError`, and its value (structuredContent, else the first text block's JSON). */
export interface Outcome { isError: boolean; value: any; reply: Line; ms: number; protocolError: boolean }
let rpc = 0;
export const nextId = (what: string): string => `${what}#${++rpc}`;
export async function initialize(m: Mcp): Promise<Line> {
  const { reply } = await m.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-26', version: '0' } });
  if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
  await m.notify('notifications/initialized');
  return reply.result as Line;
}
export interface Tool { name: string; description?: string; inputSchema: Line }
export async function listTools(m: Mcp): Promise<Tool[]> {
  const { reply } = await m.request('tools/list', {});
  if (!Array.isArray(reply.result?.tools)) throw Error(`BLOCKED: tools/list gave no tools: ${JSON.stringify(reply)}`);
  return reply.result.tools as Tool[];
}
export function outcomeOf(reply: Line, ms: number): Outcome {
  if (reply.error) return { isError: true, value: reply.error, reply, ms, protocolError: true };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
  const value = result.structuredContent ?? (typeof text === 'string' ? parse(text) ?? text : undefined);
  return { isError: result.isError === true, value, reply, ms, protocolError: false };
}
export async function callTool(m: Mcp, name: string, args: Line, timeoutMs?: number): Promise<Outcome> {
  const { reply, ms } = await m.request('tools/call', { name, arguments: args }, timeoutMs);
  return outcomeOf(reply, ms);
}
/** The tool's error, held to the shared shape: a tool result with isError whose value validates against error@2. */
export function errorOf(o: Outcome, what: string): Line {
  expect(o.protocolError, `${what}: an error must be a tool result with isError, holding error@2, not a JSON-RPC error: ${JSON.stringify(o.reply)}`).toBe(false);
  expect(o.isError, `${what} must be refused: ${JSON.stringify(o.reply).slice(0, 1500)}`).toBe(true);
  const checked = validate('error@2', o.value);
  expect(checked.ok ? [] : (checked as { issues: Line[] }).issues.map((i) => `${i.path}: ${i.remediation}`), `${what}: the error must match error@2: ${JSON.stringify(o.value)}`).toEqual([]);
  return o.value as Line;
}
/** The tool's value, which must not be an error. */
export function valueOf(o: Outcome, what: string): any {
  expect(o.isError, `${what} must succeed: ${JSON.stringify(o.reply).slice(0, 1500)}`).toBe(false);
  return o.value;
}

/** A `deep mcp` started by hand from this test process: its parent is no agent. */
export class McpProcess implements Mcp {
  private readonly lines: { raw: string; at: number }[] = [];
  private readonly wakers = new Set<() => void>();
  private err = '';
  private constructor(readonly child: ChildProcess) {
    createInterface({ input: child.stdout! }).on('line', (raw) => { this.lines.push({ raw, at: performance.now() }); for (const w of [...this.wakers]) w(); });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('close', () => { for (const w of [...this.wakers]) w(); });
  }
  static start(home: string, cwd: string, env: Record<string, string | undefined> = {}): McpProcess {
    const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home, env), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    return new McpProcess(child);
  }
  get pid(): number { return this.child.pid!; }
  async notify(method: string, params: Line = {}): Promise<void> { this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); }
  request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Exchange> {
    const id = nextId(method);
    return new Promise((resolve, reject) => {
      const from = this.lines.length;
      const finish = () => { clearTimeout(timer); this.wakers.delete(check); };
      const timer = setTimeout(() => { finish(); reject(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
      let t0 = performance.now();
      const check = () => {
        for (let i = from; i < this.lines.length; i++) {
          const json = parse(this.lines[i]!.raw);
          if (json && json.id === id && ('result' in json || 'error' in json)) { finish(); resolve({ reply: json, ms: this.lines[i]!.at - t0, pid: this.pid }); return; }
        }
        if (this.child.exitCode !== null) { finish(); reject(Error(`deep mcp exited ${this.child.exitCode}: ${this.err}`)); }
      };
      this.wakers.add(check);
      t0 = performance.now();
      this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      check();
    });
  }
}

// ---- The agent stand-in (fixtures/agent.mjs) and its sessions, as the hub sees them through their hooks.
export interface Session { id: string; cwd: string; transcript: string }
export class Agent implements Mcp {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private seq = BigInt(Date.now()) * 1_000_000n;
  private constructor(private readonly child: ChildProcess, readonly home: string, readonly cwd: string) {
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
  /** An agent process in `cwd`; `env` goes into its environment and so into its deep mcp's. */
  static start(home: string, cwd: string, env: Record<string, string | undefined> = {}): Agent {
    const child = spawn(NODE, [AGENT], { cwd, env: childEnv(home, env), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Agent(child, home, cwd);
  }
  /** A new Claude Code session in `cwd`, its transcript where Claude Code keeps it under the agent's home. */
  session(cwd = this.cwd, firstMessage = 'start'): Session {
    const id = randomUUID();
    const transcript = join(this.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: id, cwd, message: { role: 'user', content: firstMessage } })}\n`);
    return { id, cwd, transcript };
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
  /** One hook, from a child of this agent (deep-hook's wire); throws BLOCKED unless the hub acknowledged it. */
  async hook(hub: Hub, s: Session, event: string, extra: Line = {}): Promise<Line> {
    const payload: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
    if (event === 'SessionStart') Object.assign(payload, { source: 'startup', model: 'claude-haiku-5-5' });
    if (event === 'UserPromptSubmit') Object.assign(payload, { prompt: 'fix the login page', prompt_id: randomUUID() });
    if (event === 'PreToolUse') Object.assign(payload, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomUUID()}` });
    if (event === 'SessionEnd') Object.assign(payload, { reason: 'other' });
    Object.assign(payload, extra);
    const request = { v: 1, agent: 'claude-code', event, seq: String(this.seq += 1000n), id: ulid(), matched: [], payload };
    const r = await this.send({ op: 'hook', socket: hub.socket, request, cwd: s.cwd });
    if (!(r.lines as string[] ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} for ${s.id}: ${JSON.stringify(r)}`);
    return r;
  }
  /** Its SessionStart, prompt and first tool call, each from a hook process it started, so the hub knows its process. */
  async establish(hub: Hub, s: Session, prompt = 'fix the login page'): Promise<void> {
    await this.hook(hub, s, 'SessionStart');
    await this.hook(hub, s, 'UserPromptSubmit', { prompt });
    await this.hook(hub, s, 'PreToolUse');
  }
  /** The PreToolUse the agent's hook stamps for its next call of the deep tool `tool` with `args`. */
  stamp(hub: Hub, s: Session, tool: string, args: Line): Promise<Line> {
    return this.hook(hub, s, 'PreToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args });
  }
  end(hub: Hub, s: Session): Promise<Line> { return this.hook(hub, s, 'SessionEnd'); }
  /** One JSON-RPC request to this agent's own `deep mcp`, which the agent starts on first use. */
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Exchange> {
    const line = { jsonrpc: '2.0', id: nextId(method), method, params };
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return { reply: r.reply as Line, ms: r.ms as number, pid: r.pid as number };
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', method, params } });
  }
  /** Its deep mcp's PID, and whether that process still runs. */
  async mcpProcess(): Promise<{ pid: number | null; alive: boolean }> {
    const r = await this.send({ op: 'mcp-pid' });
    return { pid: r.pid as number | null, alive: r.alive as boolean };
  }
  /** `ps -o lstart=` of this agent: how the hub tells its process from a reused PID. */
  start(): string { return execFileSync('ps', ['-o', 'lstart=', '-p', String(this.pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(); }
}

export interface World { tmp: string; home: string; wt: { path: string; commit: string }; agent: Agent; session: Session; hub: Hub }
/**
 * A home, a worktree, an agent stand-in working there with its session established through its hooks, the hub, and
 * the agent's deep mcp initialized. `plant` goes to the hub and into the agent's environment, so its deep mcp has it
 * too; `wiki` becomes the index@1 fill; `seeded` runs against the record before the hub starts.
 */
export async function agentWorld(o: {
  plant?: string | undefined; wiki?: Claim[] | undefined; files?: Record<string, string> | undefined; checks?: string[] | undefined; prompt?: string | undefined;
  seeded?: (s: Seeding, session: Session, worktree: string) => Promise<void>;
} = {}): Promise<World> {
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'work'), { files: o.files, checks: o.checks });
  const agent = Agent.start(home, wt.path, o.plant ? { DEEP_HUB_PLANT: o.plant } : {});
  const session = agent.session(wt.path, o.prompt ?? 'start');
  if (o.seeded) await seed(home, (s) => o.seeded!(s, session, wt.path));
  const index = o.wiki ? writeIndexFill(tmp, o.wiki) : undefined;
  const hub = await startHub(home, { plant: o.plant, index });
  await agent.establish(hub, session, o.prompt);
  await initialize(agent);
  return { tmp, home, wt, agent, session, hub };
}

/** claim.made@1's data for a deep_claim, with a task of its own so its claim.made can be found. */
export function claimArgs(extra: Line = {}): Line {
  return { task_ref: `task:${ulid()}`, attempt: 1, commit: randomBytes(20).toString('hex'), scope: 'session', ...extra };
}
/** The claim.made events for a task_ref. */
export const claimsFor = (all: readonly Ev[], taskRef: string): Ev[] => all.filter((e) => e.kind === 'claim.made' && e.data?.task_ref === taskRef);

// ---- Schemas: sample arguments, and the strict subset the model APIs' tool validators take (README: Strict).
const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Arguments filling every field of `schema`: each string `text`, each number 1, each boolean false, each enum its first value. */
export function sampleArgs(schema: Line, text: string): any {
  if (!isObj(schema)) return text;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum.find((v: unknown) => v !== null) ?? null;
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union) && union.length) return sampleArgs(union[0] as Line, text);
  const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = types.find((t) => t !== 'null') ?? 'null';
  switch (type) {
    case 'object': return Object.fromEntries(Object.entries((schema.properties ?? {}) as Line).map(([k, v]) => [k, sampleArgs(v as Line, text)]));
    case 'array': return [sampleArgs((schema.items ?? {}) as Line, text)];
    case 'string': return text;
    case 'integer': case 'number': return 1;
    case 'boolean': return false;
    default: return null;
  }
}
/** Every property name in a schema, at any depth. */
export function propertyNames(schema: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) for (const s of schema) propertyNames(s, into);
  else if (isObj(schema)) {
    if (isObj(schema.properties)) for (const k of Object.keys(schema.properties)) into.add(k);
    for (const v of Object.values(schema)) propertyNames(v, into);
  }
  return into;
}
const ANNOTATIONS = ['description', 'title'];
/** The string formats both strict validators take. */
const FORMATS = new Set(['date-time', 'date', 'time', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid']);
/**
 * What keeps a tool's input schema out of the strict subset (README: Strict), one line each, naming the tool and the
 * JSON Pointer: the root an object; every object with listed properties, every one of them required, and
 * additionalProperties false; an array with one item schema; a string with an optional enum, pattern or listed
 * format; an integer, number or boolean; a constant; null only beside one other type; and no other keyword than
 * these and the annotations description and title.
 */
export function strictProblems(tool: string, schema: unknown, at = '', root = true): string[] {
  const out: string[] = [];
  const say = (why: string) => out.push(`${tool} ${at || '/'}: ${why}`);
  if (!isObj(schema)) { say('not a schema object'); return out; }
  const types: unknown[] = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type];
  const others = types.filter((t) => t !== 'null');
  const allowed = new Set<string>([...ANNOTATIONS, 'type']);
  if (root && !(types.length === 1 && types[0] === 'object')) say('the root must be {"type": "object"}');
  if (others.length !== 1) say(`type ${JSON.stringify(schema.type)}: one type, with null only beside it`);
  const type = others[0];
  const nullable = types.includes('null');
  if (schema.const !== undefined) allowed.add('const');
  switch (type) {
    case 'object': {
      for (const k of ['properties', 'required', 'additionalProperties']) allowed.add(k);
      if (schema.additionalProperties !== false) say('additionalProperties must be false');
      const props = isObj(schema.properties) ? schema.properties : undefined;
      if (!props) { say('an object lists its properties'); break; }
      const required = Array.isArray(schema.required) ? schema.required : [];
      const keys = Object.keys(props);
      const missing = keys.filter((k) => !required.includes(k));
      if (missing.length) say(`every property is required (an optional one is nullable): ${missing.join(', ')} not in required`);
      const unknown = required.filter((k: unknown) => !keys.includes(k as string));
      if (unknown.length) say(`required names properties it doesn't list: ${unknown.join(', ')}`);
      for (const k of keys) out.push(...strictProblems(tool, props[k], `${at}/properties/${k}`, false));
      break;
    }
    case 'array':
      allowed.add('items');
      allowed.add('minItems');
      if (!isObj(schema.items)) say('an array has one item schema');
      else out.push(...strictProblems(tool, schema.items, `${at}/items`, false));
      if (schema.minItems !== undefined && schema.minItems !== 0 && schema.minItems !== 1) say('minItems may only be 0 or 1');
      break;
    case 'string':
      for (const k of ['enum', 'pattern', 'format']) allowed.add(k);
      if (schema.format !== undefined && !FORMATS.has(schema.format)) say(`format ${String(schema.format)} is not one both validators take`);
      if (schema.pattern !== undefined) {
        const p = String(schema.pattern);
        try { new RegExp(p, 'u'); } catch { say(`pattern ${p} doesn't compile`); }
        if (/\(\?[=!<]|\\[bB1-9]/.test(p)) say(`pattern ${p} uses lookaround, a backreference or a word boundary`);
      }
      break;
    case 'integer':
    case 'number':
    case 'boolean':
      allowed.add('enum');
      break;
    default:
      say(`type ${String(type)} is outside the closed list`);
  }
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.length) say('an empty enum');
    if (nullable && !schema.enum.includes(null)) say('a nullable enum lists null');
    if (schema.enum.some((v: unknown) => v !== null && typeof v !== (type === 'integer' ? 'number' : type))) say('an enum value of another type');
  } else if (schema.enum !== undefined) say('enum is not a list');
  for (const key of Object.keys(schema)) if (!allowed.has(key)) say(`keyword ${key} is outside the strict subset`);
  return out;
}

// ---- The design: the Building blocks table, and the MCP tools row's tool names.
const DESIGN = (): string => readFileSync(join(REPO, 'docs/technical-design.md'), 'utf8');
export interface Block { block: string; builtOn: string; mcp: string; api: string; never: string }
const cells = (row: string): string[] => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
/** The Building blocks table of docs/technical-design.md, one row each. */
export function buildingBlocks(md = DESIGN()): Block[] {
  const lines = md.slice(md.indexOf('\n### Building blocks')).split('\n');
  const head = lines.findIndex((l) => l.startsWith('| Block |'));
  if (head < 0) throw Error('BLOCKED: no Building blocks table in docs/technical-design.md');
  const rows: Block[] = [];
  for (let i = head + 2; lines[i]?.startsWith('|'); i++) {
    const [block, builtOn, mcp, api, never] = cells(lines[i]!);
    rows.push({ block: block!, builtOn: builtOn!, mcp: mcp!, api: api!, never: never! });
  }
  return rows;
}
/** The tool names the design's MCP tools row names: the allowlist. */
export function designTools(md = DESIGN()): Set<string> {
  const row = md.split('\n').find((l) => l.startsWith('| MCP tools |'));
  if (!row) throw Error('BLOCKED: no MCP tools row in docs/technical-design.md');
  return new Set([...row.matchAll(/`(deep_[a-z_]*[a-z])`/g)].map((m) => m[1]!));
}
/** Text as the generated skill and descriptions are compared with the table: no backticks or bold, one space, lower case. */
export const normalize = (text: string): string => text.replace(/`|\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
/** The rows whose "Agents, through MCP" cell names `tool`. */
export const rowsNaming = (rows: readonly Block[], tool: string): Block[] => rows.filter((r) => r.mcp.includes(`\`${tool}\``));
/**
 * How the live tool descriptions and the skill drift from the table (README: The skill), one line each, naming the
 * tool or the skill and the row: a tool no row names; a description missing a row's Never cell; a skill missing a
 * row's block or Never cell, missing a live tool, naming a tool that isn't live, or naming a tool's parameter.
 */
export function drift(rows: readonly Block[], tools: readonly Tool[], skill: string): string[] {
  const out: string[] = [];
  const skillText = normalize(skill);
  const live = new Set(tools.map((t) => t.name));
  for (const t of tools) {
    const naming = rowsNaming(rows, t.name);
    if (!naming.length) out.push(`${t.name}: no row of the Building blocks table names it`);
    for (const r of naming) {
      if (!normalize(t.description ?? '').includes(normalize(r.never))) out.push(`${t.name}: its description lacks the ${r.block} row's Never cell: "${r.never}"`);
    }
  }
  for (const r of rows.filter((row) => tools.some((t) => row.mcp.includes(`\`${t.name}\``)))) {
    if (!skillText.includes(normalize(r.block))) out.push(`the skill: lacks the block ${r.block}`);
    if (!skillText.includes(normalize(r.never))) out.push(`the skill: lacks the ${r.block} row's Never cell: "${r.never}"`);
  }
  for (const t of tools) if (!new RegExp(`\\b${t.name}\\b`).test(skill)) out.push(`the skill: doesn't name the live tool ${t.name}`);
  for (const named of new Set([...skill.matchAll(/\bdeep_[a-z_]*[a-z]\b/g)].map((m) => m[0]))) {
    if (!live.has(named)) out.push(`the skill: names ${named}, which the live tool list lacks`);
  }
  for (const t of tools) {
    for (const p of propertyNames(t.inputSchema)) {
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const asCode = new RegExp('`' + esc + '`|\\b' + esc + '\\s*[:=]|"' + esc + '"');
      const bare = /[_A-Z0-9]/.test(p) && new RegExp(`\\b${esc}\\b`).test(skill);
      if (asCode.test(skill) || bare) out.push(`the skill: names ${t.name}'s parameter ${p}`);
    }
  }
  return out;
}
/** The skill, as the checkout holds it (README: The skill). */
export const SKILL = join(REPO, 'skills/deepbuild/SKILL.md');

// ---- Files under a root: whether one exists, and every file holding any of `needles`, raw.
export const existsIn = (root: string, relative: string): boolean => existsSync(join(root, relative));
export function filesHolding(dir: string, needles: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (d: string) => {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      const path = join(d, name);
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) {
        const bytes = readFileSync(path);
        for (const n of needles) if (bytes.includes(Buffer.from(n))) found.push(`${path} (${n.slice(0, 24)}…)`);
      }
    }
  };
  walk(dir);
  return found;
}
/** A value's forms the design scrubs: raw, base64 (standard and URL-safe) at each of the three offsets, and URL-encoded. */
export function forms(value: string): string[] {
  const out = new Set<string>([value, encodeURIComponent(value)]);
  for (const prefix of ['', 'x', 'xy']) {
    const std = Buffer.from(prefix + value).toString('base64');
    // Leave out the characters that depend on the prefix and the padding at the end.
    const inner = std.slice(prefix ? Math.ceil((prefix.length * 4) / 3) + 1 : 0, -4);
    if (inner.length >= 16) { out.add(inner); out.add(inner.replace(/\+/g, '-').replace(/\//g, '_')); }
  }
  return [...out];
}

// ---- The index@1 fill standing in for the wiki (DEEP_HUB_TEST_INDEX).
export interface Claim { id: string; page: string; source: string; text: string }
/** Writes a module whose default export returns an index@1 fill holding `claims`, which survive the hub's rebuilds. */
export function writeIndexFill(dir: string, claims: Claim[]): string {
  const file = join(dir, 'index-fill.mjs');
  writeFileSync(file, `// The test's index@1 fill standing in for the wiki (DEEP_HUB_TEST_INDEX): a keyword index whose
// claims below are fixed, beside whatever the hub rebuilds or upserts.
const FIXED = ${JSON.stringify(claims)};
const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const matches = (c, q) => { const have = new Set(words(c.text)); return words(q).every((w) => have.has(w)); };
export default function () {
  let live = [];
  return {
    slot: 'index@1', revision: 1,
    rebuild(claims) { live = [...claims]; },
    upsert(claims) { const ids = new Set(claims.map((c) => c.id)); live = [...live.filter((c) => !ids.has(c.id)), ...claims]; },
    search(query) { return [...FIXED, ...live].filter((c) => matches(c, query)).map((c) => ({ claim: c.id, page: c.page, quote: c.text, source: c.source })); },
    dropSource(source) { live = live.filter((c) => c.source !== source); },
  };
}
`);
  return file;
}

// ---- Budgets: the design's rule for timing results, as tests/acceptance/24 judges them.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here is only a reading, or null on a reference Mac on mains power, Low Power Mode off, thermal state nominal. */
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
export const p95 = (samples: number[]): number => { const s = [...samples].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!; };
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
