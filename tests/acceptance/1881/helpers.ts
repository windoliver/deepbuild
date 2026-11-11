// Test-side tools for #1881 on the real hub (README): `deep hub run` in a temporary home, started with
// DEEP_HUB_TEST_FORGE naming a stand-in forge; Claude Code's hook lines on its socket and its transcript; the record
// read back; a real git checkout as the session's working folder. Copied from tests/acceptance/85/hub/helpers.ts (the
// shapes that suite drives the cut-off turn with), so a redraft of that suite never moves these tests. The stand-in
// forge is this suite's own: GitHub-shaped, it logs every request's method, path and query. Processes are stopped by
// PID only, and every port comes from the OS. Nothing leaves 127.0.0.1.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import net from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export type Obj = Record<string, any>;
const CLI = fileURLToPath(new URL('../../../packages/cli/dist/main.js', import.meta.url));
export const SECOND = 1000;

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

export interface Hub { home: string; root: string; socket: string; output: () => string }
/** Asks config as setup drafts it (as #85's suite writes it). */
const ASKS_CONFIG = { asks: {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'], fold: 5,
} };

/**
 * Runs `body` against `deep hub run` in a temporary home prepared by `prepare`, with `extra` in the hub's environment;
 * always stops the hub (by its PID) and removes the home. No forge token reaches the hub: GH_TOKEN and GITHUB_TOKEN are
 * dropped, and `gh auth token` is read only in your own home.
 */
export async function withHub(prepare: (home: string, root: string) => void, body: (hub: Hub) => Promise<void>, extra: Record<string, string> = {}): Promise<void> {
  const home = realpathSync(mkdtempSync('/tmp/blind1881-hub-'));
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(root, 'config.json'), JSON.stringify(ASKS_CONFIG));
  prepare(home, root);
  let output = '';
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', ...extra };
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ANTHROPIC_BASE_URL', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GH_CONFIG_DIR']) delete env[name];
  const child: ChildProcess = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr!.on('data', (d) => { output += d; });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGTERM'); });
  };
  try {
    let timer: NodeJS.Timeout | undefined;
    await new Promise((resolve, reject) => {
      child.stdout!.once('data', resolve);
      child.once('exit', () => reject(Error(`the hub exited before it was ready: ${output}`)));
      timer = setTimeout(() => reject(Error("the hub wasn't ready within 60 s")), 60_000);
    }).finally(() => clearTimeout(timer));
    child.stdout!.on('data', (d) => { output += d; });
    await body({ home, root, socket: join(root, 'hub.sock'), output: () => output });
  } finally {
    await stop();
    rmSync(home, { recursive: true, force: true });
  }
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
/** The waiter as Claude Code's Stop entry runs it: resolves with what wakes the session, or undefined when its connection ends. */
export function waiter(hub: Hub, session: string): { woken: Promise<Obj | undefined>; end: () => void } {
  let sock: net.Socket;
  const woken = new Promise<Obj | undefined>((resolve) => {
    sock = cliCall(hub, 'session.wait', { session, since: Date.now(), cwd: '/tmp' }, (l) => resolve((l.result ?? l.error) as Obj), () => resolve(undefined));
  });
  return { woken, end: () => sock.destroy() };
}

/** Events of the record, read while the hub runs. */
export interface Ev { id: string; kind: string; session: string | null; data: Obj }
export function events(hub: Hub, kind: string, session?: string): Ev[] {
  const db = new DatabaseSync(join(hub.root, 'ledger.db'), { readOnly: true });
  try {
    const where = session ? ' AND session_id = ?' : '';
    return (db.prepare(`SELECT id, kind, session_id, data FROM events WHERE kind = ?${where} ORDER BY log_pos`).all(...(session ? [kind, session] : [kind])) as { id: string; kind: string; session_id: string | null; data: string }[])
      .map((r) => ({ id: r.id, kind: r.kind, session: r.session_id, data: JSON.parse(r.data) as Obj }));
  } finally { db.close(); }
}

