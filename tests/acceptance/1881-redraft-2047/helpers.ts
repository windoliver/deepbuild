// Test-side tools for the blind redraft of #1881 (README): `deep hub run` in a temporary home, started with
// DEEP_HUB_TEST_FORGE naming a stand-in forge; Claude Code's hook lines on the hub's socket and its transcript; the record
// read back; a real git checkout as the session's working folder; and a run of #85's suites through the checkout's own
// vitest. The hook-line and transcript shapes are #85's (tests/acceptance/85/hub/helpers.ts), copied so a change there
// never moves these tests. Processes are stopped by PID, every port comes from the OS, and nothing leaves 127.0.0.1.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export type Obj = Record<string, any>;
/** The checkout root (this folder is three levels down). */
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI = join(REPO, 'packages', 'cli', 'dist', 'main.js');

/** Each criterion's ID: `#1881.` and the first 8 hex digits of SHA-256 of its trimmed, whitespace-collapsed text. */
export const AC1 = '#1881.6ee547f4';
export const AC2 = '#1881.5d46b7e2';
export const AC3 = '#1881.e56f5a3e';

/** `promise`, or `undefined` once `ms` has passed. */
export function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  // deadline: bounds a wait on an event (a hub's reply or the waiter's wake); it never paces the test.
  const late = new Promise<undefined>((done) => { timer = setTimeout(() => done(undefined), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID stamped `at`, as deep-hook mints one per request. */
function ulidAt(at: number): string {
  let time = '';
  for (let t = at, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32]! + time;
  return time + [...randomBytes(16)].map((b) => CROCKFORD[b % 32]).join('');
}

// ---- The hub.

export interface Hub { home: string; root: string; socket: string }
/** Asks config as setup drafts it (as #85's suite writes it). */
const ASKS_CONFIG = { asks: {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'], fold: 5,
} };

/**
 * Runs `body` against `deep hub run` in a temporary home, with `extra` in the hub's environment and ~/.claude/settings.json
 * holding `claudeEnv`; always stops the hub (by its PID) and removes the home. No forge token reaches the hub.
 */
export async function withHub(claudeEnv: Record<string, string>, extra: Record<string, string>, body: (hub: Hub) => Promise<void>): Promise<void> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'blind1881r-')));
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(root, 'config.json'), JSON.stringify(ASKS_CONFIG));
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: claudeEnv }));
  let output = '';
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', ...extra };
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ANTHROPIC_BASE_URL', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GH_CONFIG_DIR']) delete env[name];
  const child: ChildProcess = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr!.on('data', (d) => { output += d; });
  try {
    const ready = new Promise<boolean>((resolve) => { child.stdout!.once('data', () => resolve(true)); child.once('exit', () => resolve(false)); });
    const up = await within(ready, 60_000);
    if (!up) throw Error(`precondition: the hub was ready within 60 s; its output: ${output}`);
    await body({ home, root, socket: join(root, 'hub.sock') });
  } finally {
    if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGTERM'); });
    rmSync(home, { recursive: true, force: true });
  }
}

