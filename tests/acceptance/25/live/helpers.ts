// Shared test-side tools for #25's budget and live route tests (README): temp homes with stubbed system tools, a
// checkout's `deep setup`, its hub as a process with the socket's line protocol, the Claude Code stand-in
// (fixtures/claude.mjs) and the process table. Parts are adapted from tests/acceptance/18/install/helpers.ts (same
// repo, same license); this suite keeps its own copy so a redraft of #18's never moves these tests. Nothing here
// stands in for DeepBuild: every test reaches it through the CLI, deep-hook as setup's entries run it, the hub's
// socket and the files under the temporary home.
//
// Safety: folders under /tmp/dh25l-*, HOME a temp folder for every process started, no CLAUDE*, DEEP_* or billing
// variable of the runner's passed on, and only processes this suite started are stopped, by PID.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const NODE = process.execPath;
export const SECOND = 1000;

/** The criteria these files prove, each named by its number in the issue's order and its ID (README). */
export const AC1 = 'AC1 #25.0215da31';
export const AC2 = 'AC2 #25.ee0f30b0';
export const AC7 = 'AC7 #25.3010b97e';
export const AC8 = 'AC8 #25.e5d5c962';
export const AC9 = 'AC9 #25.14a7bfb8';

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
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });
export const readLines = (file: string): Line[] => (existsSync(file) ? jsonLines(readFileSync(file, 'utf8')) : []);
export const tag = (n = 3) => randomBytes(n).toString('hex');
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

