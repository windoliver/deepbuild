// Shared test-side tools for the #18 mapping acceptance tests: temp homes, the hub as a process (`deep hub run`),
// deep-hook as Claude Code's hook entry runs it, made-up sessions shaped like the corpus's recorded Claude Code
// payloads and transcripts (adapters/corpus/claude-code/2.1.304), and reads of the record through the hub's socket
// with the control token (`events.read`, `sessions.read`, `inbox.read`). The process, socket and hub parts are
// adapted from tests/acceptance/315/helpers.ts (same repo, same license); this suite keeps its own copy so a redraft
// of #315's suite never moves these tests. Nothing here stands in for deep-hook, the hub or the adapter.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
/** The Claude Code version every made-up session claims: the newest the facts cover at the base. */
export const VERSION = '2.1.304';
export const MODEL = 'claude-haiku-5-5';

// Criterion tags: `#18.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #18.0bbec18d';
export const AC2 = 'AC2 #18.ed825eb3';
export const AC4 = 'AC4 #18.1c162666';
export const AC6 = 'AC6 #18.32aa52f2';
export const AC7 = 'AC7 #18.689bca3f';
export const AC11 = 'AC11 #18.a39d3074';
export const AC12 = 'AC12 #18.5a2a67f9';
export const AC13 = 'AC13 #18.52387a5c';
export const AC21 = 'AC21 #18.e660707f';
export const AC23 = 'AC23 #18.158d0b97';
export const AC24 = 'AC24 #18.93b29039';

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

// ---- Temp folders: short real paths under /tmp, since a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh18m-'));
  made.push(dir);
  return dir;
}
/** A fresh home folder: the hub's root and deep-hook's rules and spool live in <home>/.deepbuild. */
export function makeHome(): string {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  return home;
}

// ---- Processes this suite started, stopped by PID only, never by name or port.
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
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
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

/** Variables that mark which agent runs a hook, or bill an API account: a child never inherits this process's. */
const MARKERS = /^(CLAUDE|CURSOR|GROK|CODEX|ANTHROPIC|OPENAI|AWS_BEARER|DEEP_|XDG_)/;
/** The environment a child gets: this one with HOME moved to the test's home and no agent markers, billing keys or DEEP_ settings. */
export function cleanEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (MARKERS.test(key) || key === 'AI_AGENT' || key === 'NODE_OPTIONS' || key.startsWith('GIT_')) continue;
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

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs a command to its end without blocking this process's event loop. */
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
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}

// ---- deep-hook, built once per test process (cargo is fine: it only rebuilds what changed).
let built: Promise<string> | undefined;
export function deepHook(): Promise<string> {
  built ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 900_000 }).then((r) => {
    if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
    spawnSync(DEEP_HOOK, ['--version'], { stdio: 'ignore', timeout: 30_000 });
    return DEEP_HOOK;
  });
  return built;
}

// ---- The hub as a process: `deep hub run`, its root <home>/.deepbuild (#16).
export interface Hub { home: string; root: string; socket: string; pid: number; plant?: string; stderr(): string }
/**
 * Starts the hub for `home`, with DEEP_HUB_PLANT set to `plant` when one is named. A hub that doesn't start fails
 * the test at an assertion naming why: for a plant, that the hub has no such planted program yet.
 */
export async function startHub(home: string, plant?: string, timeoutMs = 60_000): Promise<Hub> {
  const env = cleanEnv(home, { DEEP_HUB_PLANT: plant });
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
    expect.fail(`the hub didn't start${plant ? ` with DEEP_HUB_PLANT=${plant} (the planted wrong program this test runs against)` : ''}: ${err.slice(0, 1500)}`);
  }
  return { home, root: join(home, '.deepbuild'), socket: String(ready!.socket), pid: child.pid!, ...(plant ? { plant } : {}), stderr: () => err };
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
async function control<T>(hub: Hub, use: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await use(conn);
  } finally {
    conn.close();
  }
}

/** One event as `events.read` returns it. */
export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; seq?: string; subject?: string; session?: string; agent?: string; verified?: boolean; data: Line }
/** Every event in the log, paged by log_pos. */
export function allEvents(hub: Hub): Promise<Ev[]> {
  return control(hub, async (conn) => {
    const out: Ev[] = [];
    let after = 0;
    for (;;) {
      const events = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos;
    }
  });
}
export const sessionsRead = (hub: Hub): Promise<Line[]> => control(hub, async (conn) => (await conn.call('sessions.read')).sessions as Line[]);
export const inboxRead = (hub: Hub): Promise<Line[]> => control(hub, async (conn) => (await conn.call('inbox.read')).asks as Line[]);