/** The waiter as Claude Code's Stop entry runs it (`session.wait` on a cli connection): `sent` once its request is written, `woken` with what wakes the session. */
export function waiter(hub: Hub, session: string): { sent: Promise<void>; woken: Promise<Obj | undefined>; end: () => void } {
  const sock = net.connect(hub.socket);
  let buf = '';
  let helloed = false;
  let asked = false;
  let markSent: () => void = () => undefined;
  const sent = new Promise<void>((resolve) => { markSent = resolve; });
  const woken = new Promise<Obj | undefined>((resolve) => {
    sock.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
        const l = JSON.parse(buf.slice(0, i)) as Obj;
        if (!helloed) { helloed = true; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() })}\n`); continue; }
        if (l.role && !asked) { asked = true; sock.write(`${JSON.stringify({ v: 1, id: 'w1', method: 'session.wait', params: { session, since: Date.now(), cwd: tmpdir() } })}\n`, () => markSent()); continue; }
        if (l.id === 'w1') { sock.destroy(); resolve((l.result ?? l.error) as Obj); }
      }
    });
    sock.on('error', () => resolve(undefined));
    sock.on('close', () => resolve(undefined));
  });
  return { sent, woken, end: () => sock.destroy() };
}

/** Events of one kind for one session in the hub's record. */
export function events(hub: Hub, kind: string, session: string): Obj[] {
  const db = new DatabaseSync(join(hub.root, 'ledger.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT data FROM events WHERE kind = ? AND session_id = ? ORDER BY log_pos').all(kind, session) as { data: string }[]).map((r) => JSON.parse(r.data) as Obj);
  } finally { db.close(); }
}

/** A TCP listener: the host the session's API calls go to, reachable, so a dropped turn is the service's. */
export function listen(): Promise<{ port: number; close: () => Promise<void> }> {
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

/** A checkout in `home/<folder>`: one commit on main, then `branch` checked out; with `origin`, that remote, else none. */
export function checkout(home: string, folder: string, branch: string, origin: string | undefined): string {
  const dir = join(home, folder);
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Blind 1881', '-c', 'user.email=blind-1881@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args],
    { cwd: dir, env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(join(dir, 'cart.txt'), 'total = sum(items)\n');
  git('add', 'cart.txt');
  git('commit', '-q', '-m', 'cart');
  git('checkout', '-q', '-b', branch);
  if (origin) git('remote', 'add', 'origin', origin);
  expect(git('remote').trim(), 'precondition: the checkout has the remotes the test gives it').toBe(origin ? 'origin' : '');
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
/** One hook request stamped `at`, read to the end: the hub's ack, then the hook's reply (hook.reply@2: exit, stdout, stderr). */
export function hookReply(hub: Hub, s: Session, event: string, extra: Obj, at: number = Date.now()): Promise<Obj | undefined> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buf = '';
    let helloed = false;
    const lines: Obj[] = [];
    sock.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
        const l = JSON.parse(buf.slice(0, i)) as Obj;
        if (!helloed) { helloed = true; sock.write(line(s, event, extra, at)); continue; }
        lines.push(l);
      }
    });
    sock.on('close', () => (lines.some((l) => 'ack' in l) ? resolve(lines.find((l) => 'exit' in l)) : reject(Error(`the hub didn't acknowledge ${event}: ${JSON.stringify(lines)}`))));
    sock.on('error', reject);
  });
}
/** A prompt you typed, as the transcript and UserPromptSubmit carry it. */
export async function typedTurn(hub: Hub, s: Session, prompt: string, at: number = Date.now()): Promise<string> {
  const promptId = `p${++s.prompt}`;
  appendFileSync(s.transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, sessionId: s.id, message: { role: 'user', content: prompt }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
  await hookReply(hub, s, 'UserPromptSubmit', { prompt, prompt_id: promptId }, at);
  return promptId;
}
/** SessionStart and a turn you typed, stamped two and one seconds before now, so the waiter that follows starts after them. */
export async function begin(hub: Hub, s: Session): Promise<string> {
  const at = Date.now();
  await hookReply(hub, s, 'SessionStart', { source: 'startup' }, at - 2000);
  return typedTurn(hub, s, 'run the tests', at - 1000);
}
/** A Stop of a turn, as Claude Code reports it. */
export const stopTurn = (hub: Hub, s: Session, promptId: string, last: string) => hookReply(hub, s, 'Stop', { prompt_id: promptId, stop_hook_active: false, last_assistant_message: last });
/** The stop Claude Code reports when a turn's connection drops. */
export const networkStop = (hub: Hub, s: Session, promptId: string) => hookReply(hub, s, 'StopFailure', { error: 'server_error', prompt_id: promptId });

let calls = 0;
const callId = () => `toolu_${Date.now().toString(36)}_${++calls}_${randomBytes(4).toString('hex')}`;
function toolUseEntry(s: Session, call: string, tool: string, input: Obj): void {
  appendFileSync(s.transcript, `${JSON.stringify({ type: 'assistant', uuid: randomUUID(), sessionId: s.id, message: { model: 'claude-haiku-5-5', id: `msg_${call.slice(-8)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: tool, input }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } })}\n`);
}
/** A built-in tool call that ran to its end: tool_use, PreToolUse, tool_result, PostToolUse. */
export async function completedCall(hub: Hub, s: Session, tool: string, input: Obj, response: Obj): Promise<void> {
  const call = callId();
  toolUseEntry(s, call, tool, input);
  await hookReply(hub, s, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: call });
  appendFileSync(s.transcript, `${JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId: s.id, promptId: `p${s.prompt}`, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response })}\n`);
  await hookReply(hub, s, 'PostToolUse', { tool_name: tool, tool_input: input, tool_use_id: call, tool_response: response });
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
  await hookReply(hub, s, 'UserPromptSubmit', { prompt: text, prompt_id: promptId });
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

// ---- The stand-in forge: GitHub-shaped, holding pull requests under one owner and name, logging what the hub asks.

export interface ForgePull { number: number; html_url: string; state: 'open'; head: { ref: string; label: string } }
export interface Forge { url: string; owner: string; repo: string; pulls: ForgePull[]; requests: string[]; close: () => Promise<void> }
/** The header the test's own `gh pr create` POST carries, so the log holds only what the hub asked. */
const GH = 'x-blind1881-gh';
/**
 * `GET /repos/<owner>/<repo>/pulls` lists its pull requests with GitHub's `state` and `head` (`owner:branch`) filters,
 * `POST` opens one, `/pulls/<n>` reads one; any other path is GitHub's 404. Every request is logged as `METHOD path?query`.
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
        if (!req.headers[GH]) forge.requests.push(`${req.method} ${req.url}`);
        const base = `/repos/${owner}/${repo}`;
        const rest = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : undefined;
        if (rest === '/pulls' && req.method === 'POST') {
          const head = String((JSON.parse(body || '{}') as Obj).head ?? '');
          const pull: ForgePull = { number: forge.pulls.length + 1, html_url: `https://github.com/${owner}/${repo}/pull/${forge.pulls.length + 1}`, state: 'open', head: { ref: head, label: `${owner}:${head}` } };
          forge.pulls.push(pull);
          return json(res, 201, pull);
        }
        if (rest === '/pulls' && req.method === 'GET') {
          const state = url.searchParams.get('state') ?? 'open';
          const head = url.searchParams.get('head');
          return json(res, 200, forge.pulls.filter((p) => (state === 'all' || p.state === state) && (!head || (head.includes(':') ? p.head.label === head : p.head.ref === head))));
        }
        const m = rest === undefined ? null : /^\/pulls\/(\d+)$/.exec(rest);
        const p = m ? forge.pulls.find((x) => x.number === Number(m[1])) : undefined;
        return p ? json(res, 200, p) : json(res, 404, { message: 'Not Found' });
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
/** What `gh pr create` does on `branch`: one POST to the forge's pulls. Returns the PR's URL as gh prints it. */
export async function ghPrCreate(forge: Forge, branch: string): Promise<string> {
  const res = await fetch(`${forge.url}/repos/${forge.owner}/${forge.repo}/pulls`, { method: 'POST', headers: { 'content-type': 'application/json', [GH]: '1' }, body: JSON.stringify({ title: 'Fix the cart total', head: branch, base: 'main' }) });
  return ((await res.json()) as ForgePull).html_url;
}

