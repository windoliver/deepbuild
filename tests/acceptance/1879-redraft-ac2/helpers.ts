// Test-side tools for #1879's second criterion, after #363's hub.ts: a real hub (`deep hub run`) in a temp home, one
// test package installed through `deep install` with the OS confirmation stubbed, and an agent stand-in
// (fixtures/agent.mjs) whose hooks and `deep-actions` server (`deep mcp actions`) are its children, so the hub sees a
// true process tree. Every observation goes through MCP or the hub's own output; no hub or CLI module is imported.
//
// Safety: every folder is under /tmp/dh1879r2-* (real paths); HOME is a temp folder for this process and every child;
// CLAUDE*, DEEP_* and the like are taken out of every child's environment; no test touches the real ~/.deepbuild.
// Processes are stopped by PID only, never by name or port. Every wait is bounded, and one that runs out throws
// BLOCKED with what was waited for.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const AGENT = join(FIXTURES, 'agent.mjs');
const NODE = process.execPath;
export type Line = { [key: string]: any };
const parse = (text: string): Line | undefined => { try { return JSON.parse(text) as Line; } catch { return undefined; } };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The waits, each bounded and generous: this suite must pass on a machine at load 100 to 200. */
export const WAIT = { hubReady: 240_000, hubStop: 90_000, install: 300_000, hook: 75_000, mcp: 180_000 } as const;
/** The test's own timeout: above the sum of every wait one run can make, so a wait's own message is what fails. */
export const TEST_TIMEOUT = 2 * WAIT.hubReady + WAIT.hubStop + WAIT.install + 3 * WAIT.hook + 4 * (WAIT.mcp + 5000) + 120_000;

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh1879r2-${tag}-`));
  made.push(dir);
  return dir;
}
process.env.HOME = tempDir('home');

// ---- Processes this file started, stopped by PID after the file.
const owned = new Set<number>();
const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 20_000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 60_000);

/** This environment with HOME moved to the test's home and none of the hub's or an agent's settings, plus `extra`. */
function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('TMUX') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('VITEST') || key === 'AI_AGENT' || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' }, extra);
}

// ---- The test package: fixtures/<name> copied to a temp folder, its digest stamped.
/** The extension host's public entry, for `packageDigest` only; loaded lazily. */
const host = () => import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as Promise<typeof import('../../../packages/extension-host/src/index.ts')>;
/**
 * `fixtures/<name>` in a temp folder, each `*.fixture` file renamed without that suffix (so neither Vitest nor the type
 * check picks the plug-in's code up), and the manifest's `digest` set to the host's own `packageDigest` of the result.
 */
export async function pkg(name: string): Promise<string> {
  const dir = tempDir(`pkg-${name}`);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  for (const entry of readdirSync(dir)) if (entry.endsWith('.fixture')) renameSync(join(dir, entry), join(dir, entry.slice(0, -'.fixture'.length)));
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (packageDigest(dir) !== manifest.digest) throw Error(`BLOCKED: writing packageDigest into ${name}'s deepbuild.json changed it`);
  return dir;
}

// ---- A worktree: a git repo of its own (never this checkout) with a repo's spec.
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
  const env = { ...process.env, ...GIT_ENV, HOME: dir };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, encoding: 'utf8', timeout: 120_000 }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return realpathSync(dir);
}

// ---- `deep <args>` with HOME at the test's home.
export interface Ran { code: number | null; stdout: string; stderr: string; timedOut: boolean }
export function deep(args: readonly string[], home: string, ms: number): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd: REPO, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, ms);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

// ---- The hub: `deep hub run` with HOME at the test's home, so its root is <home>/.deepbuild.
export interface Hub {
  pid: number;
  home: string;
  socket: string;
  /** Its ready line, as it printed it. */
  ready: Line;
  /** Everything it wrote to stderr so far. */
  stderr(): string;
  /** Stops it with SIGTERM, by its PID, and waits for it to exit. */
  stop(): Promise<void>;
}
/**
 * Starts `deep hub run <args>` and waits for its ready line. `confirm` stubs the OS confirmation an install needs
 * (DEEP_HUB_TEST_CONFIRM, the hub's own test setting); without it the hub gets no DEEP_* variable at all.
 */
