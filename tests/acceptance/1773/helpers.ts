// Test-side tools for the #1773 acceptance tests (README): a real hub (`deep hub run`) in a temp home, agents' hook
// lines written on its socket the way deep-hook writes them, the record read back from its ledger, and a fixture home
// for `toolLists`. This suite keeps its own copies of the shapes in packages/hub/test/hub.ts and
// packages/hub/test/waits-hub.test.ts, so a change to theirs never moves these tests.
//
// Safety: every folder is under /tmp/dh1773-* and removed after its file; the hub runs with HOME in its temp home and
// without the caller's DEEP_*, CLAUDE*, CODEX* and NODE_OPTIONS; every process is one this file started, stopped by
// its PID; nothing listens on a port and nothing leaves the machine. No model is called.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>;
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** The expected time of an MCP call with no history: waits.ts's KIND_EXPECTED_MS.mcp, read from the design's 1 min. */
export const MCP_EXPECTED_MS = 60_000;

// ---- Temp folders and processes, all gone after the file.
const made: string[] = [];
const started: ChildProcess[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1773-'));
  made.push(dir);
  return dir;
}
afterAll(async () => {
  for (const p of started) {
    if (p.exitCode !== null || p.signalCode !== null) continue;
    const gone = new Promise((done) => p.once('exit', done));
    p.kill('SIGTERM');
    await Promise.race([gone, sleep(60_000)]);
  }
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
}, 120_000);

/** The environment a child gets: HOME in the world, and none of the caller's DeepBuild, agent or Node options. */
function childEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(DEEP_|CLAUDE|CODEX|NODE_OPTIONS$)/.test(k)) env[k] = v;
  delete env.HTTPS_PROXY; delete env.https_proxy; delete env.ANTHROPIC_BASE_URL;
  return { ...env, HOME: home };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID stamped now, as deep-hook mints one per request. */
function ulid(): string {
  let time = '';
  for (let t = Date.now(), i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32]! + time;
  return time + [...randomBytes(16)].map((b) => CROCKFORD[b % 32]).join('');
}

export interface Hub { home: string; root: string; socket: string; output: () => string }
/** A real hub on a temp home; it stops (by its PID) after the file. */
export async function startHub(): Promise<Hub> {
  const home = tempDir();
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  let output = '';
  const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
  started.push(hub);
  hub.stderr!.on('data', (d) => { output += d; });
  let timer: NodeJS.Timeout | undefined;
  await new Promise((resolve, reject) => {
    hub.stdout!.once('data', resolve);
    hub.once('exit', () => reject(Error(`the hub exited before it was ready: ${output}`)));
    timer = setTimeout(() => reject(Error("the hub wasn't ready within 60 s")), 60_000);
  }).finally(() => clearTimeout(timer));
  hub.stdout!.on('data', (d) => { output += d; });
  return { home, root, socket: join(root, 'hub.sock'), output: () => output };
}

/** A process standing in for the agent: the hook lines name it as their parent, as deep-hook's do. */
export function agentProcess(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  started.push(child);
  return child.pid!;
}

/**
 * Sends one hook line the way deep-hook does (waits for the hello, writes the line) and returns the hub's reply, the
 * line after its acknowledgement, which a held hook sends once its hold ends.
 */
