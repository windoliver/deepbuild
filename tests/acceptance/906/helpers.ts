// Shared test-side tools for #906's acceptance tests (README): temp homes with stubbed system tools, a git repo the
// session works in, `deep setup` through the built CLI, the hub as a process (with the planted delay's file) and its
// socket, the Claude Code stand-in (fixtures/claude.mjs), a session that asks through its own `deep mcp`, your answer
// with `deep inbox answer`, the record's delivery outcomes and what the transcript shows. Adapted from
// tests/acceptance/27/helpers.ts (same repo, same license), trimmed to what these tests use; this suite keeps its own
// copy so a redraft of #27's never moves these tests. Nothing here stands in for DeepBuild: every test reaches it
// through the CLI, deep-hook as setup's entries run it, the hub's socket and the files under the temporary home.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const NODE = process.execPath;

// The criteria (README: Criteria to tests): `#906.<first 8 hex of SHA-256 of the criterion's text>`, as
// scripts/proof-change.mjs computes it.
export const AC1 = 'AC1 #906.b7af9874';
export const AC2 = 'AC2 #906.ac643af8';
export const AC3 = 'AC3 #906.02f9eada';

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
export const readLines = (file: string): Line[] => { try { return jsonLines(readFileSync(file, 'utf8')); } catch { return []; } };
export const tag = (n = 6) => randomBytes(n).toString('hex');
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh906-'));
  made.push(dir);
  return dir;
}
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts. `<tmp>/bin` comes first on PATH with stand-ins for
 * launchctl, systemctl and claude (each logs its call and exits 0) and a `deep` that runs the built CLI. `<tmp>/late`
 * is the planted delay's file (README: Defined here), absent until a test makes it.
 */
export interface Home { tmp: string; home: string; bin: string; late: string }
export function makeHome(): Home {
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
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  return { tmp, home, bin, late: join(tmp, 'late') };
}
export const rootOf = (home: string) => join(home, '.deepbuild');
export const settingsFile = (home: string) => join(home, '.claude', 'settings.json');
export const binOf = (home: string) => join(dirname(home), 'bin');

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
/** The live members of a process group. */
const groupAlive = (pgid: number): boolean => {
  try { process.kill(-pgid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
};
/** Process groups the stand-ins started for hook entries (each entry runs in its own group, as the stand-in's pid). */
const startedGroups = new Set<number>();
/** Stops every process this suite started and the process groups its stand-ins started (SIGTERM, then SIGKILL), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  const groups = [...startedGroups];
  for (const pgid of groups) try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ }
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while (([...owned].some(alive) || groups.some(groupAlive)) && Date.now() < deadline) await sleep(100);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  for (const pgid of groups) try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  startedGroups.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, no DEEP_, CLAUDE*, CODEX*, GIT_, OTEL_ or XDG_ setting or billing key of this process's. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|OTEL_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.SHELL = '/bin/sh';
  env.PATH = `${binOf(home)}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  env.DEEP_HUB_TEST_CONFIRM = join(dirname(home), 'confirm');
  // A planted wrong program run by hand (README: How to run) reaches the hub, setup, the CLI and the stand-in, so deep-hook and deep mcp.
  if (process.env.DEEP_HUB_PLANT) env.DEEP_HUB_PLANT = process.env.DEEP_HUB_PLANT;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/** `deep <args>` from the built CLI, HOME the test's home. */
export function deep(home: string, args: readonly string[], o: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(home, o.env), timeoutMs: o.timeoutMs ?? 180_000 });
}