export async function startHub(home: string, args: readonly string[], options: { confirm?: boolean } = {}): Promise<Hub> {
  const extra: Record<string, string> = {};
  if (options.confirm) {
    extra.DEEP_HUB_TEST_CONFIRM = join(dirname(home), 'confirm');
    writeFileSync(extra.DEEP_HUB_TEST_CONFIRM, 'confirmed\n');
  }
  const what = `deep hub run${args.map((a) => ` ${a}`).join('')}`;
  const child = spawn(NODE, [CLI, 'hub', 'run', ...args], { cwd: REPO, env: childEnv(home, extra), stdio: ['ignore', 'pipe', 'pipe'] });
  own(child.pid);
  let stderr = '';
  let stdout = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const first = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve(`no ready line in ${WAIT.hubReady} ms`), WAIT.hubReady);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      stdout += d;
      if (stdout.includes('\n')) { clearTimeout(timer); resolve(''); }
    });
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve(`it exited (${code ?? signal}) before its ready line`); });
  });
  const ready = parse(stdout.split('\n')[0] ?? '');
  if (first || ready?.ready !== true) throw Error(`BLOCKED: ${what} didn't start: ${first || 'its first line is not a ready line'}: ${(stdout + stderr).slice(0, 2000)}`);
  return {
    pid: child.pid!, home, socket: join(home, '.deepbuild', 'hub.sock'), ready, stderr: () => stderr,
    stop: async () => {
      child.kill('SIGTERM');
      const stopped = await Promise.race([exited.then(() => true), sleep(WAIT.hubStop).then(() => false)]);
      if (!stopped) throw Error(`BLOCKED: ${what} (pid ${child.pid}) didn't exit within ${WAIT.hubStop} ms of SIGTERM: ${stderr.slice(-2000)}`);
    },
  };
}

// ---- The agent stand-in and its session, established through its hooks; MCP through its own server.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
const ulid = (): string => base32(BigInt(Date.now()), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
/** A request ID, as an agent's call through deep-actions carries one. */
export const requestId = (): string => `req-${randomBytes(8).toString('hex')}`;

export interface Outcome { isError: boolean; value: any; reply: Line }
export interface Session { id: string; cwd: string; transcript: string }
const SERVER = 'deep-actions';
const SERVER_ARGV = [NODE, CLI, 'mcp', 'actions'];
export class Agent {
  private n = 0;
  private rpc = 0;
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
  private send(command: Line, timeoutMs: number): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`BLOCKED: the agent stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`BLOCKED: the agent stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** One hook, from a child of this agent (deep-hook's wire); throws BLOCKED unless the hub acknowledged it. */
  private async hook(hub: Hub, s: Session, event: string): Promise<void> {
    const payload: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
    if (event === 'SessionStart') Object.assign(payload, { source: 'startup', model: 'claude-haiku-5-5' });
    if (event === 'UserPromptSubmit') Object.assign(payload, { prompt: 'say hello', prompt_id: randomUUID() });
    if (event === 'PreToolUse') Object.assign(payload, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomUUID()}` });
    const request = { v: 1, agent: 'claude-code', event, seq: String(this.seq += 1000n), id: ulid(), matched: [], payload };
    const r = await this.send({ op: 'hook', socket: hub.socket, request, cwd: s.cwd }, WAIT.hook);
    if (!(r.lines as string[] ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} for ${s.id}: ${JSON.stringify(r)}`);
  }
  async establish(hub: Hub, s: Session): Promise<void> {
    await this.hook(hub, s, 'SessionStart');
    await this.hook(hub, s, 'UserPromptSubmit');
    await this.hook(hub, s, 'PreToolUse');
  }
  /** One JSON-RPC request to this agent's own `deep-actions` server, which it starts on first use. */
  private async request(method: string, params: Line): Promise<Line> {
    const line = { jsonrpc: '2.0', id: `${SERVER}#${++this.rpc}`, method, params };
    const r = await this.send({ op: 'mcp', server: SERVER, argv: SERVER_ARGV, line, timeoutMs: WAIT.mcp }, WAIT.mcp + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async initialize(): Promise<void> {
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1879-redraft-ac2', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: the ${SERVER} server refused initialize: ${JSON.stringify(reply)}`);
    await this.send({ op: 'mcp', server: SERVER, argv: SERVER_ARGV, line: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } }, WAIT.mcp);
  }
  async callTool(name: string, args: Line): Promise<Outcome> {
    const reply = await this.request('tools/call', { name, arguments: args });
    if (reply.error) return { isError: true, value: reply.error, reply };
    const result = (reply.result ?? {}) as Line;
    const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
    const value = result.structuredContent ?? (typeof text === 'string' ? parse(text) ?? text : undefined);
    return { isError: result.isError === true, value, reply };
  }
}