/** ~/.claude/settings.json with the given `env`. */
export function writeClaudeEnv(home: string, env: Record<string, string>): void {
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env }));
}

/** A real TCP listener: the host the session's API calls go to, reachable, so a dropped turn is the service's. */
export interface Listener { port: number; close: () => Promise<void> }
export function listen(): Promise<Listener> {
  return new Promise((resolve, reject) => {
    const open = new Set<net.Socket>();
    const server = net.createServer((sock) => { open.add(sock); sock.on('error', () => undefined); sock.on('close', () => open.delete(sock)); });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      port: (server.address() as net.AddressInfo).port,
      close: () => new Promise((done) => { for (const s of open) s.destroy(); server.close(() => done()); }),
    }));
  });
}

// ---- The session's working folder: a real git checkout.

/** git in `cwd` with a config of its own: no system or global config (HOME is the temporary home), no signing. */
export function git(home: string, cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Blind 1881', '-c', 'user.email=blind-1881@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args],
    { cwd, env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' });
}
/** A checkout in `home/<folder>`: one commit on main, then `branch` checked out; with `origin`, that remote. */
export function checkout(home: string, folder: string, branch: string, origin?: string): string {
  const dir = join(home, folder);
  mkdirSync(dir, { recursive: true });
  git(home, dir, 'init', '-q');
  writeFileSync(join(dir, 'cart.txt'), 'total = sum(items)\n');
  git(home, dir, 'add', 'cart.txt');
  git(home, dir, 'commit', '-q', '-m', 'cart');
  git(home, dir, 'checkout', '-q', '-b', branch);
  if (origin) git(home, dir, 'remote', 'add', 'origin', origin);
  return dir;
}

// ---- A Claude Code stand-in: hook lines as deep-hook writes them, the transcript as Claude Code writes it.

export interface Session { id: string; cwd: string; transcript: string; agent: number; prompt: number }
const agents = new Set<ChildProcess>();
export function endAgents(): void {
  for (const a of agents) a.kill('SIGTERM');
  agents.clear();
}
/** A session working in `cwd`; its agent is a process of this test's, stopped by PID. */
export function newSession(hub: Hub, cwd: string): Session {
  const id = randomUUID();
  const project = join(hub.home, '.claude', 'projects', cwd.replaceAll('/', '-'));
  mkdirSync(project, { recursive: true });
  const transcript = join(project, `${id}.jsonl`);
  writeFileSync(transcript, '');
  const agent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });
  agents.add(agent);
  return { id, cwd, transcript, agent: agent.pid!, prompt: 0 };
}
function line(s: Session, event: string, extra: Obj, at: number): string {
  return `${JSON.stringify({ v: 1, agent: 'claude-code', event, seq: String(BigInt(at) * 1_000_000n), id: ulidAt(at), pid: process.pid, ppid: s.agent, matched: [],
    payload: { session_id: s.id, cwd: s.cwd, transcript_path: s.transcript, hook_event_name: event, ...extra } })}\n`;
}
/** One hook line, read to the end: every line the hub answers with (its ack, then the hook's reply once any hold ends). */
function sendLineAll(socket: string, text: string): Promise<Obj[]> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buf = '';
    let helloed = false;
    const lines: Obj[] = [];
    sock.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
        const l = JSON.parse(buf.slice(0, i)) as Obj;
        if (!helloed) { helloed = true; sock.write(text); continue; }
        lines.push(l);
      }
    });
    sock.on('close', () => resolve(lines));
    sock.on('error', reject);
  });
}
/** One hook request stamped `at`, as deep-hook stamps it, read with its reply (hook.reply@2: exit, stdout, stderr). */
export async function hookReply(hub: Hub, s: Session, event: string, extra: Obj, at: number = Date.now()): Promise<Obj | undefined> {
  const lines = await sendLineAll(hub.socket, line(s, event, extra, at));
  if (!lines.some((l) => 'ack' in l)) throw Error(`the hub didn't acknowledge ${event}: ${JSON.stringify(lines)}`);
  return lines.find((l) => 'exit' in l);
}
export async function hook(hub: Hub, s: Session, event: string, extra: Obj, at: number = Date.now()): Promise<void> {
  await hookReply(hub, s, event, extra, at);
}
/** A prompt you typed, as the transcript and UserPromptSubmit carry it. */
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
/** A Stop of a turn, as Claude Code reports it, read with its reply. */
export const stopTurn = (hub: Hub, s: Session, promptId: string, lastMessage: string) => hookReply(hub, s, 'Stop', { prompt_id: promptId, stop_hook_active: false, last_assistant_message: lastMessage });
/** The stop Claude Code reports for every network failure. */
export const networkStop = (hub: Hub, s: Session, promptId: string) => hook(hub, s, 'StopFailure', { error: 'server_error', prompt_id: promptId });

