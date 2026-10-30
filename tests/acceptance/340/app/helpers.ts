// Shared test-side tools for #340's AC6 (README): temp homes with stubbed system tools, `deep setup` through the built
// CLI, the hub as a process with its socket's line protocol (an `app` and a `cli` connection, each with the control
// token), the Claude Code stand-in (fixtures/claude.mjs), sessions and their transcripts, the note the app sends
// (`session.note`, New in README), and the readers of the record this criterion names. Adapted from
// tests/acceptance/25/fallbacks/helpers.ts (same repo, same license); this suite keeps its own copy so a redraft of
// #25's never moves these tests. Nothing here stands in for DeepBuild: every test reaches it through the CLI, deep-hook
// as the settings run it (the waiter included), the hub's socket and the files under the temporary home.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { getSchema, validate } from '../../../../packages/contracts/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const NODE = process.execPath;
export const MINUTE = 60_000;

/** AC6's ID: `#340.` and the first 8 hex of the SHA-256 of its text, trimmed, white space collapsed (scripts/proof-change.mjs). */
export const AC6 = 'AC6 #340.b3c2bc3d';
/** The wrong programs the implementer adds to packages/hub/src/plant.ts (README: Wrong programs). */
export const PLANT_UNRECORDED = 'app-note-unrecorded';
export const PLANT_AS_PERSON = 'app-note-as-person';

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
export const readJson = (file: string): Line => JSON.parse(readFileSync(file, 'utf8')) as Line;
export const tag = (n = 4) => randomBytes(n).toString('hex');
/** A request ID shaped as a ULID, as the app's request IDs are (README: New: session.note). */
export function requestId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let out = alphabet[Math.floor(Math.random() * 8)]!;
  for (const byte of randomBytes(25)) out += alphabet[byte % 32]!;
  return out;
}
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh340a-'));
  made.push(dir);
  return dir;
}
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts. `<tmp>/bin` comes first on PATH with stand-ins for
 * launchctl, systemctl and claude (each logs its call and exits 0) and a `deep` that runs the built CLI.
 */
export interface Home { tmp: string; home: string; bin: string }
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
  return { tmp, home, bin };
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
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
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

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, none of this process's DEEP_*, GIT_*, XDG_*, CLAUDE* or billing keys. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('GIT_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.SHELL = '/bin/sh';
  env.PATH = `${binOf(home)}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  env.DEEP_HUB_TEST_CONFIRM = join(dirname(home), 'confirm');
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
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

// ---- deep-hook: setup names the path its entries run; one that is missing is built once, or the test is BLOCKED.
let built: Promise<void> | undefined;
function cargoBuild(release: boolean): Promise<void> {
  const args = ['build', '--locked', '-q', '-p', 'deep-hook', ...(release ? ['--release'] : [])];
  return run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: cargo ${args.join(' ')} failed: ${r.stderr.slice(-3000)}`);
  });
}
/** Whether a hook command is DeepBuild's: it runs deep-hook, or the deep CLI (by its built file or as `deep`). */
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
function deepEntries(settings: Line): Line[] {
  const hooks = (settings.hooks ?? {}) as Record<string, Line[]>;
  return Object.values(hooks).flatMap((groups) => (Array.isArray(groups) ? groups : []).flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks as Line[] : [])))
    .filter((hook) => isDeepBuild(hook.command));
}
/**
 * `deep setup` (#18) with HOME the test's home and a hub answering; BLOCKED unless it exits 0 with DeepBuild's
 * asyncRewake waiter entry in Claude Code's user settings once under Stop and once under StopFailure, with the same
 * command and timeout (#25, amended Oct 29), and no other. Builds the deep-hook its entries name if it is missing.
 */