/**
 * Polls the log until `done` holds, or until it hasn't changed for `quietMs` (and at least `minMs` has passed);
 * resolves with the last read either way, so the test's own assertions say what is missing.
 */
export async function settle(hub: Hub, done: (events: Ev[]) => boolean, o: { timeoutMs?: number; quietMs?: number; minMs?: number } = {}): Promise<Ev[]> {
  const start = Date.now();
  const deadline = start + (o.timeoutMs ?? 30_000);
  let last = -1;
  let since = Date.now();
  for (;;) {
    const events = await allEvents(hub);
    if (done(events)) return events;
    if (events.length !== last) { last = events.length; since = Date.now(); }
    if ((Date.now() - since > (o.quietMs ?? 5000) && Date.now() - start > (o.minMs ?? 0)) || Date.now() > deadline) return events;
    await sleep(250);
  }
}
export const ofSession = (events: readonly Ev[], session: string): Ev[] => events.filter((e) => e.session === session);
/** The event's data in one line, for failure messages. */
export const shown = (e: Ev | undefined): string => (e ? `${e.kind} ${JSON.stringify(e.data)}` : 'no event');

// ---- A git repo for a session to work in.
// The home is the test's own, so its global git config is the home's (none unless something wrote one).
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
export const gitEnv = (home: string) => cleanEnv(home, GIT_ENV);
export function git(home: string, cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env: gitEnv(home), encoding: 'utf8' }).trim();
}
/** A fresh repo on `main` with one commit, as a session's worktree. */
export function repo(home: string): string {
  const work = join(tempDir(), 'work');
  mkdirSync(work);
  writeFileSync(join(work, 'README.md'), '# shop\n');
  git(home, work, 'init', '-q', '-b', 'main');
  git(home, work, 'add', '-A');
  git(home, work, 'commit', '-q', '-m', 'Start');
  return work;
}

// ---- Made-up Claude Code sessions, shaped like the corpus's recorded payloads and transcripts.
/** How a prompt's transcript entry says what started its turn (Claude Code 2.1.304's own fields), or null for no entry. */
export type Origin = 'human' | 'scheduled' | 'handback' | null;
export interface HookCall { event: string; payload: Line; ran: Ran }
export interface Call { id: string; tool: string; input: Line }
/** The environment Claude Code gives its hook commands. */
export const claudeEnv = (home: string, cwd: string) => cleanEnv(home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd });

