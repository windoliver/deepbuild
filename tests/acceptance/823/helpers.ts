// Test-side tools for #823's acceptance tests (README): a real hub (`deep hub run`) in a temporary home, its record
// seeded beforehand through the real record and asks core, an agent stand-in (fixtures/agent.mjs) whose hooks and
// `deep mcp` are its children, your answer on the hub's socket as `deep inbox answer` sends it, the record read with
// `events.read`, and the read log the hub writes under DEEP_HUB_TEST_READS (README: The surface under test). Most of
// it is adapted from tests/acceptance/26/helpers.ts (same repo, same license); this suite keeps its own copy so a
// redraft of #26's never moves these tests. No hub, CLI or `deep mcp` module is imported. Processes are stopped by
// PID only, never by name or port.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRecord, type Connection, type RecordStore } from '../../../packages/record/src/index.ts';
import { askSources, openAsks, type AskKind, type Asks } from '../../../packages/asks/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const NODE = process.execPath;
export const SECOND = 1000;
export const DAY = 86_400_000;
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const parse = (raw: string): Line | undefined => { try { return JSON.parse(raw) as Line; } catch { return undefined; } };

// The criteria (README: Criteria to tests): `#823.<first 8 hex of SHA-256 of the criterion's text, trimmed,
// whitespace collapsed>`, as scripts/proof-change.mjs computes it.
export const AC1 = '#823.da880762';
export const AC2 = '#823.f1b9ae1e';
export const AC3 = '#823.d60a913c';

// The issue's numbers.
/** An answer or a run's result reaches the agent within this of the event that settles it. */
export const WITHIN_MS = 20;
/** deep_wait's answers measured. */
export const ANSWERS = 100;
/** How long deep_wait waits with nothing happening while its reads are counted. */
export const IDLE_MS = 30_000;
/** The most reads of the ask it waits on in that time. */
export const MOST_READS = 2;
/** The planted waiter's period. */
export const PLANT_PERIOD_MS = 100;
/** The planted waiter (README: The surface under test). */
export const POLLING_PLANT = 'deep-wait-polls';

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
  const dir = realpathSync(mkdtempSync('/tmp/dh823-'));
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
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('TMUX') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('GIT_') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

// ---- A home and a worktree: a git repo with the repo's spec, .deepbuild/done.yaml.
export const rootOf = (home: string): string => join(home, '.deepbuild');
/**
 * The repo's spec: `pause` sleeps for the seconds the worktree's `pause` file holds (the tests set it before each run,
 * so a run ends at no fixed phase), `long` sleeps a minute; and the values the ask rules leave open.
 */
function doneYaml(): string {
  return [
    'claims:',
    '  done:',
    '    checks: [pause]',
    'checks:',
    '  pause: { type: command, run: "sleep $(cat pause)" }',
    '  long: { type: command, run: "sleep 60" }',
    'asks:',
    '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
    '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
    '  fallback: [change-owner]',
    '',
  ].join('\n');
}
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
/** A worktree at `dir`: a fresh git repo of its own (never this checkout) whose one commit holds the spec. */
function makeWorktree(dir: string): { path: string; commit: string } {
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), doneYaml());
  writeFileSync(join(dir, 'pause'), '0.25\n');
  const env = { ...process.env, ...GIT_ENV, HOME: dir };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return { path: realpathSync(dir), commit: git('rev-parse', 'HEAD') };
}

// ---- The record, seeded before the hub starts, through the real record and asks core (as the hub's core would).
const who = { actor: 'you', scope: 'you' };
const PROJECT = 'shop';
const core = (session: string): Connection => ({ writer: 'core', ...who, session, project: PROJECT });
/** A taste ask as ask.created@1 data, open for a day; its key is its own question's, so no saved answer decides another. */
function askData(question: string, raised: number): Line {
  return {
    kind: 'taste', question, options: [{ id: 'blue', label: 'Blue header', decision: 'none' }, { id: 'green', label: 'Green header', decision: 'none' }],
    recommended: 'blue', deadline: raised + DAY, fallback: 'you', default: 'blue', provisional: false, owner: 'you', key: sha256(`taste:${question}`),
    pinned_to: { kind: 'evidence', ref: sha256(question) },
  };
}
const sourceOf = (kind: AskKind): string => askSources().find((row) => row.kind === kind && !/^(asks|request)\./.test(row.source))!.source;
/**
 * Seeds <home>/.deepbuild/ledger.db with the hub stopped: the session's start in `worktree`, as its hook would append
 * it, and `asks` open taste asks raised for it by DeepBuild's core; resolves with their handles, in order.
 */