export async function setup(home: string, env: Record<string, string | undefined> = {}): Promise<void> {
  const r = await run(NODE, [CLI, 'setup'], { env: childEnv(home, env), timeoutMs: 180_000 });
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  const settings = parseObject(readFileSync(settingsFile(home), 'utf8')) ?? {};
  const waiters = deepEntries(settings).filter((hook) => hook.asyncRewake === true);
  const under = (event: string) => deepEntries({ hooks: { [event]: (settings.hooks as Record<string, unknown> | undefined)?.[event] } }).filter((hook) => hook.asyncRewake === true);
  const [stop, failure] = [under('Stop'), under('StopFailure')];
  if (waiters.length !== 2 || stop.length !== 1 || failure.length !== 1 || stop[0]!.command !== failure[0]!.command || stop[0]!.timeout !== failure[0]!.timeout) {
    throw Error(`BLOCKED: setup must write DeepBuild's asyncRewake waiter entry under Stop and under StopFailure, with the same command and timeout, and no other; found ${JSON.stringify(waiters.map((w) => ({ command: w.command, timeout: w.timeout })))} (${stop.length} under Stop, ${failure.length} under StopFailure)`);
  }
  for (const hook of deepEntries(settings)) {
    for (const path of String(hook.command).match(/\/[^\s'"]*deep-hook\b/g) ?? []) {
      if (existsSync(path)) continue;
      built ??= cargoBuild(path.includes('/release/'));
      await built;
      if (!existsSync(path)) throw Error(`BLOCKED: DeepBuild's entry runs ${path}, which doesn't exist: ${hook.command}`);
    }
  }
}

// ---- The hub as a process: `deep hub run`, HOME the test's home (#16).
export interface Hub { pid: number; home: string; socket: string; root: string; child: ChildProcess; output(): string }
/** The hub; `env` is added to its environment (a plant, say). BLOCKED if it doesn't print its ready line. */
export async function startHub(home: string, env: Record<string, string | undefined> = {}): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  if (!ready) throw Error(`BLOCKED: the hub didn't start${env.DEEP_HUB_PLANT ? ` with DEEP_HUB_PLANT=${env.DEEP_HUB_PLANT}` : ''}: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), root: rootOf(home), child, output: () => out };
}

// ---- The line protocol (#16): an `app` or `cli` connection with the control token.
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
  async hello(role: 'app' | 'cli', token: string): Promise<void> {
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, hello: role, token })}\n`);
    const reply = await this.wait((l) => 'role' in l || 'error' in l, from, 10_000);
    if (!reply || reply.role !== role) throw Error(`BLOCKED: the hub refused the ${role} hello with the control token: ${JSON.stringify(reply)}`);
  }
  /** One request; resolves with the whole reply line, `result` or `error`. */
  async request(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await this.wait((l) => l.id === id && ('result' in l || 'error' in l), from, timeoutMs);
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    return reply;
  }
  async call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Line> {
    const reply = await this.request(method, params, timeoutMs);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  close(): void { this.sock.destroy(); }
}
export async function control<T>(hub: Hub, use: (conn: Conn) => Promise<T>, role: 'app' | 'cli' = 'cli'): Promise<T> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(role, readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await use(conn);
  } finally {
    conn.close();
  }
}
export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; seq?: string; subject?: string; session?: string; data: Line; [key: string]: unknown }
/** Every event in the log, paged by log_pos through `events.read`. */
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
/** Polls until probe gives a value, or fails naming what it waited for. */
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(250);
  }
}

// ---- Sessions and their hook payloads, shaped like the corpus's Claude Code payloads (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
export function newSession(home: string): Session {
  const id = randomUUID();
  const folder = join(dirname(home), `w${tag(3)}`);
  mkdirSync(folder, { recursive: true });
  const transcript = join(home, '.claude/projects', folder.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  if (!existsSync(transcript)) writeFileSync(transcript, '');
  return { id, cwd: folder, transcript };
}
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt) base.prompt_id = s.prompt;
  switch (event) {
    case 'SessionStart': Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); delete base.prompt_id; break;
    case 'Stop': Object.assign(base, { last_assistant_message: 'Done.' }); break;
    default: break;
  }
  return { ...base, ...extra };
}
export function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
/**
 * Words written into the session's terminal by this test process: the transcript entry Claude Code writes for a
 * prompt you typed (`turnOrigin: human`, as the corpus's typed prompts carry it); returns its prompt ID.
 */
