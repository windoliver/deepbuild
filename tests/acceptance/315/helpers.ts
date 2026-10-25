// Shared test-side tools for the issue #315 acceptance tests: temp homes, deep-hook as an agent's hook entry runs
// it, the hub as a process, the socket's line protocol, the test hubs, the spool as files, rules.json, and the
// timing judge. Parts are adapted from tests/acceptance/16/helpers.ts (same repo, same license); this suite keeps
// its own copy so a redraft of #16's suite never moves these tests. Nothing here stands in for deep-hook or the
// hub: every test reaches them through the binary, `deep hub run`, the socket and the files under the root.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEEP_HOOK_RELEASE = join(REPO, 'target/release/deep-hook');
export const SECOND = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
export const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh315-'));
  made.push(dir);
  return dir;
}
/** A fresh home folder; the installed hub's root, deep-hook's spool and rules.json live in <home>/.deepbuild. */
export function makeHome(): string {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  return home;
}
export const rootOf = (home: string) => join(home, '.deepbuild');

// ---- Processes this suite started. Stopped by PID only, never by name or port.
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
/** Stops every process this suite started (SIGCONT and SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) {
    if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's (README, Privacy of the run). */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: this one with HOME moved to the test's home and no DEEP_ settings or billing keys of its own. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs a command to its end without blocking this process's event loop (a forwarder may live here). */
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
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
/**
 * Runs a command and times it from the spawn to its exit, blocking this process: no forwarder or test hub may live
 * in this process while it runs (the test hubs are processes of their own, fixtures/test-hub.mjs).
 */
export function runTimed(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; input: string; timeoutMs: number }): Ran {
  const t0 = performance.now();
  const r = spawnSync(command, args, { cwd: o.cwd, env: o.env, input: o.input, encoding: 'utf8', timeout: o.timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - t0;
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  return { code: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms, timedOut };
}
/** `deep <args>` from the built CLI. */
export function deep(home: string, args: readonly string[], o: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(home, o.env), timeoutMs: o.timeoutMs ?? 60_000 });
}

// ---- deep-hook builds: the plain one, the release one and each planted twin (README, Wrong programs).
const builds = new Map<string, Promise<string>>();
/**
 * Builds deep-hook once per test process and returns the binary's path. `features` builds a planted twin into a
 * target folder of its own, target/<features joined by +>/debug/deep-hook (target/plant-f-test is #16's AC23
 * build's folder too); `release` builds target/release.
 */
export function buildDeepHook(o: { features?: string[]; release?: boolean } = {}): Promise<string> {
  const features = o.features ?? [];
  const key = `${features.join('+')}|${o.release ? 'release' : 'debug'}`;
  let made = builds.get(key);
  if (!made) {
    const args = ['build', '--locked', '-q', '-p', 'deep-hook', ...(o.release ? ['--release'] : [])];
    let binary = o.release ? DEEP_HOOK_RELEASE : DEEP_HOOK;
    if (features.length) {
      const dir = join(REPO, 'target', features.join('+'));
      args.push('--features', features.join(','), '--target-dir', dir);
      binary = join(dir, o.release ? 'release' : 'debug', 'deep-hook');
    }
    made = run('cargo', args, { timeoutMs: 900_000 }).then((r) => {
      if (r.code !== 0) throw Error(`BLOCKED: cargo ${args.join(' ')} failed: ${r.stderr.slice(-3000)}`);
      if (!existsSync(binary)) throw Error(`BLOCKED: no binary at ${binary} after cargo ${args.join(' ')}`);
      // The first exec of a new binary is slow on macOS (it is checked before it runs); no timed call pays for it.
      spawnSync(binary, ['--version'], { stdio: 'ignore', timeout: 30_000 });
      return binary;
    });
    builds.set(key, made);
  }
  return made;
}

