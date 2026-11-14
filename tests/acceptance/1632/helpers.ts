// Test-side tools for the #1632 acceptance tests, adapted from tests/acceptance/26/helpers.ts: a real hub
// (`deep hub run`) in a temporary home, the real deep-hook (target/debug/deep-hook) run as a hook of an agent
// stand-in (fixtures/agent.mjs) whose hooks and one `deep mcp` are its children, so the hub sees a true process tree,
// and the real `deep` CLI. Every observation goes through the MCP protocol, the hub's socket (`events.read`), deep-hook's
// output, or `deep` commands; no hub or CLI module is imported. Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { askSources, openAsks, type AskKind } from '../../../packages/asks/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const NODE = process.execPath;
export const DAY = 86_400_000;
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const parse = (raw: string): Line | undefined => { try { return JSON.parse(raw) as Line; } catch { return undefined; } };
/** A short random word of lower-case letters and digits, starting with a letter. */
export const word = (n = 8): string => `q${randomBytes(n).toString('hex').slice(0, n - 1)}`;

/** A checkout's built pieces: its CLI (`deep`, `deep hub run`, `deep mcp`) and its deep-hook. */
export interface Tree { root: string; cli: string; hook: string }
export const treeAt = (root: string): Tree => ({ root, cli: join(root, 'packages/cli/dist/main.js'), hook: join(root, 'target/debug/deep-hook') });
/** This checkout. */
export const HERE = treeAt(REPO);
/** Throws BLOCKED unless the tree's CLI and deep-hook are built. */
export function built(tree: Tree): void {
  if (!existsSync(tree.cli)) throw Error(`BLOCKED: no built CLI at ${tree.cli}; run npm run build --workspaces`);
  if (!existsSync(tree.hook)) throw Error(`BLOCKED: no deep-hook at ${tree.hook}; run cargo build --locked -q -p deep-hook`);
}

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
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1632-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
export const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Stops every process this suite started, by PID (SIGTERM, then SIGKILL after 3 s), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  // A process of the hub's that outlives it by a moment may write under the home again (a Claude settings backup
  // was seen to); a second pass removes that too.
  const dirs = made.splice(0);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  await sleep(500);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** This environment with HOME moved to the test's home, none of the hub's, Claude's or Codex's settings and no billing keys, plus `extra`. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('TMUX') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
export interface Ran { code: number | null; stdout: string; stderr: string }
function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 60_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
/** `deep <args>` from the built CLI, run by you: a child of this test process, under no agent. */
export const deep = (home: string, args: readonly string[], tree = HERE): Promise<Ran> => run(NODE, [tree.cli, ...args], { env: childEnv(home) });

// ---- A home and a worktree: a git repo with a spec, .deepbuild/done.yaml (as tests/acceptance/26 writes it).
const rootOf = (home: string): string => join(home, '.deepbuild');
export function makeHome(): { tmp: string; home: string } {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  return { tmp, home };
}
function doneYaml(): string {
  return [
    'claims:',
    '  done:',
    '    checks: [unit, lint]',
    'checks:',
    '  unit: { type: command, run: "false" }',
    '  lint: { type: command, run: "false" }',
    'asks:',
    '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
    '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
    '  fallback: [change-owner]',
    '',
  ].join('\n');
}
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
/** A worktree at `dir`: a fresh git repo of its own (never this checkout) whose one commit holds the spec. */
export function makeWorktree(dir: string): { path: string; commit: string } {
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), doneYaml());
  const env = { ...process.env, ...GIT_ENV, HOME: dir };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return { path: realpathSync(dir), commit: git('rev-parse', 'HEAD') };
}