export function typedPrompt(s: Session, text: string): string {
  const promptId = randomUUID();
  s.prompt = promptId;
  appendTranscript(s, { type: 'user', promptId, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return promptId;
}
/** The assistant's reply in the transcript, as Claude Code writes it before the turn's Stop. */
export function assistantSays(s: Session, text: string): void {
  appendTranscript(s, { type: 'assistant', promptId: s.prompt, message: { id: `msg_${tag(8)}`, role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
}

// ---- The Claude Code stand-in (fixtures/claude.mjs): one process per Claude Code process.
export interface HookRun { command: string; async: boolean; asyncRewake: boolean; timeout: number; pid: number; started: number; ended: number | null; code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; expired: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; stop?: { blocked: boolean; reasons: string[] }; settingsError?: string }
export interface Wake { at: number; stderr: string; woke: boolean; prompt: string | null; ran: HookRun[] }
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess, readonly home: string) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
    });
  }
  /** Claude Code, one process, HOME the test's home; `skip: ['asyncRewake']` runs no waiter for this session. */
  static async start(home: string, o: { skip?: string[]; env?: Record<string, string | undefined> } = {}): Promise<Claude> {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), CLI, FACTS], { cwd: dirname(home), env: childEnv(home, o.env), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    const claude = new Claude(child, home);
    await claude.send({ op: 'configure', ...(o.skip ? { skip: o.skip } : {}) });
    return claude;
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
    return (await this.send({ op: 'hook', event, payload: body, settings: settingsFile(this.home) })) as unknown as Fired;
  }
  async wakes(): Promise<Wake[]> { return (await this.send({ op: 'wakes' })).wakes as Wake[]; }
  async background(): Promise<(HookRun & { event: string })[]> { return (await this.send({ op: 'background' })).background as (HookRun & { event: string })[]; }
}
/** What DeepBuild's synchronous entries said back to a hook: their stdout and stderr, joined. */
export const said = (f: Fired): string => f.ran.filter((r) => isDeepBuild(r.command)).map((r) => `${r.stdout}\n${r.stderr}`).join('\n');
export const firedShown = (f: Fired) => JSON.stringify({ stop: f.stop, runs: [...f.ran, ...f.background].map((r) => ({ command: r.command.slice(-60), async: r.async, code: r.code, signal: r.signal, timedOut: r.timedOut, stdout: r.stdout.slice(0, 400), stderr: r.stderr.slice(0, 400) })) });

// ---- The scenario's parts (README: The scenario).

/** A world: a home, its hub (with `plant`, if any) and DeepBuild set up in Claude Code's user settings. */
export interface World { home: string; hub: Hub; env: Record<string, string | undefined> }
export async function world(plant?: string): Promise<World> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  const hub = await startHub(home, env);
  await setup(home, env);
  return { home, hub, env };
}
/** An idle session: it starts, you type a question (which opens no task), the agent answers and stops. */
export interface Idle { s: Session; claude: Claude; thread: string }
export const QUESTION = 'What does the settings page show today?';
export async function idleSession(w: World, o: { waiter: boolean }): Promise<Idle> {
  const s = newSession(w.home);
  const claude = await Claude.start(w.home, { env: w.env, ...(o.waiter ? {} : { skip: ['asyncRewake'] }) });
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, QUESTION);
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: QUESTION }));
  assistantSays(s, 'The settings page shows your profile and notifications.');
  const stop = await claude.hook('Stop', payload(s, 'Stop', { last_assistant_message: 'The settings page shows your profile and notifications.' }));
  if (stop.stop?.blocked) throw Error(`BLOCKED: with nothing asked, session ${s.id}'s stop must go through: ${firedShown(stop)}`);
  const start = await waitFor(async () => (await allEvents(w.hub)).find((e) => e.kind === 'session.start' && e.session === s.id), 30_000, `the session.start of ${s.id}`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}`); });
  if (o.waiter) {
    await waitFor(async () => (await claude.background()).find((r) => r.asyncRewake && r.ended === null), 30_000, `DeepBuild's waiter for ${s.id}, started by Claude Code at its stop`)
      .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}`); });
    // The waiter is waiting on the hub (session.wait) once it has run a moment; a note sent before then waits for it.
    await sleep(2000);
  }
  return { s, claude, thread: String(start.data.thread ?? '') };
}

/** A note the app sends: words that ask for changed behavior, and its delivery's request ID. */
export interface Note { text: string; request: string }
export const newNote = (): Note => ({ text: `Add a dark mode toggle to the settings page, named theme ${tag(4)}.`, request: requestId() });
/**
 * The app sends a note into a session as the app does (README: New: session.note): an `app` connection with the
 * control token, `session.note {session, text, request}`. The hub must take it: a reply with a result naming the
 * request ID, never a refusal.
 */
export async function sendNote(hub: Hub, s: Session, note: Note): Promise<void> {
  const reply = await control(hub, (conn) => conn.request('session.note', { session: s.id, text: note.text, request: note.request }), 'app');
  expect(reply.error, `${AC6} the app's note "${note.text}" (request ${note.request}) to session ${s.id}, sent as session.note over an app connection with the control token, must be taken, not refused; the hub replied ${JSON.stringify(reply).slice(0, 800)}`).toBeUndefined();
  expect(reply.result?.request, `${AC6} session.note's result must name the note's request ID ${note.request}; it was ${JSON.stringify(reply.result).slice(0, 400)}`).toBe(note.request);
}