let calls = 0;
const callId = () => `toolu_${Date.now().toString(36)}_${++calls}_${randomBytes(4).toString('hex')}`;
function toolUseEntry(s: Session, call: string, tool: string, input: Obj): void {
  appendFileSync(s.transcript, `${JSON.stringify({ type: 'assistant', uuid: randomUUID(), sessionId: s.id, message: { model: 'claude-haiku-5-5', id: `msg_${call.slice(-8)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: tool, input }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } })}\n`);
}
function toolResultEntry(s: Session, call: string, response: Obj): void {
  appendFileSync(s.transcript, `${JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId: s.id, promptId: `p${s.prompt}`, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response })}\n`);
}
/** A built-in tool call that ran to its end: tool_use, PreToolUse, tool_result, PostToolUse. */
export async function completedCall(hub: Hub, s: Session, tool: string, input: Obj, response: Obj): Promise<void> {
  const call = callId();
  toolUseEntry(s, call, tool, input);
  await hookReply(hub, s, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: call });
  toolResultEntry(s, call, response);
  await hook(hub, s, 'PostToolUse', { tool_name: tool, tool_input: input, tool_use_id: call, tool_response: response });
}
/** A call that started: tool_use and PreToolUse only. Returns the PreToolUse reply. */
export async function startedCall(hub: Hub, s: Session, tool: string, input: Obj): Promise<Obj | undefined> {
  const call = callId();
  toolUseEntry(s, call, tool, input);
  return hookReply(hub, s, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: call });
}
/** The turn the waiter's wake starts: a UserPromptSubmit whose prompt is the wake's text, not a prompt you typed. */
export async function wakeTurn(hub: Hub, s: Session, text: string): Promise<void> {
  const promptId = `p${++s.prompt}`;
  appendFileSync(s.transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, sessionId: s.id, isMeta: true, message: { role: 'user', content: text } })}\n`);
  await hook(hub, s, 'UserPromptSubmit', { prompt: text, prompt_id: promptId });
}

/** Whether a PreToolUse reply ends the call: exit 2, or Claude Code's `decision: block` / `permissionDecision: deny` on stdout. */
export function denies(reply: Obj | undefined): boolean {
  if (!reply) return false;
  if (Number(reply.exit) === 2) return true;
  try {
    const out = JSON.parse(String(reply.stdout ?? '')) as Obj;
    return out.decision === 'block' || out.hookSpecificOutput?.permissionDecision === 'deny';
  } catch { return false; }
}
/** The words a PreToolUse reply carries: stderr, a block's reason, a deny's reason, any context, and the chat's line. */
export function replyWords(reply: Obj | undefined): string {
  if (!reply) return '';
  let out: Obj = {};
  try { out = JSON.parse(String(reply.stdout ?? '')) as Obj; } catch { return [reply.stderr, reply.stdout].filter(Boolean).map(String).join('\n'); }
  return [reply.stderr, out.reason, out.hookSpecificOutput?.permissionDecisionReason, out.hookSpecificOutput?.additionalContext, out.systemMessage].filter(Boolean).map(String).join('\n');
}

