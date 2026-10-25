// Test-side tools for the #24 acceptance tests: a real hub (`deep hub run`) in a temporary home, its record
// seeded beforehand through the real record and asks core, the real `deep` CLI as a child process, the hub's
// socket with the control token, an agent stand-in (fixtures/agent.mjs) whose process tree the hub can see,
// and your shell in a real tmux server. The one thing stubbed is the OS confirmation (README: the seam).
// Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection } from '../../../packages/record/src/index.ts';
import { askSources, openAsks } from '../../../packages/asks/src/index.ts';
import type { AskKind, Asks } from '../../../packages/asks/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const NODE = process.execPath;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const parse = (raw: string): Line | undefined => { try { return JSON.parse(raw) as Line; } catch { return undefined; } };

// ---- ULIDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted + Math.floor(Math.random() * 2 ** 40), i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}

// ---- Temp folders (short: a socket path must fit in 104 bytes on macOS) and processes this suite started.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh24-'));
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
export interface Ran { code: number | null; stdout: string; stderr: string; ms: number }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: REPO, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
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

// ---- The record, seeded before the hub starts, through the real record and asks core (as the hub's core would).
export const rootOf = (home: string): string => join(home, '.deepbuild');
const who = { actor: 'you', scope: 'you' };
export const PROJECT = 'shop';
/** DeepBuild's own code raising an ask for a session of the repo `shop`. */
const core = (session: string): Connection => ({ writer: 'core', ...who, session, project: PROJECT });
/** The question card in the app. */
const card: Connection = { writer: 'app', ...who };

const OPTIONS: Record<string, Line[]> = {
  authority: [{ id: 'approve', label: 'Push it', decision: 'allow' }, { id: 'decline', label: 'Hold the push', decision: 'deny' }],
  taste: [{ id: 'blue', label: 'Blue header', decision: 'none' }, { id: 'green', label: 'Green header', decision: 'none' }],
  choice: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }],
  exception: [{ id: 'keep', label: 'Keep the check', decision: 'none' }, { id: 'waive', label: 'Waive it once', decision: 'none' }],
  definition: [{ id: 'keep', label: 'Keep the requirement', decision: 'none' }, { id: 'drop', label: 'Leave it out', decision: 'none' }],
};
const DEFAULT: Record<string, string> = { authority: 'decline', taste: 'blue', choice: 'sqlite', exception: 'keep', definition: 'drop' };
/** An ask as ask.created@1 data, open until `deadline`. */
export function askData(kind: AskKind, subject: string, raised: number, deadline = raised + DAY): Line {
  return {
    kind, question: kind === 'authority' ? `Push ${subject} to origin?` : `Which way for ${subject}?`,
    options: structuredClone(OPTIONS[kind]), recommended: kind === 'authority' ? null : DEFAULT[kind], deadline,
    fallback: 'you', default: DEFAULT[kind], provisional: false, owner: 'you', key: sha256(`${kind}:${subject}`),
    pinned_to: { kind: 'evidence', ref: sha256(subject) },
  };
}
export const sourceOf = (kind: AskKind): string => askSources().find((row) => row.kind === kind)!.source;

export interface Seeding {
  asks: Asks;
  /** Moves the seeding clock. */
  at(ms: number): void;
  /** session.start for a session of the repo `shop`, as its hook would append it. */
  start(session: string): Promise<void>;
  /** An ask raised for the session by DeepBuild's core, now; its handle. */
  raise(session: string, kind: AskKind, subject: string, deadline?: number): Promise<string>;
  /** Answered on the question card in the app, now. */
  answerOnCard(handle: string, option: string): Promise<void>;
}
/** Seeds <home>/.deepbuild/ledger.db with the hub stopped, then closes it. */
export async function seed(home: string, fill: (s: Seeding) => Promise<void>, start = Date.now()): Promise<void> {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  let now = start;
  const record = await openRecord({ path: join(rootOf(home), 'ledger.db'), now: () => now });
  const asks = await openAsks({ record, now: () => now, deliver: () => undefined });
  try {
    await fill({
      asks,
      at: (ms) => { now = ms; },
      start: async (session) => {
        await record.append({ writer: 'hook', ...who, session, project: PROJECT, agent: 'claude-code' }, { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: '/work/shop', branch: 'main', thread: session } });
      },
      raise: (session, kind, subject, deadline) => asks.raise(core(session), sourceOf(kind), askData(kind, subject, now, deadline)),
      answerOnCard: (handle, option) => asks.answer(card, handle, { option }),
    });
  } finally {
    await record.close();
  }
}