/** A session's user.ask events, in log order. */
export const asksOf = async (hub: Hub, s: Session): Promise<Ev[]> => (await allEvents(hub)).filter((e) => e.kind === 'user.ask' && e.session === s.id);
export const asksShown = (asks: Ev[]) => JSON.stringify(asks.map((e) => ({ log_pos: e.log_pos, from: e.data.from, request: e.data.request, tasks: e.data.tasks, text: String(e.data.text).slice(0, 300) })));
/** The event as user.ask@1 reads it: only the top-level fields the schema lists. */
export function asRecorded(e: Ev): Line {
  const props = Object.keys((getSchema('user.ask@1') as { properties: Line }).properties);
  return Object.fromEntries(Object.entries(e).filter(([k]) => props.includes(k)));
}
/** The message every recording failure carries: it names the note's words and its request ID. */
const recordedAs = (note: Note, route: string, s: Session) => `${AC6} the app's note "${note.text}" (request ${note.request}), ${route}, must be recorded as user.ask with from: app and request ${note.request} under session ${s.id}`;

/**
 * The record holds the note as the criterion says: one user.ask of the session with `from: app` and `request` its
 * request ID, whose text carries the note's words, valid under user.ask@1; never as `from: person` (the typed copy
 * comes later); and the request ID on no other user.ask. Waits up to 30 s for it.
 */
export async function expectAppNote(hub: Hub, s: Session, note: Note, route: string): Promise<Ev> {
  const found = await waitFor(async () => (await asksOf(hub, s)).find((e) => e.data.from === 'app' && e.data.request === note.request), 30_000, 'the note').catch(() => undefined);
  const asks = await asksOf(hub, s);
  expect(found, `${recordedAs(note, route, s)}; the session's user.ask events: ${asksShown(asks)}`).toBeDefined();
  const ev = found!;
  expect(String(ev.data.text), `${recordedAs(note, route, s)}, its text carrying the note's words; it was recorded with ${asksShown([ev])}`).toContain(note.text);
  const asPerson = asks.filter((e) => e.data.from === 'person' && String(e.data.text).includes(note.text));
  expect(asPerson.map((e) => e.id), `${AC6} the app's words "${note.text}" (request ${note.request}) must never be recorded from: person; session ${s.id}'s user.ask events: ${asksShown(asks)}`).toEqual([]);
  const sameRequest = (await allEvents(hub)).filter((e) => e.kind === 'user.ask' && e.data.request === note.request);
  expect(sameRequest.map((e) => e.id), `${AC6} the note with request ${note.request} must be recorded once; user.ask events with that request: ${asksShown(sameRequest)}`).toEqual([ev.id]);
  const valid = validate('user.ask@1', asRecorded(ev));
  expect(valid.ok, `${AC6} the note's user.ask (request ${note.request}) must pass user.ask@1: ${JSON.stringify(valid.ok ? [] : valid.issues).slice(0, 800)}`).toBe(true);
  return ev;
}