export function hook(hub: Hub, agent: string, event: string, payload: Obj, ppid: number): Promise<{ exit: number; stdout: string; stderr: string }> {
  const line = `${JSON.stringify({ v: 1, agent, event, seq: String(BigInt(Date.now()) * 1_000_000n), id: ulid(), pid: process.pid, ppid, matched: [], payload })}\n`;
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let got = '';
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${agent} ${event} within 30 s: ${got}`)); }, 30_000);
    sock.on('data', (d) => {
      got += d;
      const lines = got.split('\n');
      if (lines.length === 2) sock.write(line);
      if (lines.length > 3) { clearTimeout(timer); sock.destroy(); resolve(JSON.parse(lines[2]!) as { exit: number; stdout: string; stderr: string }); }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
/** The hook reply's JSON output, or {} when it printed nothing. */
export const out = (r: { stdout: string }): Obj => (r.stdout ? JSON.parse(r.stdout) as Obj : {});

/** A session of an agent: its hook lines, with the payload fields its agent sends. */
export interface Session {
  id: string; agent: string; cwd: string; ppid: number;
  send: (event: string, extra?: Obj) => Promise<{ exit: number; stdout: string; stderr: string }>;
}
/** A Claude Code session: its transcript where Claude Code keeps it, under ~/.claude/projects. */
export function claudeSession(hub: Hub, id: string): Session {
  const cwd = join(hub.home, 'work');
  const projects = join(hub.home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(cwd, { recursive: true });
  mkdirSync(projects, { recursive: true });
  const transcript = join(projects, `${id}.jsonl`);
  writeFileSync(transcript, '');
  const ppid = agentProcess();
  return {
    id, agent: 'claude-code', cwd, ppid,
    send: (event, extra = {}) => hook(hub, 'claude-code', event, { session_id: id, transcript_path: transcript, cwd, hook_event_name: event, ...extra }, ppid),
  };
}
/** A Codex session: its rollout where Codex keeps it, under ~/.codex/sessions, and a turn ID on each hook. */
export function codexSession(hub: Hub, id: string): Session {
  const cwd = join(hub.home, 'work');
  const sessions = join(hub.home, '.codex', 'sessions');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  const transcript = join(sessions, `rollout-2026-11-09T10-00-00-${id}.jsonl`);
  writeFileSync(transcript, `${JSON.stringify({ type: 'session_meta', payload: { id, cwd, cli_version: '0.160.0' } })}\n`);
  const ppid = agentProcess();
  const turn = '0199a0b0-0000-4000-8000-000000001773';
  return {
    id, agent: 'codex', cwd, ppid,
    send: (event, extra = {}) => hook(hub, 'codex', event, { session_id: id, transcript_path: transcript, cwd, hook_event_name: event, turn_id: turn, model: 'gpt-5', ...extra }, ppid),
  };
}

/** An MCP tool call's PreToolUse or PostToolUse fields. */
export const mcpCall = (tool: string, id: string, input: Obj, extra: Obj = {}): Obj => ({ tool_name: tool, tool_input: input, tool_use_id: id, permission_mode: 'default', ...extra });

// ---- The record, read back from the hub's ledger.
function query<T>(hub: Hub, sql: string, ...args: (string | number)[]): T[] {
  const db = new DatabaseSync(join(hub.root, 'ledger.db'), { readOnly: true });
  try { return db.prepare(sql).all(...args) as T[]; } finally { db.close(); }
}
/** The session's events of a kind, their data parsed. */
export const eventsOf = (hub: Hub, session: string, kind: string): Obj[] =>
  query<{ data: string }>(hub, 'SELECT data FROM events WHERE kind = ? AND session_id = ? ORDER BY log_pos', kind, session).map((r) => JSON.parse(r.data) as Obj);
/** The session's readings (the `session.reading` events, as its row shows them). */
export const readingsOf = (hub: Hub, session: string): string[] =>
  query<{ reading: string }>(hub, 'SELECT reading FROM session_readings WHERE session_id = ?', session).map((r) => r.reading);
/** Polls `probe` until it holds or `ms` pass. */
export async function until<T>(probe: () => T | undefined | false, ms: number): Promise<T | undefined> {
  for (const end = Date.now() + ms; ; await sleep(200)) {
    let got: T | undefined | false;
    try { got = probe(); } catch { got = undefined; }
    if (got) return got;
    if (Date.now() >= end) return undefined;
  }
}
/** The session's ticker, which the hub names in a Claude Code session's SessionStart reply (watchPaths). */
export const tickerOf = (hub: Hub, session: string) => join(hub.root, 'tickers', session.replace(/[^0-9A-Za-z]/g, ''));

// ---- A fixture home for `toolLists`: ~/.claude.json with stdio servers, each a copy of fixtures/server.mjs.
export interface Installed { name: string; dir: string; config: Obj }
/** A copy of the fixture server in `home`/`folder` as `file`, answering `tools`; started by `args` after the script. */
export function installServer(home: string, folder: string, file: string, name: string, tools: string[], args: string[] = []): Installed {
  const dir = join(home, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), readFileSync(join(FIXTURES, 'server.mjs')));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(dir, 'tools.json'), JSON.stringify({ name, version: '1.0.0', tools: tools.map((t) => ({ name: t, description: `${name} ${t}`, inputSchema: { type: 'object', properties: {} } })) }));
  return { name, dir, config: { type: 'stdio', command: process.execPath, args: [join(dir, file), ...args] } };
}
/** Whether anything ever started the server: the mark its start leaves. */
export const everStarted = (s: Installed) => existsSync(join(s.dir, 'started'));
/** Writes Claude Code's user config with these servers under `mcpServers`, by name. */
export function claudeJson(home: string, servers: Record<string, Obj>): void {
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: servers }, null, 2));
}
/** Runs `body` with HOME set to `home`, as the hub runs with yours; HOME is put back after. */
export async function withHome<T>(home: string, body: () => Promise<T>): Promise<T> {
  const was = process.env.HOME;
  process.env.HOME = home;
  try { return await body(); } finally { process.env.HOME = was; }
}