// ---- The hub: `deep hub run` with HOME at the test's home, so its root is <home>/.deepbuild.
export interface Hub { pid: number; home: string; socket: string; confirm: string; child: ChildProcess; stderr(): string }
/**
 * Starts the installed hub of `home`. Its OS confirmation is the stub: DEEP_HUB_TEST_CONFIRM names a file
 * holding `confirmed` or `cancelled`, read each time the hub would ask the OS to confirm you.
 */
export async function startHub(home: string, o: { confirm: 'confirmed' | 'cancelled'; plant?: string }): Promise<Hub> {
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, `${o.confirm}\n`);
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_PLANT: o.plant }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let err = '';
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 30_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${err.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), confirm, child, stderr: () => err };
}
/** What the stubbed OS confirmation answers from now on. */
export const confirmWith = (hub: Hub, answer: 'confirmed' | 'cancelled'): void => writeFileSync(hub.confirm, `${answer}\n`);
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 10_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
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
    const id = `t24#${++this.ids}`;
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
export interface Ev { id: string; kind: string; subject?: string; writer: string; data: Line; log_pos: number }
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
/** The events that close an ask. */
const CLOSING = new Set(['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot']);
/** What the record holds about an answer to the ask: its closing events and any decision saved from it or applied to it. */
export function counted(all: readonly Ev[], handle: string): Ev[] {
  return all.filter((e) => (CLOSING.has(e.kind) && e.subject === handle)
    || ((e.kind === 'decision.created' || e.kind === 'decision.applied') && e.data?.ask === handle));
}
/** The ask is still open: nothing closed it, and no decision was saved from it or applied to it. */
export async function expectOpen(hub: Hub, handle: string, how: string): Promise<void> {
  await sleep(300);   // anything the hub appends for the answer lands before this read
  const found = counted(await events(hub), handle);
  expect(found.map((e) => `${e.kind} ${e.id}`), `ask ${handle} (${how}) counted with the OS confirmation cancelled or refused: the ask must stay open and no decision be saved`).toEqual([]);
}
/** The answer counted once: one ask.answered from deep inbox answer, and one decision saved from it. */
export async function expectCountedOnce(hub: Hub, handle: string, option: string, how: string): Promise<{ answered: Ev; decision: Ev }> {
  const found = counted(await events(hub), handle);
  const answered = found.filter((e) => e.kind === 'ask.answered');
  const decisions = found.filter((e) => e.kind === 'decision.created');
  expect(answered.map((e) => [e.data.answer, e.data.via, e.data.verified]), `ask ${handle} (${how}), once the OS confirmed you, is answered exactly once, with ${option}, from deep inbox answer`).toEqual([[option, 'inbox', true]]);
  expect(decisions.length, `ask ${handle} (${how}), once the OS confirmed you, saves exactly one decision`).toBe(1);
  return { answered: answered[0]!, decision: decisions[0]! };
}

