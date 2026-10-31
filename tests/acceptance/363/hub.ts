// Hub-level tools for the #363 acceptance tests that need what an agent sees (AC1, AC5, AC6's error), after #26's: a
// real hub (`deep hub run`) in a temp home, test plug-ins installed through `deep install` (#351) with the OS
// confirmation stubbed, and an agent stand-in (fixtures/agent.mjs) whose hooks and two MCP servers, `deep` (`deep
// mcp`) and `deep-actions` (`deep mcp actions`), are its children, so the hub sees a true process tree. Every
// observation goes through MCP, the hub's socket (`events.read` on a cli connection) or `deep` commands; no hub or CLI
// module is imported. Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { sleep, tempDir, ulid } from './helpers.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const NODE = process.execPath;
export type Line = { [key: string]: any };
const parse = (text: string): Line | undefined => { try { return JSON.parse(text) as Line; } catch { return undefined; } };

/** The two server entries an agent's config names (README, The surface under test). */
export const SERVERS = { deep: [CLI, 'mcp'], 'deep-actions': [CLI, 'mcp', 'actions'] } as const;
export type Server = keyof typeof SERVERS;

// ---- Processes this file started, stopped by PID after the file.
const owned = new Set<number>();
const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
}, 30_000);

/** This environment with HOME moved to the test's home and none of the hub's settings, plus `extra`. */
function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
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
interface Ran { code: number | null; stdout: string; stderr: string }
function run(args: readonly string[], home: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd: REPO, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// ---- A worktree: a git repo of its own (never this checkout) with the repo's spec.
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
function makeWorktree(dir: string): string {
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), DONE_YAML);
  const env = { ...process.env, ...GIT_ENV, HOME: dir };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return realpathSync(dir);
}

// ---- The hub: `deep hub run` with HOME at the test's home, so its root is <home>/.deepbuild.
export interface Hub { pid: number; home: string; socket: string; output(): string }
async function startHub(home: string): Promise<Hub> {
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  return { pid: child.pid!, home, socket: join(home, '.deepbuild', 'hub.sock'), output: () => out };
}

/** One connection to the hub's socket holding the control token, as `deep` holds it: `events.read`. */
async function eventsOf(hub: Hub): Promise<Line[]> {
  const token = readFileSync(join(hub.home, '.deepbuild', 'control.token'), 'utf8').trim();
  const sock = net.connect(hub.socket);
  const lines: Line[] = [];
  const wakers = new Set<() => void>();
  let buffer = '';
  sock.setEncoding('utf8').on('data', (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      lines.push(parse(buffer.slice(0, i)) ?? {});
      buffer = buffer.slice(i + 1);
    }
    for (const w of [...wakers]) w();
  });
  sock.on('error', () => { for (const w of [...wakers]) w(); });
  const wait = (pred: () => boolean, ms = 10_000): Promise<void> => new Promise((resolve, reject) => {
    const check = () => { if (pred()) { clearTimeout(timer); wakers.delete(check); resolve(); } };
    const timer = setTimeout(() => { wakers.delete(check); reject(Error('BLOCKED: the hub gave no answer on its socket')); }, ms);
    wakers.add(check);
    check();
  });
  try {
    await wait(() => lines.length >= 1);
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    await wait(() => lines.length >= 2);
    if (lines[1]!.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(lines[1])}`);
    const all: Line[] = [];
    for (let after = 0, n = 0; ; n++) {
      const id = `t363#${n}`;
      sock.write(`${JSON.stringify({ v: 1, id, method: 'events.read', params: { after, limit: 1000 } })}\n`);
      await wait(() => lines.some((l) => l.id === id));
      const reply = lines.find((l) => l.id === id)!;
      if (reply.error) throw Error(`BLOCKED: events.read refused: ${JSON.stringify(reply.error)}`);
      const page = reply.result.events as Line[];
      if (!page.length) return all;
      all.push(...page);
      after = page[page.length - 1]!.log_pos;
    }
  } finally {
    sock.destroy();
  }
}

// ---- MCP, through the agent stand-in's own servers.
export interface Outcome { isError: boolean; value: any; reply: Line; protocolError: boolean }
function outcomeOf(reply: Line): Outcome {
  if (reply.error) return { isError: true, value: reply.error, reply, protocolError: true };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
  const value = result.structuredContent ?? (typeof text === 'string' ? parse(text) ?? text : undefined);
  return { isError: result.isError === true, value, reply, protocolError: false };
}
let rpc = 0;