// ---- deep-hook: setup names the path its entries run; one that is missing is built once, or the test is BLOCKED.
let building: Promise<void> | undefined;
function cargoBuild(): Promise<void> {
  building ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 1_200_000 }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: cargo build --locked -q -p deep-hook failed: ${r.stderr.slice(-3000)}`);
  });
  return building;
}

// ---- Claude Code's user settings and DeepBuild's entries in it.
/** Whether a hook command is DeepBuild's: it runs deep-hook, or the deep CLI (by its built file or as `deep`). */
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
function deepCommands(home: string): string[] {
  const settings = parseObject(readFileSync(settingsFile(home), 'utf8')) ?? {};
  const hooks = (settings.hooks ?? {}) as Record<string, Line[]>;
  return Object.values(hooks).flatMap((groups) => (Array.isArray(groups) ? groups : []).flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : [])))
    .map((h: Line) => h.command).filter(isDeepBuild) as string[];
}
/** `deep setup` with HOME the test's home, the hub already answering; BLOCKED unless it exits 0 and the deep-hook it names exists. */
export async function setup(home: string): Promise<void> {
  const r = await deep(home, ['setup']);
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  if (!existsSync(settingsFile(home))) throw Error(`BLOCKED: deep setup exited 0 but wrote no ${settingsFile(home)}: ${shown(r)}`);
  for (const command of deepCommands(home)) {
    for (const path of command.match(/\/[^\s'"]*deep-hook\b/g) ?? []) {
      if (!existsSync(path) && path === join(REPO, 'target/debug/deep-hook')) await cargoBuild();
      if (!existsSync(path)) throw Error(`BLOCKED: DeepBuild's entry runs ${path}, which doesn't exist: ${command}`);
    }
  }
}

// ---- The repo the session works in: a git repo with one commit, its git user in its own config.
export function makeRepo(home: string): string {
  const dir = join(dirname(home), `repo${tag(2)}`);
  mkdirSync(dir, { recursive: true });
  const env = childEnv(home);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Acceptance 906');
  git('config', 'user.email', 'acceptance-906@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), '# A header colour\n\nThe page whose header colour the session asks about.\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'Start the page');
  return dir;
}

// ---- The hub as a process: `deep hub run`, HOME the test's home (#16), the planted delay's file named (README).
export interface Hub { pid: number; home: string; socket: string; root: string; output(): string }
export async function startHub(h: Home): Promise<Hub> {
  const env = childEnv(h.home, { DEEP_HUB_TEST_LATE_REPLY: h.late });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  if (!ready) throw Error(`BLOCKED: the hub didn't start${process.env.DEEP_HUB_PLANT ? ` with DEEP_HUB_PLANT=${process.env.DEEP_HUB_PLANT}` : ''}: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home: h.home, socket: join(rootOf(h.home), 'hub.sock'), root: rootOf(h.home), output: () => out };
}

