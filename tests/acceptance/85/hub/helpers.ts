// Test-side tools for #85 on the real hub (README): `deep hub run` in a temporary home, Claude Code's hook lines on its
// socket, `deep mcp` for deep_ask, the record read back, a real TCP listener, and a real local HTTP server speaking
// conversations.replies, the one boundary faked. This suite keeps its own copies of the shapes in
// tests/acceptance/25/routes/helpers.ts and packages/hub/test/hub.ts, so a redraft of theirs never moves these tests.
// Processes are stopped by PID only, and every port comes from the OS.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import net from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export type Obj = Record<string, any>;
const CLI = fileURLToPath(new URL('../../../../packages/cli/dist/main.js', import.meta.url));
export const SECOND = 1000;
export const MINUTE = 60_000;
/** An obviously fake token, in slack.json's documented form: no real token looks like this. */
export const FAKE_TOKEN = 'xoxb-fake-not-a-real-token-for-issue-85';
export const YOU = 'U0YOU85';
export const BOT = 'U0BOT85';
export const CHANNEL = 'C0THREAD85';
export const THREAD_TS = '1700000000.000100';
export const LINK = `https://acme-85.slack.com/archives/${CHANNEL}/p1700000000000100`;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function until<T>(probe: () => T | undefined | false | Promise<T | undefined | false>, ms: number): Promise<T | undefined> {
  for (const end = Date.now() + ms; ; await sleep(100)) {
    const got = await probe();
    if (got) return got;
    if (Date.now() >= end) return undefined;
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID stamped `at`, as deep-hook mints one per request. */
function ulidAt(at: number): string {
  let time = '';
  for (let t = at, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32]! + time;
  return time + [...randomBytes(16)].map((b) => CROCKFORD[b % 32]).join('');
}

export interface Hub {
  home: string;
  root: string;
  socket: string;
  /** Everything the hub wrote to stdout and stderr. */
  output: () => string;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
}
/** Asks config as setup drafts it: an unblock task's deadline and default come from here. */
const ASKS_CONFIG = { asks: {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'], fold: 5,
} };

/** Runs `body` with `prepare`'s files in a temporary home, against a hub started on it; always stops it and removes the home. */
export async function withHub(prepare: (home: string, root: string) => void, body: (hub: Hub) => Promise<void>): Promise<void> {
  const home = realpathSync(mkdtempSync('/tmp/hub-85-'));
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(root, 'config.json'), JSON.stringify(ASKS_CONFIG));
  prepare(home, root);
  let child: ChildProcess | undefined;
  let output = '';
  const start = async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env.HTTPS_PROXY; delete env.https_proxy; delete env.ANTHROPIC_BASE_URL;
    const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child = hub;
    hub.stderr!.on('data', (d) => { output += d; });
    let timer: NodeJS.Timeout | undefined;
    await new Promise((resolve, reject) => {
      hub.stdout!.once('data', resolve);
      hub.once('exit', () => reject(Error(`the hub exited before it was ready: ${output}`)));
      timer = setTimeout(() => reject(Error("the hub wasn't ready within 60 s")), 60_000);
    }).finally(() => clearTimeout(timer));
    hub.stdout!.on('data', (d) => { output += d; });
  };
  const stop = async () => {
    const hub = child;
    if (!hub || hub.exitCode !== null || hub.signalCode !== null) return;
    await new Promise((resolve) => { hub.once('exit', resolve); hub.kill('SIGTERM'); });
  };
  try {
    await start();
    await body({ home, root, socket: join(root, 'hub.sock'), output: () => output, stop, restart: async () => { await stop(); await start(); } });
  } finally {
    await stop();
    rmSync(home, { recursive: true, force: true });
  }
}

/** Sends one hook line the way deep-hook does: waits for the hello, writes the line, reads the acknowledgement. */
function sendLine(socket: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let got = '';
    sock.on('data', (d) => {
      got += d;
      if (got.split('\n').length === 2) sock.write(line);
      if (got.split('\n').length > 2) { sock.destroy(); resolve(got.split('\n')[1]!); }
    });
    sock.on('error', reject);
  });
}