async function seed(home: string, session: string, worktree: string, asks: number): Promise<string[]> {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  const now = Date.now();
  const record: RecordStore = await openRecord({ path: join(rootOf(home), 'ledger.db'), now: () => now });
  const asksCore: Asks = await openAsks({ record, now: () => now, deliver: () => undefined });
  const handles: string[] = [];
  try {
    await record.append({ writer: 'hook', ...who, session, project: PROJECT, agent: 'claude-code' }, { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree, branch: 'main', thread: session } });
    for (let i = 0; i < asks; i++) handles.push(await asksCore.raise(core(session), sourceOf('taste'), askData(`Which header colour for page ${i} of ${session}?`, now)));
  } finally {
    await record.close();
  }
  return handles;
}

// ---- The hub: `deep hub run` with HOME at the test's home, so its root is <home>/.deepbuild.
export interface Hub { pid: number; home: string; socket: string; child: ChildProcess; output(): string; exited: Promise<void> }
export interface HubOptions {
  /** DEEP_HUB_PLANT: a planted wrong program (README: The surface under test). */
  plant?: string | undefined;
  /** DEEP_HUB_TEST_READS: the file the hub logs its record reads to (README: The surface under test). */
  reads?: string | undefined;
}
/** Starts the hub of `home`, with #24's OS confirmation stub always `confirmed`; undefined (with why) if it didn't start. */
export async function startHub(home: string, o: HubOptions = {}): Promise<{ hub?: Hub; why?: string }> {
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const env = childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_READS: o.reads });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
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
  if (!ready) return { why: `the hub didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${out.slice(0, 2000)}` };
  return { hub: { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), child, output: () => out, exited } };
}
/** SIGTERM to the hub, by its PID, as `deep hub stop`'s signal; resolves when it has exited, SIGKILL after 30 s. */
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
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
    const id = `t823#${++this.ids}`;
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
export interface Ev { id: string; kind: string; subject?: string; session?: string; ts: number; data: Line; log_pos: number }
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
/** Your answer to `ask` with `option`, as `deep inbox answer` sends it on the socket (`ask.answer`, #24). */
export async function answer(conn: Conn, ask: string, option: string): Promise<void> {
  const reply = await conn.call('ask.answer', { ask, option });
  if ('error' in reply) throw Error(`BLOCKED: ask.answer ${ask} ${option} refused: ${JSON.stringify(reply.error)}`);
}

// ---- MCP through the agent stand-in's own `deep mcp`: newline-delimited JSON-RPC 2.0, as a real MCP client speaks it.
/** A tool call's outcome: `isError`, its value (structuredContent, else the first text block's JSON), and when it was sent and its reply arrived at the agent (epoch ms). */
export interface Outcome { isError: boolean; value: any; reply: Line; sent: number; arrived: number }
let rpc = 0;
export interface Session { id: string; cwd: string; transcript: string }
export class Agent {
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
  static start(home: string, cwd: string): Agent {
    const child = spawn(NODE, [AGENT], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Agent(child, home, cwd);
  }
  /** A new Claude Code session in `cwd`, its transcript where Claude Code keeps it under the agent's home. */
  session(cwd = this.cwd): Session {
    const id = randomUUID();
    const transcript = join(this.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: id, cwd, message: { role: 'user', content: 'start' } })}\n`);
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
    Object.assign(payload, extra);
    const request = { v: 1, agent: 'claude-code', event, seq: String(this.seq += 1000n), id: ulid(), matched: [], payload };
    const r = await this.send({ op: 'hook', socket: hub.socket, request, cwd: s.cwd });
    if (!(r.lines as string[] ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} for ${s.id}: ${JSON.stringify(r)}`);
    return r;
  }
  /** Its SessionStart, prompt and first tool call, each from a hook process it started, so the hub knows its process. */
  async establish(hub: Hub, s: Session): Promise<void> {
    await this.hook(hub, s, 'SessionStart');
    await this.hook(hub, s, 'UserPromptSubmit');
    await this.hook(hub, s, 'PreToolUse');
  }
  /** One JSON-RPC request to this agent's own `deep mcp`, which the agent starts on first use. */
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<{ reply: Line; sent: number; arrived: number }> {
    const line = { jsonrpc: '2.0', id: `${method}#${++rpc}`, method, params };
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return { reply: r.reply as Line, sent: r.sent as number, arrived: r.arrived as number };
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', method, params } });
  }
  async call(tool: string, args: Line, timeoutMs?: number): Promise<Outcome> {
    const { reply, sent, arrived } = await this.request('tools/call', { name: tool, arguments: args }, timeoutMs);
    const result = (reply.result ?? {}) as Line;
    const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
    const value = reply.error ?? result.structuredContent ?? (typeof text === 'string' ? parse(text) ?? text : undefined);
    return { isError: reply.error !== undefined || result.isError === true, value, reply, sent, arrived };
  }
}