/**
 * "Opens a task as a typed prompt would" (#303's reading): the user.ask names one task in `tasks`, and a task.created
 * with that task_ref is in the record under the session's thread. Waits up to 30 s for the task.created.
 */
export async function expectTask(hub: Hub, idle: Idle, ev: Ev, what: string): Promise<void> {
  const tasks = (Array.isArray(ev.data.tasks) ? ev.data.tasks : []) as string[];
  expect(tasks.length, `${AC6} ${what} asks for changed behavior, so it must open one task as a typed prompt would: its user.ask records tasks ${JSON.stringify(ev.data.tasks)}`).toBe(1);
  const created = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'task.created' && e.data.task_ref === tasks[0]), 30_000, `the task.created of ${tasks[0]}`).catch(() => undefined);
  expect(created, `${AC6} ${what} must open its task ${tasks[0]}: a task.created with that task_ref, as a typed prompt's; none is in the record`).toBeDefined();
  expect(created!.data.thread, `${AC6} ${what}'s task ${tasks[0]} must open under session ${idle.s.id}'s thread`).toBe(idle.thread);
}

/**
 * The same words written into the session's terminal by this test process (a prompt typed, `turnOrigin: human`) are
 * recorded, and never `app`: each user.ask of the session after `after` whose text is the words has no `from: app`
 * and no request ID. As a typed prompt asking for a change, it opens a task (the control).
 */
export async function typedCopy(w: World, idle: Idle, note: Note, after: number): Promise<Ev[]> {
  const typed = await waitFor(async () => {
    const found = (await asksOf(w.hub, idle.s)).filter((e) => e.log_pos > after && e.data.text === note.text);
    return found.length ? found : undefined;
  }, 30_000, 'the typed copy').catch(() => [] as Ev[]);
  const asks = await asksOf(w.hub, idle.s);
  expect(typed.length, `${AC6} the words "${note.text}" written into session ${idle.s.id}'s terminal by the test process must be recorded as a user.ask; the session's user.ask events: ${asksShown(asks)}`).toBeGreaterThan(0);
  for (const e of typed) {
    expect(e.data.from, `${AC6} the words "${note.text}" written into session ${idle.s.id}'s terminal by the test process must never be recorded from: app (the note's request is ${note.request}); recorded ${asksShown([e])}`).not.toBe('app');
    expect(e.data.request, `${AC6} the words "${note.text}" written into session ${idle.s.id}'s terminal by the test process must carry no request ID (the note's is ${note.request}); recorded ${asksShown([e])}`).toBeUndefined();
  }
  return typed;
}
export const lastPos = async (hub: Hub): Promise<number> => { const all = await allEvents(hub); return all.length ? all[all.length - 1]!.log_pos : 0; };
/** Types the words into the terminal as you would, with the turn's end after it. */
export async function typeWords(idle: Idle, text: string): Promise<Fired> {
  typedPrompt(idle.s, text);
  const fired = await idle.claude.hook('UserPromptSubmit', payload(idle.s, 'UserPromptSubmit', { prompt: text }));
  assistantSays(idle.s, 'Noted.');
  await idle.claude.hook('Stop', payload(idle.s, 'Stop', { last_assistant_message: 'Noted.' }));
  return fired;
}

/** A wrong program's failure message; BLOCKED (its hub not starting, say) is rethrown, never taken for its failure. */
export async function failureOf(scenario: () => Promise<unknown>): Promise<string> {
  try {
    await scenario();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^BLOCKED/.test(message)) throw error;
    return message;
  }
  return '';
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The failure the criterion names: the recording assertion, naming the note's words and request ID. */
export const namesTheMessage = (note: Note): RegExp => new RegExp(`${escape(AC6)} the app's (note "${escape(note.text)}" \\(request ${note.request}\\).*must be recorded as user\\.ask with from: app|words "${escape(note.text)}" \\(request ${note.request}\\) must never be recorded from: person)`);