export class Session {
  readonly id = randomUUID();
  readonly cwd: string;
  readonly transcript: string;
  promptId: string | undefined;
  readonly hooks: HookCall[] = [];
  private parent: string | null = null;
  private turn = 0;
  constructor(readonly home: string, o: { cwd?: string; transcript?: string; env?: NodeJS.ProcessEnv; envFor?: (event: string) => Record<string, string>; payload?: Line } = {}) {
    this.cwd = o.cwd ?? (() => { const d = join(tempDir(), 'work'); mkdirSync(d); return d; })();
    this.transcript = o.transcript ?? join(home, '.claude/projects', this.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    this.env = o.env ?? claudeEnv(home, this.cwd);
    this.extra = o.payload ?? {};
    this.envFor = o.envFor ?? (() => ({}));
    if (!o.transcript) {
      mkdirSync(dirname(this.transcript), { recursive: true });
      writeFileSync(this.transcript, '');
    }
  }
  private readonly env: NodeJS.ProcessEnv;
  private readonly extra: Line;
  private readonly envFor: (event: string) => Record<string, string>;

  /** Appends one transcript entry, as Claude Code writes it (only when the session keeps a transcript of its own). */
  entry(value: Line): void {
    if (!existsSync(this.transcript)) return;
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: VERSION, gitBranch: 'main' };
    this.parent = uuid;
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  /** Runs deep-hook as Claude Code's hook entry does: `deep-hook claude-code <event>`, the hook JSON on stdin. */
  async hook(event: string, fields: Line = {}): Promise<HookCall> {
    const payload: Line = {
      session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, ...(this.promptId ? { prompt_id: this.promptId } : {}),
      permission_mode: 'default', effort: { level: 'medium' }, hook_event_name: event, ...this.extra, ...fields,
    };
    const ran = await run(await deepHook(), ['claude-code', event], { cwd: this.cwd, env: { ...this.env, ...this.envFor(event) }, input: JSON.stringify(payload), timeoutMs: 60_000 });
    const call = { event, payload, ran };
    this.hooks.push(call);
    return call;
  }
  start(source = 'startup'): Promise<HookCall> {
    return this.hook('SessionStart', { source, model: MODEL });
  }
  /** A prompt: its transcript entry first (none for `null`), then its UserPromptSubmit. Returns its prompt ID. */
  async prompt(text: string, origin: Origin = 'human', o: { promptId?: string } = {}): Promise<string> {
    this.promptId = o.promptId ?? randomUUID();
    this.turn += 1;
    const position = { turnPosition: { promptIndex: 1, turnIndex: this.turn } };
    if (origin === 'human') this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, turnOrigin: 'human', ...position });
    if (origin === 'scheduled') this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: text }, isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, turnOrigin: 'scheduled', ...position });
    if (origin === 'handback') {
      this.entry({
        promptId: this.promptId, type: 'user', message: { role: 'user', content: text }, isMeta: true, promptSource: 'system', turnOrigin: 'peer', ...position,
        origin: { kind: 'peer', from: 'a2711031fe8c87e48', senderTaskId: 'a2711031fe8c87e48', name: 'general-purpose', body: text, handback: true, handbackReportText: text },
      });
    }
    await this.hook('UserPromptSubmit', { prompt: text });
    return this.promptId;
  }
  /**
   * One tool call: the assistant's tool_use entry, PreToolUse, `during` (what the call does, run between its hooks,
   * given the call's input as the PreToolUse reply may have changed it), its tool_result entry and PostToolUse, or
   * PostToolUseFailure when `error` is given.
   */
  async call(tool: string, input: Line, o: { response?: unknown; error?: string; durationMs?: number; during?: (input: Line, before: HookCall) => Promise<unknown> | unknown } = {}): Promise<Call & { before: HookCall; after: HookCall }> {
    const id = `toolu_${randomBytes(12).toString('hex')}`;
    this.entry({ type: 'assistant', message: { model: MODEL, id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id, name: tool, input }], stop_reason: 'tool_use', usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 } } });
    const before = await this.hook('PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id });
    const updated = parseObject(before.ran.stdout.trim())?.hookSpecificOutput?.updatedInput as Line | undefined;
    const used = updated ?? input;
    const returned = o.during ? await o.during(used, before) : undefined;
    const response = o.response ?? returned ?? { stdout: '', stderr: '', interrupted: false, isImage: false };
    this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: o.error ?? JSON.stringify(response), is_error: o.error !== undefined }] }, toolUseResult: o.error ?? response });
    const after = o.error !== undefined
      ? await this.hook('PostToolUseFailure', { tool_name: tool, tool_input: used, tool_use_id: id, error: o.error, is_interrupt: false, duration_ms: o.durationMs ?? 40 })
      : await this.hook('PostToolUse', { tool_name: tool, tool_input: used, tool_response: response, tool_use_id: id, duration_ms: o.durationMs ?? 40 });
    return { id, tool, input: used, before, after };
  }
  /** The assistant's last words of the turn, then Stop. */
  async stop(said = 'Done.', fields: Line = {}): Promise<HookCall> {
    this.entry({ type: 'assistant', message: { model: MODEL, id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: said }], stop_reason: 'end_turn', usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 12 } } });
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: said, ...fields });
  }
  /** A turn that ends on an API error: StopFailure with Claude Code's error type. */
  stopFailure(error: string, said: string): Promise<HookCall> {
    return this.hook('StopFailure', { error, last_assistant_message: said });
  }
  end(reason = 'prompt_input_exit'): Promise<HookCall> {
    return this.hook('SessionEnd', { reason });
  }
}

/** The session's events of `kind`, in log order. */
export const kindOf = (events: readonly Ev[], session: string, kind: string): Ev[] => ofSession(events, session).filter((e) => e.kind === kind);
/** The tool event for one call: the record keeps the call's ID in `data.call`. */
export const forCall = (events: readonly Ev[], kind: 'tool.before' | 'tool.after', call: string): Ev[] => events.filter((e) => e.kind === kind && e.data?.call === call);

/** What deep-hook printed for a hook, in one line, for failure messages. */
export const said = (h: HookCall) => `exit ${h.ran.code}${h.ran.timedOut ? ' (killed at the timeout)' : ''}, stdout ${JSON.stringify(h.ran.stdout.slice(0, 400))}, stderr ${JSON.stringify(h.ran.stderr.slice(0, 400))}`;

/** Runs `check` and returns the message of the assertion it fails, or null when it passes. */
export async function failureOf(check: () => unknown): Promise<string | null> {
  try {
    await check();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