// ---- A past decision's ask, seeded before the hub starts through the real record and asks core (as suite 26 does).
const who = { actor: 'you', scope: 'you' };
const PROJECT = 'shop';
/** Seeds a past session in `worktree` with a choice ask `question` (SQLite or plain files); its handle. */
export async function seedPastAsk(home: string, worktree: string, question: string): Promise<string> {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  const now = Date.now();
  const record = await openRecord({ path: join(rootOf(home), 'ledger.db'), now: () => now });
  const asks = await openAsks({ record, now: () => now, deliver: () => undefined });
  const session = 'S0past';
  try {
    await record.append({ writer: 'hook', ...who, session, project: PROJECT, agent: 'claude-code' }, { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree, branch: 'main', thread: session } });
    const source = askSources().find((row) => row.kind === ('choice' as AskKind) && !/^(asks|request)\./.test(row.source))!.source;
    return await asks.raise({ writer: 'core', ...who, session, project: PROJECT }, source, {
      kind: 'choice', question, options: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }],
      recommended: 'sqlite', deadline: now + DAY, fallback: 'you', default: 'sqlite', provisional: false, owner: 'you', key: sha256(`choice:${question}`),
      pinned_to: { kind: 'evidence', ref: sha256(question) },
    });
  } finally {
    await record.close();
  }
}