// ---- Sessions and their hook JSON, shaped like the corpus's Claude Code payloads (adapters/corpus/claude-code).
export interface Session { agent: 'claude-code'; id: string; cwd: string; transcript: string }
export function newSession(home: string): Session {
  const id = randomUUID();
  const cwd = join(tempDir(), 'work');
  mkdirSync(cwd, { recursive: true });
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { agent: 'claude-code', id, cwd, transcript };
}
let calls = 0;
/** A unique tool_use_id: how a test finds its call's request in the spool and on the wire. */
export const callId = () => `toolu_${randomBytes(12).toString('hex')}_${++calls}`;
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  switch (event) {
    case 'SessionStart': Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); break;
    case 'UserPromptSubmit': Object.assign(base, { prompt: 'run the tests', prompt_id: randomUUID() }); break;
    case 'PreToolUse': Object.assign(base, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: callId() }); break;
    case 'PostToolUse': Object.assign(base, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: '', stderr: '', interrupted: false }, tool_use_id: callId() }); break;
    case 'Stop': Object.assign(base, { stop_hook_active: false }); break;
    case 'SessionEnd': Object.assign(base, { reason: 'other' }); break;
    default: break;
  }
  return { ...base, ...extra };
}
/** A PreToolUse for a Bash command, with a fresh tool_use_id. */
export const bash = (s: Session, command: string, extra: Line = {}): Line => payload(s, 'PreToolUse', { tool_input: { command }, tool_use_id: callId(), ...extra });

export interface HookRun { binary?: string; env?: Record<string, string | undefined>; timeoutMs?: number }
/** deep-hook as an agent's hook entry runs it: `deep-hook claude-code <event>`, the hook JSON on stdin, HOME the agent's. */
export function hook(home: string, s: Session, event: string, body: Line, o: HookRun = {}): Promise<Ran> {
  return run(o.binary ?? DEEP_HOOK, ['claude-code', event], { cwd: s.cwd, env: childEnv(home, o.env), input: JSON.stringify(body), timeoutMs: o.timeoutMs ?? 30_000 });
}
/** The same, timed from spawn to exit with this process blocked (runTimed). */
export function hookTimed(home: string, s: Session, event: string, body: Line, o: HookRun = {}): Ran {
  return runTimed(o.binary ?? DEEP_HOOK, ['claude-code', event], { cwd: s.cwd, env: childEnv(home, o.env), input: JSON.stringify(body), timeoutMs: o.timeoutMs ?? 30_000 });
}

/** What deep-hook's output tells Claude Code about a PreToolUse: exit 2 or a deny decision denies; exit 0 otherwise allows. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(1)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 300))}, stderr ${JSON.stringify(r.stderr.slice(0, 300))}`;

// ---- rules.json (README, rules.json).
export interface Guard { match: string; scope: string; mode: 'watch' | 'warn' | 'block'; reason: string; next_step: string; fail_closed: boolean }
/**
 * The entries these tests install: one fail_closed entry that matches `pkill -f node`, and one block entry that
 * matches `ls` but isn't fail_closed, so with the hub away only the first applies.
 */
export const RULES: Record<string, Guard> = {
  'no-kill-by-name': { match: 'shell:pkill *', scope: 'all_repos', mode: 'block', reason: 'Never kill processes by name.', next_step: 'Stop the process by its PID.', fail_closed: true },
  'listing-noted': { match: 'shell:ls*', scope: 'all_repos', mode: 'block', reason: 'Listing is noted by the hub.', next_step: 'Nothing to do.', fail_closed: false },
};
/** The entries each command matches, by name. */
export const MATCHED: Record<string, string[]> = { ls: ['listing-noted'], 'pkill -f node': ['no-kill-by-name'], 'git push origin main': [] };
export function writeRules(home: string, entries: Record<string, Guard> = RULES): void {
  mkdirSync(rootOf(home), { recursive: true });
  writeFileSync(join(rootOf(home), 'rules.json'), `${JSON.stringify({ v: 1, entries }, null, 2)}\n`);
}

// ---- The address setting: <home>/.deepbuild/config.json, `{"hub": {"address": "unix:<path>"}}` (#16).
export function setAddress(home: string, address: string | undefined): void {
  const file = join(rootOf(home), 'config.json');
  mkdirSync(dirname(file), { recursive: true });
  const config = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Line) : {};
  if (address === undefined) delete config.hub;
  else config.hub = { ...(config.hub as Line | undefined), address };
  writeFileSync(file, `${JSON.stringify(config)}\n`);
}

