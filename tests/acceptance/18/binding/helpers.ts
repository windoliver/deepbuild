// Test-side tools for the redraft of #18's AC9 (session binding): a temp home, git worktrees with their spec, the
// wiki seeded through the real record and @deepbuild/wiki before the hub starts, the hub as a process
// (`deep hub run`), its socket's `events.read`, the agent stand-in (fixtures/agent.mjs) whose hooks are the real
// deep-hook binary and whose `deep mcp` is its child, and a `deep mcp` started by hand from this test process.
// Parts are adapted from tests/acceptance/26/helpers.ts, 315/helpers.ts and 355/helpers.ts (same repo, same
// license); this suite keeps its own copy so a redraft of those suites never moves it.
//
// Safety: every folder is under /tmp/dh18b-* (a socket path must fit in 104 bytes on macOS); HOME is a temp folder
// for this process and for every child, so nothing reads or writes the real ~/.deepbuild or ~/.claude; cargo alone
// gets your real HOME, to find its toolchain; processes are stopped by PID only, never by name or port.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { openEvidenceStore } from '../../../../packages/evidence/src/index.ts';
import { openRecord, type Connection } from '../../../../packages/record/src/index.ts';
import { openWiki } from '../../../../packages/wiki/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const NODE = process.execPath;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parse = (raw: string): Line | undefined => { try { return JSON.parse(raw) as Line; } catch { return undefined; } };
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
/** A short random word of lower-case letters and digits, starting with a letter. */
export const word = (): string => `q${randomBytes(6).toString('hex')}`;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms = Date.now()): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted + Math.floor(Math.random() * 2 ** 40), i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}

// ---- This process's environment: no agent or hub settings of the caller's, and a temp HOME.
for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
/** Your real home, used only for cargo's toolchain when it builds deep-hook. */
const TOOLCHAIN_HOME = process.env.HOME;

// ---- Temp folders and the processes this suite started.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh18b-'));
  made.push(dir);
  return dir;
}
process.env.HOME = tempDir();
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

/** This environment with HOME moved to the test's home and no DEEP_, CLAUDE or CODEX settings, plus `extra`. */
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

// ---- deep-hook: the real binary, built by cargo (a no-op when target/debug is current), as 315's suite builds it.
let built: Promise<string> | undefined;
export function deepHook(): Promise<string> {
  built ??= new Promise((resolve, reject) => {
    const args = ['build', '--locked', '-q', '-p', 'deep-hook'];
    const binary = join(REPO, 'target/debug/deep-hook');
    const child = spawn('cargo', args, { cwd: REPO, env: { ...process.env, HOME: TOOLCHAIN_HOME }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    child.on('error', (error) => reject(Error(`BLOCKED: cargo ${args.join(' ')} could not start: ${String(error)}`)));
    child.on('close', (code) => {
      if (code !== 0) reject(Error(`BLOCKED: cargo ${args.join(' ')} failed: ${err.slice(-3000)}`));
      else if (!existsSync(binary)) reject(Error(`BLOCKED: no binary at ${binary} after cargo ${args.join(' ')}`));
      else resolve(binary);
    });
  });
  return built;
}

// ---- A home and worktrees: git repos of their own (never this checkout), each with the repo's spec.
export const rootOf = (home: string): string => join(home, '.deepbuild');
export function makeHome(): { tmp: string; home: string } {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  return { tmp, home };
}
/** The spec: one command check, and the values the ask rules leave open (as tests/acceptance/26 declares them). */
const DONE_YAML = [
  'claims:',
  '  done:',
  '    checks: [unit]',
  'checks:',
  '  unit: { type: command, run: "false" }',
  'asks:',
  '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
  '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
  '  fallback: [change-owner]',
  '',
].join('\n');
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
export function makeWorktree(dir: string): string {
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), DONE_YAML);
  writeFileSync(join(dir, 'README.md'), 'fixture\n');
  const env = { ...process.env, ...GIT_ENV, HOME: dir };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return realpathSync(dir);
}

// ---- The wiki, seeded as it lives at the base: a claim the wiki learns into the record's learned layer (its
// wiki_claims and wiki_text projections, which deep_search reads) and writes as a page under <root>/wiki.
export interface WikiClaim { page: string; id: string; text: string }
const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
/**
 * Learns `claim` at scope `all` from a decision of yours that says it (decision.created, appended by the core), so it
 * belongs to no session. Runs against the hub's own ledger and evidence store before the hub starts.
 */