export interface Session { id: string; cwd: string; transcript: string }
/** The agent stand-in and its session, established through its hooks. */
export class Agent {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private seq = BigInt(Date.now()) * 1_000_000n;
  private constructor(private readonly child: ChildProcess, readonly home: string) {
    let buffer = '';
    child.on('exit', () => { for (const [n, settle] of [...this.pending]) settle({ n, failed: 'the agent stand-in exited' }); });
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
    return new Agent(child, home);
  }
  session(cwd: string): Session {
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
  async hook(hub: Hub, s: Session, event: string, extra: Line = {}): Promise<void> {
    const payload: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
    if (event === 'SessionStart') Object.assign(payload, { source: 'startup', model: 'claude-haiku-5-5' });
    if (event === 'UserPromptSubmit') Object.assign(payload, { prompt: 'watch NVDA for me', prompt_id: randomUUID() });
    if (event === 'PreToolUse') Object.assign(payload, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomUUID()}` });
    Object.assign(payload, extra);
    const request = { v: 1, agent: 'claude-code', event, seq: String(this.seq += 1000n), id: ulid(), matched: [], payload };
    const r = await this.send({ op: 'hook', socket: hub.socket, request, cwd: s.cwd });
    if (!(r.lines as string[] ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} for ${s.id}: ${JSON.stringify(r)}`);
  }
  async establish(hub: Hub, s: Session): Promise<void> {
    await this.hook(hub, s, 'SessionStart');
    await this.hook(hub, s, 'UserPromptSubmit');
    await this.hook(hub, s, 'PreToolUse');
  }
  /** One JSON-RPC request to this agent's own server `server`, which it starts on first use. */
  async request(server: Server, method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const line = { jsonrpc: '2.0', id: `${server}#${++rpc}`, method, params };
    const r = await this.send({ op: 'mcp', server, argv: [NODE, ...SERVERS[server]], line, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async notify(server: Server, method: string): Promise<void> {
    await this.send({ op: 'mcp', server, argv: [NODE, ...SERVERS[server]], line: { jsonrpc: '2.0', method, params: {} } });
  }
  async initialize(server: Server): Promise<void> {
    const reply = await this.request(server, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-363', version: '0' } });
    if (!reply.result) throw Error(`the ${server} server refused initialize: ${JSON.stringify(reply)}`);
    await this.notify(server, 'notifications/initialized');
  }
  async tools(server: Server): Promise<{ name: string; description?: string; inputSchema: Line }[]> {
    const reply = await this.request(server, 'tools/list', {});
    if (!Array.isArray(reply.result?.tools)) throw Error(`the ${server} server's tools/list gave no tools: ${JSON.stringify(reply)}`);
    return reply.result.tools;
  }
  async callTool(server: Server, name: string, args: Line, timeoutMs?: number): Promise<Outcome> {
    return outcomeOf(await this.request(server, 'tools/call', { name, arguments: args }, timeoutMs));
  }
}

/** A hub with plug-ins installed through `deep install`, and an agent working in a worktree, its session established. */
export interface HubWorld { hub: Hub; agent: Agent; session: Session; events(): Promise<Line[]> }
export async function hubWorld(packages: string[]): Promise<HubWorld> {
  const tmp = tempDir('hub');
  const home = join(tmp, 'h');
  mkdirSync(home);
  const wt = makeWorktree(join(tmp, 'work'));
  const agent = Agent.start(home, wt);
  const session = agent.session(wt);
  const hub = await startHub(home);
  for (const dir of packages) {
    const r = await run(['install', dir], home);
    if (r.code !== 0) throw Error(`deep install ${dir} exited ${r.code}: ${r.stdout}${r.stderr}`);
  }
  await agent.establish(hub, session);
  return { hub, agent, session, events: () => eventsOf(hub) };
}

/**
 * The first event matching `pred`, polling the hub's log until `ms`; undefined if none came. A call left waiting goes
 * on meanwhile.
 */
export async function eventMatching(w: HubWorld, pred: (e: Line) => boolean, ms = 20_000): Promise<Line | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = (await w.events()).find(pred);
    if (found || Date.now() > deadline) return found;
    await sleep(200);
  }
}