// ---- The line protocol (#16): a cli connection with the control token.
class Conn {
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
  async hello(token: string): Promise<void> {
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    const reply = await this.wait((l) => 'role' in l || 'error' in l, from, 10_000);
    if (!reply || reply.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(reply)}`);
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
export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; subject?: string; session?: string; data: Line }
/** Every event in the log, paged by log_pos through `events.read`. */
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
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
/** The newest log position, so a later read can say what came after it. */
export const lastPos = async (hub: Hub): Promise<number> => (await allEvents(hub)).at(-1)?.log_pos ?? 0;
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
/** Polls `probe` for `ms`, and returns the first value it gave, or undefined: for "nothing happens" checks. */
export async function within<T>(ms: number, probe: () => Promise<T | undefined | false> | T | undefined | false): Promise<T | undefined> {
  return waitFor(probe, ms, '').catch(() => undefined);
}

// ---- The session, its hook payloads and its transcript, shaped like the corpus's (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
export function newSession(home: string, cwd: string): Session {
  const id = randomUUID();
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
export const callId = () => `toolu_${randomBytes(12).toString('hex')}`;
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt) base.prompt_id = s.prompt;
  switch (event) {
    case 'SessionStart': Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); delete base.prompt_id; break;
    case 'Stop': Object.assign(base, { stop_hook_active: false, last_assistant_message: 'Done.' }); break;
    default: break;
  }
  return { ...base, ...extra };
}
export function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
/** The transcript entry Claude Code writes for a prompt you typed; its prompt ID is what the turn's hooks carry. */
export function typedPrompt(s: Session, text: string): string {
  const promptId = randomUUID();
  s.prompt = promptId;
  appendTranscript(s, { type: 'user', promptId, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return promptId;
}
/** The assistant's reply text, as a transcript entry. */
export function assistantSays(s: Session, text: string): void {
  appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 10 } } });
}
/**
 * The transcript entries that show an ask's ID to the agent (README: "The transcript shows its ID"): what Claude Code
 * wrote from text DeepBuild handed it, a `hook_additional_context` attachment (a prompt's or a start's added context)
 * or a user entry whose content is text (a Stop's block reason as "Stop hook feedback", a wake's prompt), naming the
 * ask's ID. A wake's `queue-operation` line is that same prompt queued, and the agent's own deep_ask call and its tool
 * result are the agent's words, so neither counts.
 */
export function showings(s: Session, id: string): Line[] {
  return readLines(s.transcript).filter((e) => {
    if (e.type === 'attachment') return e.attachment?.type === 'hook_additional_context' && JSON.stringify(e.attachment.content ?? '').includes(id);
    if (e.type === 'user') return typeof e.message?.content === 'string' && e.message.content.includes(id);
    return false;
  });
}
export const showingsShown = (xs: Line[]) => JSON.stringify(xs.map((e) => (e.type === 'attachment' ? { attachment: e.attachment?.hookEvent, content: e.attachment?.content } : { user: String(e.message?.content).slice(0, 400) }))).slice(0, 3000);

// ---- The Claude Code stand-in (fixtures/claude.mjs): one process per session.
export interface HookRun { command: string; async: boolean; asyncRewake: boolean; timeout: number; pid: number; session: string; started: number; ended: number | null; code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; expired: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; blocked?: string; settingsError?: string }
export interface Wake { pid: number; session: string; code: number; at: number; stderr: string; dropped?: boolean; started?: number; prompt?: string; promptId?: string; fired?: Fired }
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private rpc = 0;
  readonly wakes: Wake[] = [];
  exited = false;
  private constructor(private readonly child: ChildProcess, readonly home: string) {
    child.on('exit', () => { this.exited = true; for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (!line) return;
      if (typeof line.n === 'number') this.pending.get(line.n)?.(line);
      else if (line.wake) this.wakes.push(line.wake as Wake);
    });
  }
  /** Claude Code for one session, HOME the test's home. */
  static start(home: string): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), CLI, FACTS], { cwd: dirname(home), env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Claude(child, home);
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
    const fired = (await this.send({ op: 'hook', event, payload: body, settings: settingsFile(this.home) })) as unknown as Fired;
    for (const r of [...fired.background, ...fired.ran]) startedGroups.add(r.pid);
    return fired;
  }
  /** One JSON-RPC request to this session's own `deep mcp`. */
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const id = `${method}#${++this.rpc}`;
    const r = await this.send({ op: 'mcp', line: { jsonrpc: '2.0', id, method, params }, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  private initialized = false;
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-906', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.send({ op: 'mcp', line: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
    this.initialized = true;
  }
  /**
   * One of DeepBuild's tools called as the agent calls it: its PreToolUse, the call through this session's deep mcp,
   * its tool_use and tool_result in the transcript, its PostToolUse. Resolves with the call's reply.
   */
  async tool(s: Session, name: string, args: Line, timeoutMs = 120_000): Promise<Line> {
    await this.initialize();
    const call = callId();
    const tool = `mcp__deep__${name}`;
    appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: tool, input: args }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
    await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: tool, tool_input: args, tool_use_id: call }));
    const reply = await this.request('tools/call', { name, arguments: args }, timeoutMs).catch((error: Error): Line => ({ error: error.message }));
    appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: JSON.stringify(reply.result?.content ?? reply.error ?? reply) }] } });
    await this.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: tool, tool_input: args, tool_use_id: call, tool_response: reply.result ?? {} }));
    return reply;
  }
}
export const firedShown = (f: Fired) => JSON.stringify({ blocked: f.blocked, runs: [...f.ran, ...f.background].map((r) => ({ command: r.command.slice(0, 160), code: r.code, signal: r.signal, timedOut: r.timedOut, ms: r.ended === null ? null : r.ended - r.started, stdout: r.stdout.slice(0, 600), stderr: r.stderr.slice(0, 600) })) });
/** The machine's load, for messages (README: How to run, machine load). */
export const load = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
/**
 * BLOCKED unless deep-hook waited on the hub for a hook (1 s or more): one the hub didn't acknowledge within deep-hook's
 * 50 ms goes through at once, unheld, as the hub away (#315), so neither the hold nor the planted delay was reached.
 * That is machine load, not the program under test (README: How to run).
 */