// ---- The agent stand-in (fixtures/agent.mjs) and its session, as the hub sees it through its hooks.
export class Agent {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess, readonly home: string, readonly cwd: string, readonly session: string, readonly transcript: string) {
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
  /** An agent process with a working folder and its transcript where Claude Code keeps it under <home>. */
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
  private send(command: Line, timeoutMs = 60_000): Promise<Line> {
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
    let seq = BigInt(Date.now()) * 1_000_000n;
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse']) {
      const payload: Line = { session_id: this.session, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default' };
      if (event === 'SessionStart') Object.assign(payload, { source: 'startup', model: 'claude-haiku-5-5' });
      if (event === 'UserPromptSubmit') Object.assign(payload, { prompt: 'fix the login page', prompt_id: randomUUID() });
      if (event === 'PreToolUse') Object.assign(payload, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `call_${randomUUID()}` });
      const request = { v: 1, agent: 'claude-code', event, seq: String(seq += 1000n), id: ulid(Date.now()), matched: [], payload };
      const r = await this.send({ op: 'hook', socket: hub.socket, request });
      if (!(r.lines as string[]).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} from the agent: ${JSON.stringify(r)}`);
    }
  }
  /** A command the agent runs through its shell, as its Bash tool does: the agent is above it. */
  async run(argv: readonly string[]): Promise<Ran> {
    const r = await this.send({ op: 'run', argv, cwd: this.cwd });
    return { code: r.code as number, stdout: r.stdout as string, stderr: r.stderr as string, ms: 0 };
  }
  /** `deep <args>`, run by the agent. */
  deep(args: readonly string[]): Promise<Ran> { return this.run([NODE, CLI, ...args]); }
  /** One JSON-RPC line to the agent's own `deep mcp`, started by the agent on first use. */
  async mcp(method: string, params: Line = {}): Promise<Line> {
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', id: `${method}#${++this.n}`, method, params } });
    return r.reply as Line;
  }
  /** `ps -o lstart=` of this agent: how the hub tells its process from a reused PID. */
  start(): string { return execFileSync('ps', ['-o', 'lstart=', '-p', String(this.pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(); }
}

// ---- Your shell, outside every agent's process tree, and an agent typing into it.
export const HAS_TMUX = (() => { try { execFileSync('/bin/sh', ['-c', 'command -v tmux'], { stdio: 'ignore' }); return true; } catch { return false; } })();
/**
 * `deep <args>` typed by the agent into your shell: with tmux, `tmux send-keys` into a pane of a tmux server you
 * started (it detaches, so the shell's parents are the tmux server and launchd, no agent); without tmux, a
 * double fork from the agent's shell, so the command's parent exits and it is left with no agent above it.
 */
export async function typedIntoYourShell(agent: Agent, args: readonly string[]): Promise<Ran & { via: string }> {
  const dir = mkdtempSync(join(dirname(agent.home), 'typed-'));
  const command = [NODE, CLI, ...args].map((a) => `'${a}'`).join(' ');
  const line = `${command} >${dir}/out 2>${dir}/err; echo $? >${dir}/code.tmp; mv ${dir}/code.tmp ${dir}/code`;
  let via: string;
  if (HAS_TMUX) {
    const socket = join(dirname(agent.home), 'tmux.sock');
    if (!existsSync(socket)) {
      const env = childEnv(agent.home, { TERM: 'xterm-256color', SHELL: '/bin/sh' });
      execFileSync('tmux', ['-S', socket, '-f', '/dev/null', 'new-session', '-d', '-s', 'you', '-x', '200', '-y', '50', '/bin/sh'], { env });
      own(Number(execFileSync('tmux', ['-S', socket, 'display-message', '-p', '-t', 'you', '#{pid}'], { env, encoding: 'utf8' }).trim()));
    }
    const typed = await agent.run(['/bin/sh', '-c', `tmux -S ${socket} send-keys -t you -l "$0" && tmux -S ${socket} send-keys -t you Enter`, line]);
    if (typed.code !== 0) throw Error(`BLOCKED: tmux send-keys failed: ${typed.stderr}`);
    via = 'tmux send-keys';
  } else {
    const forked = await agent.run(['/bin/sh', '-c', '( sleep 1; /bin/sh -c "$0" ) >/dev/null 2>&1 &', line]);
    if (forked.code !== 0) throw Error(`BLOCKED: the double fork failed: ${forked.stderr}`);
    via = 'a double fork (no tmux here)';
  }
  const deadline = Date.now() + 60_000;
  while (!existsSync(join(dir, 'code'))) {
    if (Date.now() > deadline) throw Error(`BLOCKED: the command typed into your shell through ${via} didn't finish in 60 s`);
    await sleep(50);
  }
  const read = (name: string) => readFileSync(join(dir, name), 'utf8');
  return { code: Number(read('code').trim()), stdout: read('out'), stderr: read('err'), ms: 0, via };
}

// ---- `deep inbox` output: one line per open ask, its first four fields the handle, kind, session and age.
export interface Listed { ask: string; kind: string; session: string; age: string }
export function listed(stdout: string): Listed[] {
  return stdout.split('\n').map((l) => l.trim()).filter((l) => /^ask:[0-9A-Za-z]+\s/.test(l)).map((l) => {
    const [ask, kind, session, age] = l.split(/\s+/);
    return { ask: ask!, kind: kind!, session: session!, age: age! };
  });
}

// ---- Budgets: the design's rule for timing results, as tests/acceptance/319 judges them.
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