// ---- #85's suites, run as they are.

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** Files whose bytes differ from `pins` (path from the checkout root → SHA-256 at the base). */
export function changed(pins: Record<string, string>): string[] {
  return Object.entries(pins).flatMap(([path, want]) => {
    const file = join(REPO, path);
    if (!existsSync(file)) return [`${path} is gone; the base holds it (SHA-256 ${want})`];
    const got = sha256(readFileSync(file));
    return got === want ? [] : [`${path} changed: SHA-256 ${got}, the base's ${want}`];
  });
}
export interface Ran { file: string; name: string; status: string; message: string }
export interface SuiteRun { tests: Ran[]; fileErrors: string[]; missing: string[]; seconds: number }
/**
 * Runs the tests of `files` (paths from the checkout root) whose names match `namePattern` with the checkout's own
 * vitest, one file at a time, with `testTimeout`, in an environment without this run's vitest variables. Each test's
 * status and first failure lines come from vitest's JSON report; a test the pattern leaves out reports as skipped.
 */
export function runSuites(files: readonly string[], testTimeout: number, namePattern: string): SuiteRun {
  const dir = mkdtempSync(join(tmpdir(), 'blind1881r-suites-'));
  try {
    const report = join(dir, 'report.json');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'DEEP_PROOF_VITEST_REPORT')) as NodeJS.ProcessEnv;
    const started = Date.now();
    const run = spawnSync(process.execPath, [join(REPO, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--no-file-parallelism', `--testTimeout=${testTimeout}`, `--testNamePattern=${namePattern}`, '--reporter=json', `--outputFile.json=${report}`, ...files], {
      cwd: REPO, env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 3_600_000, killSignal: 'SIGKILL',
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    expect(run.error === undefined, `vitest on #85's suites finished within an hour: ${run.error?.message ?? ''}`).toBe(true);
    expect(existsSync(report), `vitest on #85's suites wrote its JSON report (exit ${run.status}); its output ends:\n${(run.stdout ?? '').slice(-2000)}\n${(run.stderr ?? '').slice(-2000)}`).toBe(true);
    const json = JSON.parse(readFileSync(report, 'utf8')) as { testResults?: { name: string; status: string; message?: string; assertionResults?: { ancestorTitles: string[]; title: string; status: string; failureMessages?: string[] }[] }[] };
    const tests: Ran[] = []; const fileErrors: string[] = []; const seen = new Set<string>();
    for (const f of json.testResults ?? []) {
      const file = relative(realpathSync(REPO), realpathSync(f.name));
      seen.add(file);
      const results = f.assertionResults ?? [];
      if (f.status === 'failed' && !results.some((t) => t.status === 'failed')) fileErrors.push(`${file} failed outside its tests: ${(f.message ?? '').split('\n')[0]}`);
      for (const t of results) tests.push({ file, name: [...t.ancestorTitles, t.title].join(' › '), status: t.status, message: (t.failureMessages?.[0] ?? '').split('\n').filter(Boolean).slice(0, 3).join(' / ') });
    }
    return { tests, fileErrors, missing: files.filter((f) => !seen.has(f)), seconds };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