// ---- A checkout whose built CLI and deep-hook a test drives: this one, or the merge base's (budgets.test.ts).
export interface Checkout { label: string; root: string; cli: string }
export const CURRENT: Checkout = { label: 'this checkout', root: REPO, cli: join(REPO, 'packages/cli/dist/main.js') };

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh25l-'));
  made.push(dir);
  return dir;
}
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts. `<tmp>/bin` comes first on PATH with stand-ins for
 * launchctl, systemctl and claude (each logs its call and exits 0; `claude --version` answers the newest version the
 * facts cover) and a `deep` that runs the checkout's built CLI. `<tmp>/confirm` holds `confirmed`: the OS
 * confirmation stubbed through DEEP_HUB_TEST_CONFIRM (#24), so `deep inbox answer` counts.
 */
export interface Home { tmp: string; home: string; bin: string; co: Checkout }
export function makeHome(co: Checkout = CURRENT): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin);
  for (const name of ['launchctl', 'systemctl', 'claude']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${co.cli}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  return { tmp, home, bin, co };
}
export const settingsFile = (h: Home) => join(h.home, '.claude', 'settings.json');

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
export function own(pid: number | undefined): void { if (pid) owned.add(pid); }
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
/** Stops every process this suite started, with their process groups (SIGTERM, then SIGKILL), and removes its temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) for (const target of [pid, -pid]) try { process.kill(target, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) for (const target of [pid, -pid]) try { process.kill(target, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, no DEEP_, CLAUDE or billing variable of this process's. */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), SHELL: '/bin/sh', LC_ALL: 'C',
    PATH: `${h.bin}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, DEEP_HUB_TEST_CONFIRM: join(h.tmp, 'confirm'),
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number; onStart?: (child: ChildProcess) => void } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    o.onStart?.(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
/** `deep <args>` from the home's checkout, HOME the test's home. */
export function deep(h: Home, args: readonly string[], env: Record<string, string | undefined> = {}, timeoutMs = 180_000): Promise<Ran> {
  return run(NODE, [h.co.cli, ...args], { env: childEnv(h, env), timeoutMs, cwd: h.co.root });
}

// ---- deep-hook: setup's entries name the one the checkout built; this checkout's is built if it's missing.
let built: Promise<void> | undefined;
export function buildDeepHook(): Promise<void> {
  built ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 1_200_000 }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
  });
  return built;
}

// ---- Claude Code's user settings and DeepBuild's entries in it (README: DeepBuild's entries).
export function readSettings(h: Home): Line {
  const parsed = parseObject(readFileSync(settingsFile(h), 'utf8'));
  if (!parsed) throw Error(`${settingsFile(h)} is not a JSON object`);
  return parsed;
}
/** Whether a hook command is DeepBuild's: it runs deep-hook, or the deep CLI (by its built file or as `deep`). */
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
export interface Entry { event: string; hook: Line }
export function deepEntries(settings: Line): Entry[] {
  const hooks = (settings.hooks ?? {}) as Record<string, Line[]>;
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : [])
    .flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []).map((hook: Line) => ({ event, hook }))))
    .filter((e) => isDeepBuild(e.hook.command));
}
/**
 * DeepBuild's waiter: its asyncRewake entry, written once under Stop and once under StopFailure with the same command
 * and timeout (design: What each agent gives us, amended Oct 29). Returns the Stop one; a setup that writes the
 * waiter under Stop only fails here, naming that cause.
 */
export function waiterEntry(settings: Line): Entry {
  const found = deepEntries(settings).filter((e) => e.hook.asyncRewake === true);
  const shownAll = JSON.stringify(deepEntries(settings).map((e) => ({ event: e.event, ...e.hook })));
  const stop = found.filter((e) => e.event === 'Stop');
  const failure = found.filter((e) => e.event === 'StopFailure');
  if (stop.length === 1 && found.length === 1) throw Error(`setup wrote the waiter's entry under Stop only: a turn that ends on an API error fires only StopFailure, so setup must also write it under StopFailure, with the same command and timeout: ${shownAll}`);
  if (stop.length !== 1 || failure.length !== 1 || found.length !== 2) throw Error(`setup must write DeepBuild's asyncRewake waiter entry once under Stop and once under StopFailure, and nowhere else, into ~/.claude/settings.json; found ${stop.length} under Stop, ${failure.length} under StopFailure, ${found.length} in all: ${shownAll}`);
  if (stop[0]!.hook.command !== failure[0]!.hook.command || stop[0]!.hook.timeout !== failure[0]!.hook.timeout) throw Error(`setup must write the waiter's entry under Stop and under StopFailure with the same command and timeout: ${shownAll}`);
  return stop[0]!;
}
/** The words of a shell command as `sh -c` would split it, for the simple quoting setup writes ('…' and bare words). */
export function shellWords(command: string): string[] {
  const words: string[] = [];
  for (const m of command.matchAll(/'((?:[^']|'\\'')*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g)) words.push(m[1] !== undefined ? m[1].replaceAll(`'\\''`, `'`) : m[2] ?? m[3]!);
  return words;
}

/**
 * `deep setup` with HOME the test's home, a hub already answering and launchctl/systemctl stubbed (README: Setup).
 * Fails with the command's output unless it exits 0; fails BLOCKED when an entry names a deep-hook that isn't there.
 */
export async function setup(h: Home, env: Record<string, string | undefined> = {}): Promise<void> {
  if (h.co === CURRENT) await buildDeepHook();
  const r = await deep(h, ['setup'], env);
  if (r.code !== 0) throw Error(`deep setup (${h.co.label}) must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  for (const { hook } of deepEntries(readSettings(h))) {
    for (const path of String(hook.command).match(/\/[^\s'"]*deep-hook\b/g) ?? []) {
      if (!existsSync(path) && h.co === CURRENT && path.startsWith(REPO)) await run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...(path.includes('/release/') ? ['--release'] : [])], { timeoutMs: 1_200_000 });
      if (!existsSync(path)) throw Error(`BLOCKED: DeepBuild's entry runs ${path}, which doesn't exist: ${hook.command}`);
    }
  }
}

// ---- The hub as a process: `deep hub run`, HOME the test's home (#16).
export interface Hub { pid: number; h: Home; socket: string; root: string; child: ChildProcess; output(): string }
export async function startHub(h: Home, plant?: string): Promise<Hub> {
  const child = spawn(NODE, [h.co.cli, 'hub', 'run'], { cwd: h.co.root, env: childEnv(h, { DEEP_HUB_PLANT: plant }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub (${h.co.label}) didn't start${plant ? ` with DEEP_HUB_PLANT=${plant}` : ''}: ${out.slice(0, 2000)}`);
  const root = join(h.home, '.deepbuild');
  return { pid: child.pid!, h, socket: join(root, 'hub.sock'), root, child, output: () => out };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
}

// ---- The line protocol (#16): a cli connection with the control token.
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
  async hello(token: string): Promise<void> {
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    const reply = await this.wait((l) => 'role' in l || 'error' in l, from, 10_000);
    if (!reply || reply.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(reply)}`);
  }
  /** One request; `sent` is the wall-clock time its line was written to the socket. */
  async call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<{ result: Line; sent: number }> {
    const id = `${method}#${++this.ids}`;
    const from = this.lines.length;
    const sent = Date.now();
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await this.wait((l) => l.id === id && ('result' in l || 'error' in l), from, timeoutMs);
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return { result: reply.result as Line, sent };
  }
  close(): void { this.sock.destroy(); }
}
export async function control(hub: Hub): Promise<Conn> {
  const conn = await Conn.open(hub.socket);
  await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
  return conn;
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; data: Line }
/** The hub's log after `after`, paged by log_pos through `events.read`. */
export async function eventsAfter(conn: Conn, after = 0): Promise<Ev[]> {
  const out: Ev[] = [];
  for (;;) {
    const events = (await conn.call('events.read', { after, limit: 1000 })).result.events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
/** An event's time in epoch ms, whatever unit the record keeps it in. */
export const msOf = (ts: number): number => (ts > 1e17 ? ts / 1e6 : ts > 1e14 ? ts / 1e3 : ts);
/** Polls until probe gives a value, or fails naming what it waited for. */
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string, everyMs = 200): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(everyMs);
  }
}