// ---- The hub: `deep hub run` with HOME at the test's home, so its root is <home>/.deepbuild.
export interface Hub { pid: number; home: string; socket: string; child: ChildProcess; output(): string }
/** Starts the hub of `home` from `tree`. Its OS confirmation is #24's stub (DEEP_HUB_TEST_CONFIRM), so `deep inbox answer` counts. */
export async function startHub(home: string, tree = HERE): Promise<Hub> {
  built(tree);
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const child = spawn(NODE, [tree.cli, 'hub', 'run'], { cwd: tree.root, env: childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  if (!ready) throw Error(`BLOCKED: the hub didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), child, output: () => out };
}

// ---- The socket: `events.read` on a `cli` connection holding the control token (tests/acceptance/16/README.md).
class Conn {
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
    if (!(await conn.until((l) => l.length > 0))) throw Error(`BLOCKED: no hello from the hub at ${socket}`);
    conn.sock.write(`${JSON.stringify({ v: 1, ...hello })}\n`);
    return { conn, answer: await conn.until((l) => l.length > 1) ? conn.lines[1] : undefined };
  }
  private until(done: (lines: Line[]) => boolean, timeoutMs = 10_000): Promise<boolean> {
    return new Promise((resolve) => {
      const check = () => {
        if (done(this.lines) || this.closed) { clearTimeout(timer); this.wakers.delete(check); resolve(done(this.lines)); }
      };
      const timer = setTimeout(() => { this.wakers.delete(check); resolve(false); }, timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  async call(method: string, params: Line = {}): Promise<Line> {
    const id = `t1632#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    if (!(await this.until((l) => l.some((x) => x.id === id), 30_000))) throw Error(`no reply to ${method} within 30 s`);
    return this.lines.find((l) => l.id === id)!;
  }
  close(): void { this.sock.destroy(); }
}
export interface Ev { id: string; kind: string; subject?: string; writer: string; session?: string; ts: number; data: Line; log_pos: number }
/** Every event in the hub's log, through `events.read`. */
export async function events(hub: Hub): Promise<Ev[]> {
  const token = readFileSync(join(rootOf(hub.home), 'control.token'), 'utf8').trim();
  const { conn, answer } = await Conn.open(hub.socket, { hello: 'cli', token });
  if (answer?.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(answer)}`);
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

// ---- MCP: newline-delimited JSON-RPC 2.0 over the agent's `deep mcp` stdio, as a real MCP client speaks it.
export interface Outcome { isError: boolean; value: any; reply: Line; ms: number; protocolError: boolean }
let rpc = 0;
function outcomeOf(reply: Line, ms: number): Outcome {
  if (reply.error) return { isError: true, value: reply.error, reply, ms, protocolError: true };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
  const value = result.structuredContent ?? (typeof text === 'string' ? parse(text) ?? text : undefined);
  return { isError: result.isError === true, value, reply, ms, protocolError: false };
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

// ---- The agent stand-in (fixtures/agent.mjs): one Claude Code process, its sessions as the hub sees them through deep-hook.
export interface Session { id: string; cwd: string; transcript: string }
export interface Fired { code: number | null; stdout: string; stderr: string }
export class Agent {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess, readonly home: string, readonly cwd: string, readonly tree: Tree) {
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
  /** A Claude Code process in `cwd`, run from `tree` (its deep-hook and its `deep mcp`). */
  static start(home: string, cwd: string, tree = HERE): Agent {
    built(tree);
    const child = spawn(NODE, [AGENT], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Agent(child, home, cwd, tree);
  }
  /** A new session ID in `cwd`, its transcript where Claude Code keeps it under the agent's home (a `/clear` starts a new file too). */
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
  /** One hook: `deep-hook claude-code <event>` run as this process's child, the hook JSON on its stdin, as Claude Code runs it. */
  async hook(s: Session, event: string, extra: Line = {}): Promise<Fired> {
    const payload: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
    if (event === 'SessionStart') Object.assign(payload, { source: 'startup', model: 'claude-haiku-5-5' });
    if (event === 'UserPromptSubmit') Object.assign(payload, { prompt: 'fix the login page' });
    if (event === 'PreToolUse') Object.assign(payload, { tool_name: 'Bash', tool_input: { command: 'ls', description: 'List files' }, tool_use_id: `toolu_${randomBytes(12).toString('hex')}` });
    if (event === 'SessionEnd') Object.assign(payload, { reason: 'other' });
    Object.assign(payload, extra);
    const r = await this.send({ op: 'hook', argv: [this.tree.hook, 'claude-code', event], input: JSON.stringify(payload), cwd: s.cwd });
    return { code: r.code as number | null, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
  }
  /** SessionStart (`source`), and once the hub has the session, a prompt and a first tool call. */
  async establish(hub: Hub, s: Session, source = 'startup'): Promise<Fired[]> {
    const fired = [await this.hook(s, 'SessionStart', { source })];
    if (!(await eventMatching(hub, (e) => e.kind === 'session.start' && e.session === s.id))) throw Error(`BLOCKED: no session.start for ${s.id} after its SessionStart (${source}): ${JSON.stringify(fired[0])}`);
    fired.push(await this.hook(s, 'UserPromptSubmit'));
    fired.push(await this.hook(s, 'PreToolUse'));
    return fired;
  }
  /** The PreToolUse Claude Code fires for its next call of the deep tool `tool` with `args`. */
  stamp(s: Session, tool: string, args: Line): Promise<Fired> {
    return this.hook(s, 'PreToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args });
  }
  /** SessionEnd with `reason`, once the hub has recorded it. */
  async end(hub: Hub, s: Session, reason: string): Promise<Fired> {
    const fired = await this.hook(s, 'SessionEnd', { reason });
    if (!(await eventMatching(hub, (e) => e.kind === 'session.end' && e.session === s.id))) throw Error(`BLOCKED: no session.end for ${s.id} after its SessionEnd (${reason}): ${JSON.stringify(fired)}`);
    return fired;
  }
  /** One JSON-RPC request to this agent's own `deep mcp`, which the agent starts on first use. */
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<{ reply: Line; ms: number }> {
    const line = { jsonrpc: '2.0', id: `${method}#${++rpc}`, method, params };
    const r = await this.send({ op: 'mcp', argv: [NODE, this.tree.cli, 'mcp'], line, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return { reply: r.reply as Line, ms: r.ms as number };
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    await this.send({ op: 'mcp', argv: [NODE, this.tree.cli, 'mcp'], line: { jsonrpc: '2.0', method, params } });
  }
  async initialize(): Promise<void> {
    const { reply } = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1632', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.notify('notifications/initialized');
  }
  async call(name: string, args: Line, timeoutMs?: number): Promise<Outcome> {
    const { reply, ms } = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    return outcomeOf(reply, ms);
  }
  /** Its deep mcp's PID, and whether that process still runs. */
  async mcpProcess(): Promise<{ pid: number | null; alive: boolean }> {
    const r = await this.send({ op: 'mcp-pid' });
    return { pid: r.pid as number | null, alive: r.alive as boolean };
  }
}

export interface World { tmp: string; home: string; wt: { path: string; commit: string }; agent: Agent; a: Session; hub: Hub }
/**
 * A home, a worktree, a Claude Code process working there with session A established through deep-hook, the hub, and
 * the process's deep mcp initialized and bound to A: its deep_status names A.
 */
export async function world(o: { tree?: Tree; seeded?: (home: string, worktree: string) => Promise<void> } = {}): Promise<World> {
  const tree = o.tree ?? HERE;
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'work'));
  const agent = Agent.start(home, wt.path, tree);
  const a = agent.session();
  if (o.seeded) await o.seeded(home, wt.path);
  const hub = await startHub(home, tree);
  await agent.establish(hub, a);
  await agent.initialize();
  const status = valueOf(await agent.call('deep_status', {}), `deep_status from session ${a.id}'s deep mcp`);
  if (status?.session !== a.id) throw Error(`BLOCKED: the deep mcp didn't bind to session ${a.id} at its hello: deep_status says ${JSON.stringify(status)}`);
  return { tmp, home, wt, agent, a, hub };
}

/**
 * `/clear` in the agent's process: SessionEnd (reason clear) for `from`, then SessionStart (source clear) for a new ID
 * from the same process (same PID and start time), its prompt and a tool call. Throws BLOCKED unless the hub joined the
 * new ID to `from`'s thread, which is how the hub reads "a start naming the ended session as its parent".
 */
export async function clear(w: World, from: Session): Promise<{ b: Session; fired: Fired[] }> {
  await w.agent.end(w.hub, from, 'clear');
  const b = w.agent.session();
  const fired = await w.agent.establish(w.hub, b, 'clear');
  const all = await events(w.hub);
  const startOf = (id: string) => all.find((e) => e.kind === 'session.start' && e.session === id);
  const thread = startOf(from.id)?.data?.thread ?? from.id;
  if (startOf(b.id)?.data?.thread !== thread) throw Error(`BLOCKED: the hub didn't join ${b.id} to ${from.id}'s thread ${thread} after /clear: ${JSON.stringify(startOf(b.id))}`);
  return { b, fired };
}

/** claim.made@1's data for a deep_claim, with a task of its own so its claim.made can be found. */
export function claimArgs(): Line {
  return { task_ref: `task:${ulid()}`, attempt: 1, commit: randomBytes(20).toString('hex'), scope: 'session' };
}
/** The claim.made events for a task_ref. */
export const claimsFor = (all: readonly Ev[], taskRef: string): Ev[] => all.filter((e) => e.kind === 'claim.made' && e.data?.task_ref === taskRef);

// ---- Budgets: the design's rule for timing results, as tests/acceptance/26 judges them.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here is only a reading, or null on a reference Mac on mains power, Low Power Mode off, thermal state nominal. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}, not a reference Mac`;
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
/**
 * "No change" against the merge base, by the design's timing rule applied to five paired runs: each pair's ratio is
 * this tree's p95 over the base's. PASS when every ratio is within 1 + margin; FAIL when every ratio is over it; else
 * INCONCLUSIVE. The margin is the larger of 5% and the base runs' spread.
 */
export function judgeAgainstBase(ctx: TestContext, name: string, current: number[], base: number[]): void {
  const spread = (Math.max(...base) - Math.min(...base)) / Math.max(Math.min(...base), 1e-9);
  const margin = Math.max(0.05, spread);
  const ratios = current.map((c, i) => c / Math.max(base[i]!, 1e-9));
  const shown = `${name}: this tree ${current.map((r) => r.toFixed(1)).join(', ')} ms, merge base ${base.map((r) => r.toFixed(1)).join(', ')} ms (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (ratios.every((r) => r <= 1 + margin)) return;
  expect(ratios.every((r) => r > 1 + margin), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