// ---- The hub as a process: `deep hub run [--root <folder>]` (#16).
export interface Ready { v: number; ready: true; pid: number; socket: string; start: string }
export interface HubOptions { home: string; root?: string; plant?: string; vfs?: Record<string, unknown>; env?: Record<string, string | undefined> }
export interface HubProc { child: ChildProcess; pid: number; stdout(): string; stderr(): string; ready: Promise<Ready | undefined>; exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> }
export interface Hub extends Ready { home: string; root: string; proc: HubProc }
export function spawnHub(o: HubOptions): HubProc {
  const env = childEnv(o.home, { DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_VFS: o.vfs && JSON.stringify(o.vfs), ...o.env });
  const child = spawn(NODE, [CLI, 'hub', 'run', ...(o.root ? ['--root', o.root] : [])], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let err = '';
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise<Ready | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      const first = out.split('\n')[0];
      if (out.includes('\n') && first !== undefined) {
        const line = parseObject(first);
        resolve(line && line.ready === true ? (line as Ready) : undefined);
      }
    });
    void exit.then(() => resolve(undefined));
  });
  return { child, pid: child.pid!, stdout: () => out, stderr: () => err, ready, exit };
}
export async function startHub(o: HubOptions, timeoutMs = 30_000): Promise<Hub> {
  const proc = spawnHub(o);
  const r = await Promise.race([proc.ready, proc.exit.then(() => undefined), sleep(timeoutMs).then(() => undefined)]);
  if (!r) {
    throw Error(`BLOCKED: the hub didn't start (deep hub run${o.root ? ` --root ${o.root}` : ''}${o.plant ? `, DEEP_HUB_PLANT=${o.plant}` : ''}): stderr: ${proc.stderr().slice(0, 2000)}`);
  }
  return { ...r, home: o.home, root: o.root ?? rootOf(o.home), proc };
}
export async function stopHub(hub: { pid: number; proc?: HubProc }, signal: NodeJS.Signals = 'SIGTERM', timeoutMs = 15_000): Promise<void> {
  try { process.kill(hub.pid, 'SIGCONT'); } catch { /* gone */ }
  try { process.kill(hub.pid, signal); } catch { return; }
  const deadline = Date.now() + timeoutMs;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  if (hub.proc) await hub.proc.exit;
}

// ---- The line protocol (#16): a client for app and cli connections.
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
    sock.on('error', () => { this.ended = true; for (const w of [...this.wakers]) w(); });
    sock.on('close', () => { this.ended = true; for (const w of [...this.wakers]) w(); });
  }
  static open(path: string, timeoutMs = 5000): Promise<Conn> {
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
  async hello(role: 'cli', token: string): Promise<void> {
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, hello: role, token })}\n`);
    const reply = await this.wait((l) => 'role' in l || 'error' in l, from, 10_000);
    if (!reply || reply.role !== role) throw Error(`BLOCKED: the hub refused the ${role} hello: ${JSON.stringify(reply)}`);
  }
  async call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await this.wait((l) => l.id === id && ('result' in l || 'error' in l), from, timeoutMs);
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  close(): void { this.sock.destroy(); }
}
export async function control(hub: { socket: string; root: string }): Promise<Conn> {
  const conn = await Conn.open(hub.socket);
  await conn.hello('cli', readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
  return conn;
}
export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; seq?: string; subject?: string; session?: string; data: Line; evidence: string[]; verified?: boolean }
/** Every event in the log, paged by log_pos through `events.read`. */
export async function allEvents(hub: { socket: string; root: string }): Promise<Ev[]> {
  const conn = await control(hub);
  try {
    const out: Ev[] = [];
    let after = 0;
    for (;;) {
      const events = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos;
    }
  } finally {
    conn.close();
  }
}
/** Polls the log until `done` holds, or until it stops changing for `quietMs`; resolves with the last read. */
export async function settleEvents(hub: { socket: string; root: string }, done: (events: Ev[]) => boolean, o: { timeoutMs?: number; quietMs?: number } = {}): Promise<Ev[]> {
  const deadline = Date.now() + (o.timeoutMs ?? 60_000);
  let last: Ev[] = [];
  let since = Date.now();
  for (;;) {
    const events = await allEvents(hub);
    if (done(events)) return events;
    if (events.length !== last.length) { last = events; since = Date.now(); }
    if (Date.now() - since > (o.quietMs ?? 8000) || Date.now() > deadline) return events;
    await sleep(250);
  }
}
/** Polls until probe gives a value, or fails naming what it waited for. */
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(50);
  }
}
/** A setup shared by a file's tests, made by the first test that needs it. */
export function shared<T>(make: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined;
  return () => (value ??= make());
}

// ---- A forwarded socket that keeps a copy of the bytes both ways (#16's forwarder).
export interface Forwarder { path: string; upText(): string; downText(): string; close(): Promise<void> }
export function forwarder(dir: string, target: string): Promise<Forwarder> {
  const path = join(dir, `fwd-${randomBytes(3).toString('hex')}.sock`);
  const up: Buffer[] = [];
  const down: Buffer[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(target);
    sockets.add(client); sockets.add(upstream);
    client.on('data', (d: Buffer) => up.push(d));
    upstream.on('data', (d: Buffer) => down.push(d));
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.end());
    upstream.on('close', () => client.end());
  });
  const f: Forwarder = {
    path,
    upText: () => Buffer.concat(up).toString('utf8'),
    downText: () => Buffer.concat(down).toString('utf8'),
    close: () => new Promise((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, () => resolve(f)); });
}
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });

// ---- The test hubs (fixtures/test-hub.mjs), each a process of its own.
export type TestHubMode = 'accepts-never-reads' | 'reads-never-replies' | 'garbled-reply' | 'held-push';
export interface TestHub { mode: TestHubMode; socket: string; log: string; pid: number; requests(): Line[]; written(): string[]; stop(): Promise<void> }
export async function startTestHub(mode: TestHubMode, nonce = ''): Promise<TestHub> {
  const dir = tempDir();
  const socket = join(dir, 't.sock');
  const log = join(dir, 'requests.jsonl');
  const child = spawn(NODE, [join(FIXTURES, 'test-hub.mjs'), mode, socket, log, nonce], { stdio: ['ignore', 'pipe', 'inherit'] });
  own(child.pid);
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  await new Promise<void>((resolve, reject) => {
    let out = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; if (out.includes('ready')) resolve(); });
    void exited.then(() => reject(Error(`BLOCKED: the test hub ${mode} didn't start`)));
  });
  return {
    mode, socket, log, pid: child.pid!,
    requests: () => (existsSync(log) ? jsonLines(readFileSync(log, 'utf8')) : []),
    written: () => (existsSync(`${log}.out`) ? readFileSync(`${log}.out`, 'utf8').split('\n').filter(Boolean) : []),
    stop: async () => { try { child.kill('SIGKILL'); } catch { /* gone */ } await exited; },
  };
}
/** The held push's answer, as fixtures/test-hub.mjs writes it. */
export const heldAnswer = (nonce: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `held answer ${nonce}` } });