/** A connection with the hub's cli role that sends one request, `id` w1, once it's let in. */
function cliCall(hub: Hub, method: string, params: Obj, done: (reply: Obj) => void, failed: () => void): net.Socket {
  const sock = net.connect(hub.socket);
  let buf = '';
  let helloed = false;
  let sent = false;
  sock.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
      const l = JSON.parse(buf.slice(0, i)) as Obj;
      if (!helloed) { helloed = true; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() })}\n`); continue; }
      if (l.role && !sent) { sent = true; sock.write(`${JSON.stringify({ v: 1, id: 'w1', method, params })}\n`); continue; }
      if (l.id === 'w1') { sock.destroy(); done(l); }
    }
  });
  sock.on('error', failed);
  sock.on('close', failed);
  return sock;
}
/** One call on the hub's cli connection, with the control token. */
export function rpc(hub: Hub, method: string, params: Obj = {}): Promise<Obj> {
  return new Promise((resolve, reject) => {
    cliCall(hub, method, params, (l) => { if (l.error) reject(Error(JSON.stringify(l.error))); else resolve(l.result as Obj); }, () => reject(Error(`the connection ended during ${method}`)));
  });
}
/** The waiter as Claude Code's Stop entry runs it: resolves with what wakes the session, or undefined when its connection ends. */
export function waiter(hub: Hub, session: string): { woken: Promise<Obj | undefined>; end: () => void } {
  let sock: net.Socket;
  const woken = new Promise<Obj | undefined>((resolve) => {
    sock = cliCall(hub, 'session.wait', { session, since: Date.now(), cwd: '/tmp' }, (l) => resolve((l.result ?? l.error) as Obj), () => resolve(undefined));
  });
  return { woken, end: () => sock.destroy() };
}

/** Rows of the record, read while or after the hub runs. */
export function rows<T = Obj>(hub: Hub, sql: string, ...params: string[]): T[] {
  const db = new DatabaseSync(join(hub.root, 'ledger.db'), { readOnly: true });
  try { return db.prepare(sql).all(...params) as T[]; } finally { db.close(); }
}
export interface Ev { id: string; kind: string; session: string | null; subject: string | null; ts: number; data: Obj }
export function events(hub: Hub, kind: string, session?: string): Ev[] {
  const where = session ? ' AND session_id = ?' : '';
  return rows<{ id: string; kind: string; session_id: string | null; subject: string | null; ts: number; data: string }>(hub,
    `SELECT id, kind, session_id, subject, ts, data FROM events WHERE kind = ?${where} ORDER BY log_pos`, ...(session ? [kind, session] : [kind]))
    .map((r) => ({ id: r.id, kind: r.kind, session: r.session_id, subject: r.subject, ts: r.ts, data: JSON.parse(r.data) as Obj }));
}
export const stripHandle = (handle: unknown) => String(handle).replace(/^ask:/, '');
/** The asks that were raised as tasks only you can do. */
export const tasks = (hub: Hub) => events(hub, 'ask.created').filter((e) => e.data.kind === 'unblock');
/** What's open in Needs you, each row as `inbox.read` gives it. */
export const inbox = async (hub: Hub) => (await rpc(hub, 'inbox.read')).asks as Obj[];
/** The sessions' rows, as `sessions.read` gives them. */
export const sessionRows = async (hub: Hub) => (await rpc(hub, 'sessions.read')).sessions as Obj[];

/** A Claude Code stand-in: the process the hooks name as the agent, stopped by PID. */
export interface Session { id: string; cwd: string; transcript: string; agent: number; prompt: number }
const agents = new Set<ChildProcess>();
export function endAgents(): void {
  for (const a of agents) a.kill('SIGTERM');
  agents.clear();
}
export function newSession(hub: Hub, folder: string): Session {
  const id = randomUUID();
  const cwd = join(hub.home, folder);
  mkdirSync(cwd, { recursive: true });
  const project = join(hub.home, '.claude', 'projects', folder.replaceAll('/', '-'));
  mkdirSync(project, { recursive: true });
  const transcript = join(project, `${id}.jsonl`);
  writeFileSync(transcript, '');
  const agent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });
  agents.add(agent);
  return { id, cwd, transcript, agent: agent.pid!, prompt: 0 };
}
/** One hook request stamped `at`, as deep-hook stamps it. */
export async function hook(hub: Hub, s: Session, event: string, extra: Obj, at: number = Date.now()): Promise<void> {
  const line = { v: 1, agent: 'claude-code', event, seq: String(BigInt(at) * 1_000_000n), id: ulidAt(at), pid: process.pid, ppid: s.agent, matched: [],
    payload: { session_id: s.id, cwd: s.cwd, transcript_path: s.transcript, hook_event_name: event, ...extra } };
  const ack = await sendLine(hub.socket, `${JSON.stringify(line)}\n`);
  if (!ack.includes('"ack"')) throw Error(`the hub didn't acknowledge ${event}: ${ack}`);
}
export async function typedTurn(hub: Hub, s: Session, prompt: string, at: number = Date.now()): Promise<string> {
  const promptId = `p${++s.prompt}`;
  appendFileSync(s.transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, sessionId: s.id, message: { role: 'user', content: prompt }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
  await hook(hub, s, 'UserPromptSubmit', { prompt, prompt_id: promptId }, at);
  return promptId;
}
/** A session that began a turn you typed just before `at`. */
export async function begin(hub: Hub, s: Session, at: number = Date.now()): Promise<string> {
  await hook(hub, s, 'SessionStart', { source: 'startup' }, at - 2000);
  return typedTurn(hub, s, 'run the tests', at - 1000);
}
/** The stop Claude Code reports for every network failure. */
export const networkStop = (hub: Hub, s: Session, promptId: string, at: number = Date.now()) => hook(hub, s, 'StopFailure', { error: 'server_error', prompt_id: promptId }, at);
/** A session stopped by a network failure, its stop stamped `at`. */
export async function stoppedSession(hub: Hub, folder: string, at: number = Date.now()): Promise<Session> {
  const s = newSession(hub, folder);
  await networkStop(hub, s, await begin(hub, s, at), at);
  return s;
}
export const stopOf = (hub: Hub, s: Session, ms = 15_000): Promise<Ev | undefined> => until(() => events(hub, 'agent.stop', s.id).at(-1), ms);
export const continuedOf = (hub: Hub, s: Session) => events(hub, 'session.continued', s.id);

/** ~/.claude/settings.json with the given `env`. */
export function writeClaudeEnv(home: string, env: Record<string, string>): void {
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env }));
}

