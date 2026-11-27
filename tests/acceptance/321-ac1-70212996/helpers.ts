import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const VERSION = '2.1.304';
export const MODEL = 'claude-haiku-5-5';

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

const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh321-'));
  made.push(dir);
  return dir;
}

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
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) {
    if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const MARKERS = /^(CLAUDE|CURSOR|GROK|CODEX|ANTHROPIC|OPENAI|AWS_BEARER|DEEP_|XDG_|GIT_|npm_)/;
export function cleanEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (MARKERS.test(key) || key === 'AI_AGENT' || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  env.HOME = home;
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; ended: number }
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
    const done = (code: number | null, signal: NodeJS.Signals | null, extra = '') => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr: stderr + extra, ms: performance.now() - t0, timedOut, ended: Date.now() });
    };
    child.on('close', (code, signal) => done(code, signal));
    child.on('error', (error) => done(null, null, error.message));
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}

let built: Promise<string> | undefined;
export function deepHook(): Promise<string> {
  built ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 1_200_000 }).then((r) => {
    if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
    spawnSync(DEEP_HOOK, ['--version'], { stdio: 'ignore', timeout: 30_000 });
    return DEEP_HOOK;
  });
  return built;
}

export const rootOf = (home: string): string => join(home, '.deepbuild');
export function makeHome(): string {
  const home = join(tempDir(), 'h');
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(home), 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  const asks = {
    deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
    default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
    fallback: ['change-owner'],
    fold: 5,
  };
  writeFileSync(join(rootOf(home), 'config.json'), `${JSON.stringify({ asks }, null, 2)}\n`);
  writeFileSync(join(dirname(home), 'confirm'), 'confirmed\n');
  return home;
}

export interface Hub { home: string; root: string; socket: string; pid: number; stderr(): string }
export interface HubOptions {
  plant?: string | undefined;
  sorter?: string | undefined;
}
export async function startHub(home: string, o: HubOptions = {}, timeoutMs = 120_000): Promise<Hub> {
  const env = cleanEnv(home, { DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_SORTER: o.sorter, DEEP_HUB_TEST_CONFIRM: join(dirname(home), 'confirm') });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await new Promise<Line | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
    });
    void exited.then(() => resolve(undefined));
    setTimeout(() => resolve(undefined), timeoutMs);
  });
  if (!ready || ready.ready !== true) {
    expect.fail(`BLOCKED: the hub didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant} (the planted wrong program this test runs against)` : ''}: ${err.slice(0, 1500)}`);
  }
  return { home, root: rootOf(home), socket: String(ready!.socket), pid: child.pid!, stderr: () => err };
}

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
  async call(method: string, params: unknown = {}, timeoutMs = 60_000): Promise<Line> {
    const id = `t321#${++this.ids}`;
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await this.wait((l) => l.id === id && ('result' in l || 'error' in l), from, timeoutMs);
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    return reply;
  }
  close(): void { this.sock.destroy(); }
}
export async function control<T>(hub: Hub, use: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await use(conn);
  } finally {
    conn.close();
  }
}

export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; subject?: string; session?: string; data: Line }
export function allEvents(hub: Hub): Promise<Ev[]> {
  return control(hub, async (conn) => {
    const out: Ev[] = [];
    let after = 0;
    for (;;) {
      const reply = await conn.call('events.read', { after, limit: 1000 });
      if ('error' in reply) throw Error(`events.read refused: ${JSON.stringify(reply.error)}`);
      const events = reply.result.events as Ev[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos;
    }
  });
}
export const inboxRead = (hub: Hub): Promise<Line[]> => control(hub, async (conn) => {
  const reply = await conn.call('inbox.read');
  if ('error' in reply) throw Error(`inbox.read refused: ${JSON.stringify(reply.error)}`);
  return reply.result.asks as Line[];
});
export async function poll<T>(hub: Hub, found: (events: Ev[]) => T | undefined, timeoutMs = 20_000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = found(await allEvents(hub));
    if (hit !== undefined || Date.now() > deadline) return hit;
    await sleep(250);
  }
}