export async function seedWiki(home: string, claim: WikiClaim): Promise<void> {
  const root = rootOf(home);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let t = Date.now() - 10 * 60_000;
  const now = () => (t += 1000);
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now });
  const record = await openRecord({ path: join(root, 'ledger.db'), now, evidence: store });
  try {
    const at = now();
    const id = ulid(at);
    await record.append(CORE, { v: 1, id, kind: 'decision.created', ts: at, data: { key: sha256(`decision ${id}`), scope: 'all', answer: claim.text, ask: `ask:${ulid(at)}` } });
    const wiki = await openWiki({ record, folder: join(root, 'wiki'), now });
    const learned = await wiki.learn([{ ...claim, scope: 'all', sources: [{ at: `decision:${id}`, quote: claim.text }] }]);
    const handle = `wiki:${claim.page}#${claim.id}`;
    if (!learned.written.includes(handle)) throw Error(`BLOCKED: the wiki didn't learn ${handle}: ${JSON.stringify(learned.dropped)}`);
    const page = join(root, 'wiki', `${claim.page}.md`);
    if (!existsSync(page) || !readFileSync(page, 'utf8').includes(claim.text)) throw Error(`BLOCKED: the wiki wrote no page ${page} holding "${claim.text}"`);
  } finally {
    await record.close();
  }
}

// ---- The hub: `deep hub run` on the home, with DEEP_HUB_PLANT when a test plants a wrong program.
export interface Hub { pid: number; home: string; socket: string; child: ChildProcess }
export async function startHub(home: string, plant?: string): Promise<Hub> {
  const env = childEnv(home, { DEEP_HUB_PLANT: plant });
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
  if (!ready) throw Error(`BLOCKED: the hub didn't start${plant ? ` with DEEP_HUB_PLANT=${plant}` : ''}: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), child };
}

/** Every event in the hub's log, through `events.read` on a connection holding the control token, as `deep` holds it. */
export interface Ev { id: string; kind: string; subject?: string; writer: string; session?: string; verified?: boolean; data: Line; log_pos: number }
export async function events(hub: Hub): Promise<Ev[]> {
  const token = readFileSync(join(rootOf(hub.home), 'control.token'), 'utf8').trim();
  const sock = net.connect(hub.socket);
  const lines: Line[] = [];
  const wakers = new Set<() => void>();
  let buffer = '';
  let closed = false;
  sock.setEncoding('utf8').on('data', (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      lines.push(parse(buffer.slice(0, i)) ?? {});
      buffer = buffer.slice(i + 1);
    }
    for (const w of [...wakers]) w();
  });
  const end = () => { closed = true; for (const w of [...wakers]) w(); };
  sock.on('error', end);
  sock.on('close', end);
  const next = (pred: (l: Line) => boolean, what: string): Promise<Line> => new Promise((resolve, reject) => {
    const check = () => {
      const found = lines.find(pred);
      if (found) { clearTimeout(timer); wakers.delete(check); resolve(found); } else if (closed) { clearTimeout(timer); wakers.delete(check); reject(Error(`BLOCKED: the hub closed the connection before ${what}`)); }
    };
    const timer = setTimeout(() => { wakers.delete(check); reject(Error(`BLOCKED: no ${what} from the hub within 30 s`)); }, 30_000);
    wakers.add(check);
    check();
  });
  try {
    await next((l) => 'hello' in l, 'its hello');
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    const role = await next((l) => 'role' in l || 'error' in l, 'an answer to the cli hello');
    if (role.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(role)}`);
    const all: Ev[] = [];
    for (let after = 0, n = 0; ; n++) {
      const id = `ac9#${n}`;
      sock.write(`${JSON.stringify({ v: 1, id, method: 'events.read', params: { after, limit: 1000 } })}\n`);
      const reply = await next((l) => l.id === id, `a reply to events.read ${id}`);
      if ('error' in reply) throw Error(`BLOCKED: events.read refused: ${JSON.stringify(reply.error)}`);
      const raw = reply.result.events as unknown;
      const page = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Ev[];
      if (!page.length) return all;
      all.push(...page);
      after = page[page.length - 1]!.log_pos;
    }
  } finally {
    sock.destroy();
  }
}
/** The events matching `pred`, polling the log until at least one is there or `timeoutMs` passes. */
export async function eventsMatching(hub: Hub, pred: (e: Ev) => boolean, timeoutMs = 15_000): Promise<Ev[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await events(hub)).filter(pred);
    if (found.length || Date.now() > deadline) return found;
    await sleep(100);
  }
}

// ---- MCP: newline-delimited JSON-RPC 2.0 over a `deep mcp` process's stdio, as a real MCP client speaks it.
export interface Mcp { request(method: string, params?: Line, timeoutMs?: number): Promise<Line>; notify(method: string, params?: Line): Promise<void> }
/** A tool call's outcome: `isError`, and its value (structuredContent, else the first text block's JSON). */
export interface Outcome { isError: boolean; value: any; reply: Line }
let rpc = 0;
const nextId = (what: string): string => `${what}#${++rpc}`;
export async function initialize(m: Mcp): Promise<void> {
  const reply = await m.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-18-ac9', version: '0' } });
  if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
  await m.notify('notifications/initialized');
}
export async function callTool(m: Mcp, name: string, args: Line, timeoutMs?: number): Promise<Outcome> {
  const reply = await m.request('tools/call', { name, arguments: args }, timeoutMs);
  if (reply.error) return { isError: true, value: reply.error, reply };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
  const value = result.structuredContent ?? (typeof text === 'string' ? parse(text) ?? text : undefined);
  return { isError: result.isError === true, value, reply };
}