/** A port the OS gave and nothing listens on now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
  });
}
/** A real TCP listener that records when each connection came and every byte sent on one. */
export interface Listener { port: number; connections: number[]; bytes: () => number; close: () => Promise<void> }
export function listen(port = 0): Promise<Listener> {
  return new Promise((resolve, reject) => {
    const connections: number[] = [];
    const open = new Set<net.Socket>();
    let bytes = 0;
    const server = net.createServer((sock) => {
      connections.push(Date.now());
      open.add(sock);
      sock.on('data', (d) => { bytes += d.length; });
      sock.on('error', () => undefined);
      sock.on('close', () => open.delete(sock));
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      port: (server.address() as net.AddressInfo).port, connections, bytes: () => bytes,
      close: () => new Promise((done) => { for (const s of open) s.destroy(); server.close(() => done()); }),
    }));
  });
}

// ---- Slack, the one boundary faked.

export interface SlackMessage { user: string; text: string; ts: string; bot_id?: string; thread_ts?: string }
export interface SlackRequest { at: number; method: string; url: string; body: string; authorization: string | undefined; params: URLSearchParams }
export interface FakeSlack {
  api: string;
  requests: SlackRequest[];
  messages: SlackMessage[];
  /** Set, every read answers this instead of the thread. */
  failure: { status: number; body: string } | undefined;
  close: () => Promise<void>;
}
export function fakeSlack(): Promise<FakeSlack> {
  return new Promise((resolve, reject) => {
    const slack: FakeSlack = { api: '', requests: [], messages: [], failure: undefined, close: async () => undefined };
    const server: Server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://local');
        const params = new URLSearchParams(url.search);
        new URLSearchParams(body).forEach((v, k) => params.set(k, v));
        slack.requests.push({ at: Date.now(), method: url.pathname.split('/').filter(Boolean).at(-1) ?? '', url: req.url ?? '', body, authorization: req.headers.authorization, params });
        const answer = (status: number, text: string) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(text); };
        if (slack.failure) answer(slack.failure.status, slack.failure.body);
        else if (url.pathname.endsWith('/conversations.replies')) answer(200, JSON.stringify({ ok: true, messages: slack.messages, has_more: false }));
        else answer(200, JSON.stringify({ ok: false, error: 'unknown_method' }));
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      slack.api = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/api`;
      slack.close = () => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); });
      resolve(slack);
    });
  });
}
export function writeSlackJson(root: string, api: string, mode = 0o600): void {
  writeFileSync(join(root, 'slack.json'), JSON.stringify({ token: FAKE_TOKEN, you: YOU, api }), { mode });
}

// ---- deep_ask, through a real `deep mcp`.

export type Raised = { refused: true; text: string } | { refused: false; handle: string };
export interface Agent { session: Session; ask: (thread: { link: string; expect: string }) => Promise<Raised>; close: () => void }
/** A session, with `deep mcp` a child of this process as the session's agent, so its deep_ask binds to it. */
export async function askingAgent(hub: Hub): Promise<Agent> {
  const session = newSession(hub, 'work');
  session.agent = process.pid;
  await begin(hub, session);
  const child = spawn(process.execPath, [CLI, 'mcp'], { cwd: session.cwd, env: { ...process.env, HOME: hub.home }, stdio: ['pipe', 'pipe', 'ignore'] });
  const waiting = new Map<number, (m: Obj) => void>();
  createInterface({ input: child.stdout! }).on('line', (raw) => { const m = JSON.parse(raw) as Obj; waiting.get(m.id)?.(m); waiting.delete(m.id); });
  let ids = 0;
  const request = (method: string, params: Obj) => new Promise<Obj>((resolve) => { const id = ++ids; waiting.set(id, resolve); child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  let calls = 0;
  return {
    session,
    close: () => { child.kill('SIGTERM'); },
    async ask(thread) {
      const args = {
        kind: 'unblock', question: `Post the test question to the bot (${++calls}).`, options: null, recommended: null,
        steps: ['Post the test question in the thread.'], where: 'Your Slack workspace', why: 'It proves the bot replies.', check: null, subject: null, thread,
      };
      const before = tasks(hub).length;
      await hook(hub, session, 'PreToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: `toolu_${randomBytes(8).toString('hex')}` });
      // deep_ask holds its call while it waits for the answer, so a raise shows in the record and a refusal as the reply.
      let reply: Obj | undefined;
      void request('tools/call', { name: 'deep_ask', arguments: args }).then((r) => { reply = r; });
      const refused = () => reply?.result?.isError === true || reply?.error !== undefined;
      await until(() => refused() || tasks(hub)[before], 15_000);
      if (refused() || !tasks(hub)[before]) return { refused: true, text: JSON.stringify(reply ?? 'no reply and no task within 15 s') };
      return { refused: false, handle: `ask:${tasks(hub)[before]!.id}` };
    },
  };
}

/** Every file under `dir` holding `needle`, slack.json excepted. */
export function filesHolding(dir: string, needle: string): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      let st;
      try { st = statSync(path); } catch { continue; }
      if (st.isDirectory()) walk(path);
      else if (st.isFile() && name !== 'slack.json' && readFileSync(path).includes(needle)) found.push(path);
    }
  };
  walk(dir);
  return found;
}