// ---- The spool: <home>/.deepbuild/spool/*.jsonl, read as bytes (README, The spool).
export interface Spooled { file: string; offset: number; json: Line }
export interface CutLine { file: string; offset: number; bytes: string }
export interface SpoolRead { files: string[]; requests: Spooled[]; bad: CutLine[] }
/**
 * Every request in the spool, in file-name then byte order, and every line that doesn't parse ("bad"), with the
 * byte offset where its line starts (lines split on \n). A request glued to the end of a cut line is found by
 * parsing from each `{` in the bad line, so the test knows every request the spool still holds.
 */
export function readSpool(home: string): SpoolRead {
  const dir = join(rootOf(home), 'spool');
  const out: SpoolRead = { files: [], requests: [], bad: [] };
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
    out.files.push(name);
    const bytes = readFileSync(join(dir, name));
    let start = 0;
    while (start < bytes.length) {
      let end = bytes.indexOf(0x0a, start);
      if (end < 0) end = bytes.length;
      const segment = bytes.subarray(start, end);
      if (segment.length) {
        const json = parseObject(segment.toString('utf8'));
        if (json) out.requests.push({ file: name, offset: start, json });
        else {
          out.bad.push({ file: name, offset: start, bytes: segment.toString('utf8') });
          for (let j = segment.indexOf(0x7b, 1); j > 0; j = segment.indexOf(0x7b, j + 1)) {
            const glued = parseObject(segment.subarray(j).toString('utf8'));
            if (glued && typeof glued.id === 'string') { out.requests.push({ file: name, offset: start + j, json: glued }); break; }
          }
        }
      }
      start = end + 1;
    }
  }
  return out;
}
/** Every byte of every spool file, joined. */
export function spoolText(home: string): string {
  const dir = join(rootOf(home), 'spool');
  if (!existsSync(dir)) return '';
  return readdirSync(dir).sort().map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
}

// ---- Timing (#14's and #16's rule).
export function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.NaN;
}
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state. */
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
  const text = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(text);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${text}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${text}`);
}
/** hyperfine on PATH, or null. */
export function hyperfinePath(): string | null {
  const r = spawnSync('/bin/sh', ['-c', 'command -v hyperfine'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}