export interface World { tmp: string; home: string; wt: { path: string; commit: string }; agent: Agent; session: Session; hub: Hub; asks: string[]; reads?: string }
/**
 * A home, a worktree, an agent stand-in working there with `asks` open asks seeded for its session before the hub
 * starts, the hub (with `plant`, and, with `reads`, its read log at <tmp>/reads.jsonl), the session established
 * through its hooks, and the agent's deep mcp initialized. A hub that doesn't start throws BLOCKED, naming why.
 */
export async function agentWorld(o: { asks?: number; plant?: string; reads?: boolean } = {}): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  const wt = makeWorktree(join(tmp, 'work'));
  const agent = Agent.start(home, wt.path);
  const session = agent.session(wt.path);
  const asks = await seed(home, session.id, wt.path, o.asks ?? 0);
  const reads = o.reads ? join(tmp, 'reads.jsonl') : undefined;
  const started = await startHub(home, { plant: o.plant, reads });
  if (!started.hub) throw Error(`BLOCKED: ${started.why}`);
  const hub = started.hub;
  await agent.establish(hub, session);
  const { reply } = await agent.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-823', version: '0' } });
  if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
  await agent.notify('notifications/initialized');
  // deep mcp connects to the hub at its first call and gives up after 1 s; on a loaded machine that first connect can
  // miss, so one deep_status is called, up to ten times a second apart, as an `unavailable` refusal's remediation says.
  for (let i = 1; ; i++) {
    const status = await agent.call('deep_status', {});
    if (!status.isError) break;
    if (i === 10 || status.value?.code !== 'unavailable') throw Error(`BLOCKED: deep_status through the agent's deep mcp failed ${i} times: ${JSON.stringify(status.reply).slice(0, 1500)}; the hub ${alive(hub.pid) ? 'runs' : 'exited'}: ${hub.output().slice(-2000)}`);
    await sleep(1000);
  }
  return { tmp, home, wt, agent, session, hub, asks, ...(reads ? { reads } : {}) };
}

// ---- The read log (README: The surface under test).
export interface Read { at: number; via: string; query: string }
/** The hub's read log, or undefined when the hub never made the file. */
export function readLog(file: string): Read[] | undefined {
  if (!existsSync(file)) return undefined;
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((raw) => parse(raw) as Read);
}
/** The reads of an ask or run, by its handle (`ask:<id>`, `run:<id>`): those whose query names its ID. */
export const readsOf = (log: readonly Read[], handle: string): Read[] => log.filter((r) => typeof r.query === 'string' && r.query.includes(handle.replace(/^[a-z]+:/, '')));

// ---- Timing.
/** p95, nearest rank. */
export const p95 = (samples: readonly number[]): number => { const s = [...samples].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!; };
/** The 1-minute load average and the cores, as #25's suite reads the machine. */
export interface Machine { one: number; cores: number; text: string }
export const machine = (): Machine => {
  const one = loadavg()[0]!;
  const cores = availableParallelism();
  return { one, cores, text: `1-minute load ${one.toFixed(2)} on ${cores} cores` };
};
/**
 * The machine was loaded past its cores at the start of a timing (`before`) or now, its end: a timing over its limit
 * then can't be told from contention, so it reads INCONCLUSIVE with the load, never PASS (as #25's suite rules).
 */
export const loaded = (before: Machine): boolean => Math.max(before.one, machine().one) > before.cores;