/** A `deep mcp` started by hand from this test process: its parent is no agent, and no session's hooks came from it. */
export class McpProcess implements Mcp {
  private readonly lines: string[] = [];
  private readonly wakers = new Set<() => void>();
  private err = '';
  private constructor(readonly child: ChildProcess) {
    createInterface({ input: child.stdout! }).on('line', (raw) => { this.lines.push(raw); for (const w of [...this.wakers]) w(); });
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
  request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const id = nextId(method);
    return new Promise((resolve, reject) => {
      const from = this.lines.length;
      const finish = () => { clearTimeout(timer); this.wakers.delete(check); };
      const timer = setTimeout(() => { finish(); reject(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        for (let i = from; i < this.lines.length; i++) {
          const json = parse(this.lines[i]!);
          if (json && json.id === id && ('result' in json || 'error' in json)) { finish(); resolve(json); return; }
        }
        if (this.child.exitCode !== null) { finish(); reject(Error(`deep mcp exited ${this.child.exitCode}: ${this.err}`)); }
      };
      this.wakers.add(check);
      this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      check();
    });
  }
}

// ---- The agent stand-in (fixtures/agent.mjs): a Claude Code process whose hooks are deep-hook and whose deep mcp
// is its child.
export interface Session { id: string; cwd: string; transcript: string }
export class Agent implements Mcp {
  private n = 0;
  private readonly waiting = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess, readonly home: string, readonly cwd: string, private readonly hookBinary: string) {
    child.on('exit', () => { for (const [n, done] of [...this.waiting]) done({ n, failed: 'the agent stand-in exited' }); });
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line && typeof line.n === 'number') this.waiting.get(line.n)?.(line);
      }
    });
  }
  get pid(): number { return this.child.pid!; }
  /** An agent process in `cwd`; `env` goes into its environment, so into its hooks' and its deep mcp's. */
  static async start(home: string, cwd: string, env: Record<string, string | undefined> = {}): Promise<Agent> {
    const binary = await deepHook();
    const child = spawn(NODE, [AGENT], { cwd, env: childEnv(home, env), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Agent(child, home, cwd, binary);
  }
  /** A new Claude Code session in this agent's folder, its transcript where Claude Code keeps it under the home. */
  session(): Session {
    const id = randomUUID();
    const transcript = join(this.home, '.claude/projects', this.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId: id, cwd: this.cwd, message: { role: 'user', content: 'tidy the release notes' } })}\n`);
    return { id, cwd: this.cwd, transcript };
  }
  private send(command: Line, timeoutMs = 150_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(n); reject(Error(`the agent stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.waiting.set(n, (line) => {
        clearTimeout(timer);
        this.waiting.delete(n);
        if (line.failed) reject(Error(`the agent stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** One hook: deep-hook run by this agent with Claude Code's payload for `event` (fields as in adapters/corpus/claude-code). */
  async hook(s: Session, event: string, extra: Line = {}): Promise<Line> {
    const payload: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
    if (event === 'SessionStart') Object.assign(payload, { source: 'startup', model: 'claude-haiku-5-5' });
    if (event === 'UserPromptSubmit') Object.assign(payload, { prompt: 'tidy the release notes', prompt_id: randomUUID() });
    if (event === 'PreToolUse') Object.assign(payload, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomBytes(12).toString('hex')}` });
    Object.assign(payload, extra);
    return this.send({ op: 'hook', binary: this.hookBinary, event, payload, cwd: s.cwd });
  }
  /** SessionStart, a prompt and a first tool call, each from deep-hook run by this agent; BLOCKED unless the hub records the session as verified. */
  async establish(hub: Hub, s: Session): Promise<void> {
    await this.hook(s, 'SessionStart');
    await this.hook(s, 'UserPromptSubmit');
    const last = await this.hook(s, 'PreToolUse');
    const started = await eventsMatching(hub, (e) => e.kind === 'session.start' && e.session === s.id);
    if (!started.length || started.some((e) => e.verified === false)) {
      throw Error(`BLOCKED: the hub recorded no verified session.start for ${s.id} from deep-hook (last hook: ${JSON.stringify(last)}): ${JSON.stringify(started)}`);
    }
  }
  /** The PreToolUse Claude Code fires before it calls `deep_<tool>` on the MCP server named deep: `mcp__deep__<tool>`, the call's arguments as tool_input. */
  stamp(s: Session, tool: string, args: Line): Promise<Line> {
    return this.hook(s, 'PreToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args });
  }
  /** One JSON-RPC request to this agent's own `deep mcp`, which the agent starts on first use. */
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const line = { jsonrpc: '2.0', id: nextId(method), method, params };
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', method, params } });
    own(r.pid as number);
  }
}