export function mustBeHeld(f: Fired, what: string): void {
  const r = f.ran.find((x) => isDeepBuild(x.command));
  const ms = r && r.ended !== null ? r.ended - r.started : null;
  if (ms === null || ms < 1000) throw Error(`BLOCKED: deep-hook let ${what} through in ${ms} ms, before any hold: the hub didn't acknowledge it within deep-hook's 50 ms (1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores), so the hold and the planted delay were never reached; rerun on a quieter machine: ${firedShown(f)}`);
}
/** BLOCKED unless deep-hook printed the hub's reply to a hook, which carries `id`: the hub acknowledged it in time. */
export function mustCarry(f: Fired, id: string, what: string): void {
  if (!replied(f).includes(id)) throw Error(`BLOCKED: deep-hook printed no reply carrying ${id} for ${what}${/spool/.test(replied(f)) ? ': it went through as with the hub away (no acknowledgement within its 50 ms)' : ''} (1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores); rerun on a quieter machine: ${firedShown(f)}`);
}
/** What DeepBuild's synchronous entries replied to a hook: their stdout and stderr together. */
export const replied = (f: Fired): string => f.ran.filter((r) => isDeepBuild(r.command)).map((r) => `${r.stdout}\n${r.stderr}`).join('\n');

// ---- The session that asks you something through deep_ask, and your answer.
export interface Asking { s: Session; claude: Claude; handle: string; id: string; green: string }
/**
 * A session of its own Claude Code in the repo: it starts, you type a prompt, the agent calls `deep_ask` (a choice
 * between two header colours, blue recommended) and Claude Code waits for the call; deep_ask comes back still waiting
 * after its wait for you (40 s), and the agent says it will wait. Its turn hasn't stopped.
 */
export async function askingSession(hub: Hub, home: string, cwd: string): Promise<Asking> {
  const s = newSession(home, cwd);
  const claude = Claude.start(home);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Pick a header colour for the checkout page.');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Pick a header colour for the checkout page.' }));
  const t = tag(4);
  const question = `Which header colour for the checkout page (${t})?`;
  const green = `Green header ${t}`;
  const args = { kind: 'choice', question, options: [{ id: 'blue', label: `Blue header ${t}` }, { id: 'green', label: green }], recommended: 'blue', steps: null, where: null, why: null, check: null, subject: null };
  const reply = await claude.tool(s, 'deep_ask', args, 120_000);
  const created = (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === question);
  if (!created) throw Error(`BLOCKED: the deep_ask "${question}" was not filed under ${s.id}; deep_ask replied ${JSON.stringify(reply).slice(0, 1500)}`);
  if (JSON.stringify(reply).includes(green)) throw Error(`BLOCKED: nothing was answered yet, but deep_ask came back with an answer: ${JSON.stringify(reply).slice(0, 1500)}`);
  assistantSays(s, 'I asked which header colour you want; I will wait for your answer.');
  return { s, claude, handle: `ask:${created.id}`, id: created.id, green };
}
/** Your answer, green, given with `deep inbox answer` (#24, the OS confirmation stubbed); BLOCKED unless it exits 0. */
export async function answer(hub: Hub, a: Asking): Promise<void> {
  const r = await deep(hub.home, ['inbox', 'answer', a.handle, 'green']);
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ${a.handle} green must exit 0: ${shown(r)}`);
  await waitFor(async () => (await allEvents(hub)).some((e) => e.kind === 'ask.answered' && e.subject === a.handle), 10_000, `${a.handle}'s ask.answered`)
    .catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
}
/** The record's delivery outcomes for an ask (delivery.outcome@1), in log order. */
export async function outcomes(hub: Hub, id: string): Promise<Ev[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'delivery.outcome' && (e.subject === `ask:${id}` || String(e.data?.delivery ?? '').replace(/^ask:/, '') === id));
}
export const outcomeList = (evs: Ev[]) => evs.map((e) => `${e.data?.outcome} via ${e.data?.via} (log_pos ${e.log_pos})`).join(', ') || 'none';

/** The planted delay (README: Defined here): while its file exists, the hub writes a held hook's reply past deep-hook's hold. */
export function plantDelay(h: Home): void { writeFileSync(h.late, 'late\n'); }
export function liftDelay(h: Home): void { rmSync(h.late, { force: true }); }