// ---- Sessions and their hook payloads, shaped like the corpus's Claude Code payloads (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
export function newSession(h: Home): Session {
  const id = randomUUID();
  const cwd = join(h.tmp, `w${tag(3)}`);
  mkdirSync(cwd, { recursive: true });
  const transcript = join(h.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt) base.prompt_id = s.prompt;
  if (event === 'SessionStart') { Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); delete base.prompt_id; }
  if (event === 'Stop') Object.assign(base, { stop_hook_active: false, last_assistant_message: 'Done.' });
  return { ...base, ...extra };
}
export function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
/** The transcript entry Claude Code writes for a prompt you typed; the hooks of its turn carry its prompt ID. */
export function typedPrompt(s: Session, text: string): void {
  s.prompt = randomUUID();
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
}

// ---- The Claude Code stand-in (fixtures/claude.mjs): one process per session.
export interface HookRun { command: string; async: boolean; asyncRewake: boolean; timeout: number; pid: number; started: number; ended: number | null; code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; expired: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; settingsError?: string }
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private rpc = 0;
  private constructor(private readonly child: ChildProcess, readonly h: Home) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
    });
  }
  /** Claude Code for one session, HOME the test's home; `env` is added to what its hooks and its deep mcp get. */
  static start(h: Home, env: Record<string, string | undefined> = {}): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), h.co.cli, FACTS], { cwd: h.tmp, env: childEnv(h, env), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Claude(child, h);
  }
  private send(command: Line, timeoutMs = 900_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the Claude Code stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the Claude Code stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** Fires one hook: every entry of the user settings file for it, as Claude Code runs them. */
  async hook(event: string, body: Line): Promise<Fired> {
    return (await this.send({ op: 'hook', event, payload: body, settings: settingsFile(this.h) })) as unknown as Fired;
  }
  async background(): Promise<(HookRun & { event: string })[]> { return (await this.send({ op: 'background' })).background as (HookRun & { event: string })[]; }
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const id = `${method}#${++this.rpc}`;
    const r = await this.send({ op: 'mcp', line: { jsonrpc: '2.0', id, method, params }, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async notify(method: string, params: Line = {}): Promise<void> { await this.send({ op: 'mcp', line: { jsonrpc: '2.0', method, params } }); }
  async initialize(): Promise<void> {
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-25-live', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.notify('notifications/initialized');
  }
  /** A deep_* tool call as Claude Code makes it: PreToolUse, the call, then PostToolUse with its result. */
  async deepTool(s: Session, tool: string, args: Line, timeoutMs = 120_000): Promise<Line> {
    const call = `toolu_${randomBytes(12).toString('hex')}`;
    await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args, tool_use_id: call }));
    const reply = await this.request('tools/call', { name: tool, arguments: args }, timeoutMs);
    await this.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args, tool_use_id: call, tool_response: reply.result ?? reply.error ?? null }));
    return reply;
  }
  quit(): void { try { this.child.kill('SIGTERM'); } catch { /* gone */ } }
}
export const ours = (runs: HookRun[]): HookRun[] => runs.filter((r) => isDeepBuild(r.command));