// ---- The stand-in forge: a GitHub-shaped REST API that holds pull requests under one owner and name.

export interface ForgePull { number: number; title: string; body: string; html_url: string; state: 'open'; head: { ref: string; label: string }; base: { ref: string } }
/** One request the forge received: its method and its path with the query, as sent. */
export interface ForgeRequest { method: string; path: string; at: number }
export interface Forge {
  /** The REST root, given to the hub as DEEP_HUB_TEST_FORGE. */
  url: string; owner: string; repo: string; pulls: ForgePull[];
  /** Every request the forge received except the test's own `gh pr create` POST. */
  requests: ForgeRequest[];
  close: () => Promise<void>;
}
/** The header the test's `gh pr create` stand-in sends, so its POST is told apart from what the hub asks. */
const GH = 'x-blind1881-gh';
/**
 * The forge: `/repos/<owner>/<repo>/pulls` lists pull requests as GitHub does (its `state` and `head` filters: `head` is
 * `owner:branch`), POST opens one, `/pulls/<n>` reads one. Any other path is GitHub's 404. Every request is logged.
 */
export function startForge(owner: string, repo: string): Promise<Forge> {
  return new Promise((resolve, reject) => {
    const forge: Forge = { url: '', owner, repo, pulls: [], requests: [], close: async () => undefined };
    const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://forge');
        if (!req.headers[GH]) forge.requests.push({ method: req.method ?? '', path: req.url ?? '', at: Date.now() });
        const base = `/repos/${owner}/${repo}`;
        const rest = url.pathname.toLowerCase().startsWith(base.toLowerCase()) ? url.pathname.slice(base.length) : undefined;
        if (rest === '/pulls' && req.method === 'POST') {
          let input: Obj = {};
          try { input = JSON.parse(body) as Obj; } catch { /* an empty body opens an untitled PR */ }
          const number = forge.pulls.length + 1;
          const head = String(input.head ?? '');
          const pull: ForgePull = { number, title: String(input.title ?? ''), body: String(input.body ?? ''), html_url: `https://github.com/${owner}/${repo}/pull/${number}`, state: 'open',
            head: { ref: head, label: `${owner}:${head}` }, base: { ref: String(input.base ?? 'main') } };
          forge.pulls.push(pull);
          return json(res, 201, pull);
        }
        if (rest === '/pulls' && req.method === 'GET') {
          const state = url.searchParams.get('state') ?? 'open';
          const head = url.searchParams.get('head');
          const listed = forge.pulls.filter((p) => (state === 'all' || p.state === state)
            && (!head || (head.includes(':') ? p.head.label.toLowerCase() === head.toLowerCase() : p.head.ref === head)));
          return json(res, 200, listed);
        }
        const m = rest === undefined ? null : /^\/pulls\/(\d+)$/.exec(rest);
        const p = m ? forge.pulls.find((x) => x.number === Number(m[1])) : undefined;
        return p ? json(res, 200, p) : json(res, 404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' });
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      forge.url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
      forge.close = () => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); });
      resolve(forge);
    });
  });
}
/** What `gh pr create --title … --body …` does on `branch`: one POST to the forge's pulls; returns the PR's URL as `gh` prints it. */
export async function ghPrCreate(forge: Forge, command: string, branch: string): Promise<string> {
  const title = /--title\s+"([^"]*)"/.exec(command)?.[1] ?? '';
  const body = /--body\s+"([^"]*)"/.exec(command)?.[1] ?? '';
  const res = await fetch(`${forge.url}/repos/${forge.owner}/${forge.repo}/pulls`, { method: 'POST', headers: { 'content-type': 'application/json', [GH]: '1' }, body: JSON.stringify({ title, body, head: branch, base: 'main' }) });
  return ((await res.json()) as ForgePull).html_url;
}
/** The forge's request log as a failure message shows it. */
export const shown = (requests: ForgeRequest[]): string => (requests.length ? requests.map((r) => `${r.method} ${r.path}`).join(', ') : 'no request');