const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
export const gitEnv = (home: string) => cleanEnv(home, GIT_ENV);
export function git(home: string, cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env: gitEnv(home), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export interface Shop { work: string; remote: string }
export function shop(home: string): Shop {
  const dir = tempDir();
  const remote = join(dir, 'origin.git');
  const work = join(dir, 'shop');
  mkdirSync(work);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { env: gitEnv(home), stdio: 'ignore' });
  writeFileSync(join(work, 'README.md'), '# shop\n\nA shop that sells teh things.\n');
  writeFileSync(join(work, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0', private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2)}\n`);
  git(home, work, 'init', '-q', '-b', 'main');
  git(home, work, 'add', '-A');
  git(home, work, 'commit', '-q', '-m', 'Start');
  git(home, work, 'remote', 'add', 'origin', remote);
  git(home, work, 'push', '-q', 'origin', 'main');
  return { work, remote };
}
export const remoteMain = (home: string, shop: Shop): string => git(home, shop.remote, 'rev-parse', 'refs/heads/main');

export interface HookCall { event: string; payload: Line; ran: Ran }
export const claudeEnv = (home: string, cwd: string) => cleanEnv(home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd });

export interface Pending { id: string; tool: string; input: Line; started: number; decided: Promise<HookCall> }

export class Session {
  readonly id = randomUUID();
  readonly transcript: string;
  promptId: string | undefined;
  private parent: string | null = null;
  private turn = 0;
  private readonly env: NodeJS.ProcessEnv;
  constructor(readonly home: string, readonly cwd: string) {
    this.transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    this.env = claudeEnv(home, cwd);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
  }
  entry(value: Line): void {
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: VERSION, gitBranch: 'main' };
    this.parent = uuid;
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  async hook(event: string, fields: Line = {}): Promise<HookCall> {
    const payload: Line = {
      session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, ...(this.promptId ? { prompt_id: this.promptId } : {}),
      permission_mode: 'default', effort: { level: 'medium' }, hook_event_name: event, ...fields,
    };
    const ran = await run(await deepHook(), ['claude-code', event], { cwd: this.cwd, env: this.env, input: JSON.stringify(payload), timeoutMs: event === 'Stop' ? 600_000 : 60_000 });
    return { event, payload, ran };
  }
  start(): Promise<HookCall> {
    return this.hook('SessionStart', { source: 'startup', model: MODEL });
  }
  async prompt(text: string): Promise<void> {
    this.promptId = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, turnOrigin: 'human', turnPosition: { promptIndex: 1, turnIndex: this.turn } });
    await this.hook('UserPromptSubmit', { prompt: text });
  }
  pre(tool: string, input: Line): Pending {
    const id = `toolu_${randomBytes(12).toString('hex')}`;
    this.entry({ type: 'assistant', message: { model: MODEL, id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id, name: tool, input }], stop_reason: 'tool_use', usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 } } });
    const started = Date.now();
    return { id, tool, input, started, decided: this.hook('PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id }) };
  }
  async post(call: Pending, response: Line | { refused: string }): Promise<void> {
    if ('refused' in response) {
      this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: response.refused, is_error: true }] }, toolUseResult: `Error: ${response.refused}` });
      return;
    }
    this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(response), is_error: false }] }, toolUseResult: response });
    await this.hook('PostToolUse', { tool_name: call.tool, tool_input: call.input, tool_response: response, tool_use_id: call.id, duration_ms: 40 });
  }
  async stop(said: string): Promise<HookCall> {
    this.entry({ type: 'assistant', message: { model: MODEL, id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: said }], stop_reason: 'end_turn', usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 12 } } });
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: said });
  }
}

export function letThrough(h: HookCall): boolean {
  if (h.ran.code === 2) return false;
  if (h.ran.code !== 0) return true;
  const out = parseObject(h.ran.stdout.trim());
  const decision = out?.hookSpecificOutput?.permissionDecision;
  return !(decision === 'deny' || decision === 'ask' || out?.decision === 'block' || out?.continue === false);
}
export const refusal = (h: HookCall): string => (h.ran.code === 2 ? h.ran.stderr : String(parseObject(h.ran.stdout.trim())?.hookSpecificOutput?.permissionDecisionReason ?? parseObject(h.ran.stdout.trim())?.reason ?? h.ran.stdout)).trim();
export const said = (h: HookCall) => `exit ${h.ran.code}${h.ran.timedOut ? ' (killed at the timeout)' : ''}, stdout ${JSON.stringify(h.ran.stdout.slice(0, 400))}, stderr ${JSON.stringify(h.ran.stderr.slice(0, 400))}`;

export async function failureOf(check: () => unknown): Promise<string | null> {
  try {
    await check();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