// ---- The process table: a waiter's processes, their resident memory and CPU time.
export interface Proc { pid: number; ppid: number; pgid: number; rssBytes: number; cpuMs: number; comm: string; args: string }
/** ps's cumulative CPU time, `[[dd-]hh:]mm:ss.ss`, in ms (10 ms resolution). */
export function cpuOf(text: string): number {
  const [days, rest] = text.includes('-') ? [Number(text.split('-')[0]), text.split('-')[1]!] : [0, text];
  const parts = rest.split(':').map(Number);
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + p;
  return Math.round((days * 86_400 + seconds) * 1000);
}
export function processTable(): Proc[] {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,rss=,time=,comm=,args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s?(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), rssBytes: Number(m[4]) * 1024, cpuMs: cpuOf(m[5]!), comm: m[6]!, args: m[7] ?? '' }] : [];
  });
}
/** Every process descended from `root` (itself included), by parent links, and every member of its process group. */
export function treeOf(table: Proc[], root: number): Proc[] {
  const kept = new Set<number>([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of table) if (!kept.has(p.pid) && (kept.has(p.ppid) || p.pgid === root)) { kept.add(p.pid); grew = true; }
  }
  return table.filter((p) => kept.has(p.pid));
}
/**
 * The waiter's own processes under the shell Claude Code starts an entry with: the shell itself counts only once it
 * has become the waiter (exec), never while it is still `sh` waiting on a child.
 */
export function waiterProcs(table: Proc[], shellPid: number): Proc[] {
  return treeOf(table, shellPid).filter((p) => !(p.pid === shellPid && /(^|\/)(ba|da|z)?sh$/.test(p.comm)));
}

// ---- The machine (design: Numbers version 0 has to hold; the owner's rules for budgets, README: Budgets).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** The 1-minute load average and the core count, as `os` reads them. */
export async function load(): Promise<{ one: number; cores: number }> {
  const os = await import('node:os');
  return { one: os.loadavg()[0]!, cores: os.availableParallelism() };
}
/**
 * Why this machine's readings only count as readings, or null: a reference Mac (Mac15,7 or Mac15,12) with Low Power
 * Mode off and a nominal thermal state, on battery or mains alike, and not loaded past its core count at any of the
 * `loads` taken around the measurement.
 */
export function environmentProblem(loads: { one: number; cores: number }[]): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const worst = loads.reduce((a, b) => (b.one / b.cores > a.one / a.cores ? b : a), loads[0] ?? { one: 0, cores: 1 });
  if (worst.one > worst.cores) return `heavy contention: 1-minute load ${worst.one.toFixed(1)} on ${worst.cores} cores`;
  return null;
}

/** The design's rule for a timing or memory result over five runs (README: Budgets): PASS, FAIL or INCONCLUSIVE. */
export interface Judged { verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; text: string }
export function judge(name: string, runs: number[], limit: number, unit: string, strict: boolean): Judged {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const text = `${name}: ${runs.map((r) => r.toFixed(unit === 'MB' ? 2 : 1)).join(', ')} ${unit} against ${strict ? 'under ' : 'at most '}${limit} ${unit} (margin ${Number.isFinite(margin) && margin < 100 ? `${(margin * 100).toFixed(0)}%` : 'spread'})`;
  if (runs.every((r) => (strict ? r < limit : r <= limit))) return { verdict: 'PASS', text };
  if (runs.every((r) => r > limit * (1 + margin) || (limit === 0 && r > 0))) return { verdict: 'FAIL', text };
  return { verdict: 'INCONCLUSIVE', text };
}
/** Nearest-rank percentile. */
export function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
}
