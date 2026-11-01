// Shared test-side tools for issue #25's fallback criteria (README): temp homes with stubbed system tools, `deep setup`
// through the built CLI, the hub as a process with its socket's line protocol, your answers through `deep inbox
// answer`, and the Claude Code stand-in (fixtures/claude.mjs). Adapted from tests/acceptance/18/install/helpers.ts
// (same repo, same license); this suite keeps its own copy so a redraft of theirs never moves these tests. Nothing here
// stands in for DeepBuild: every test reaches it through the CLI, deep-hook as the settings run it, the hub's socket
// and the files under the temporary home.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const NODE = process.execPath;
export const SECOND = 1000;
export const MINUTE = 60_000;

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
export const tag = (n = 4) => randomBytes(n).toString('hex');
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh25f-'));
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
/**
 * The environment a child gets: HOME the test's home, the stand-ins first on PATH, no DEEP_ setting or billing key of
 * this process's. DEEP_HUB_PLANT passes through from the runner, so the before lane can run this suite against a plant.
 */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.SHELL = '/bin/sh';
  env.PATH = `${binOf(home)}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  env.DEEP_HUB_TEST_CONFIRM = join(dirname(home), 'confirm');
  if (process.env.DEEP_HUB_PLANT) env.DEEP_HUB_PLANT = process.env.DEEP_HUB_PLANT;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
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
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/** `deep <args>` from the built CLI, HOME the test's home. */
export function deep(home: string, args: readonly string[], o: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(home, o.env), timeoutMs: o.timeoutMs ?? 180_000 });
}

// ---- deep-hook: built once per test process; setup names the path its entries run.
let built: Promise<void> | undefined;
function cargoBuild(release: boolean): Promise<void> {
  const args = ['build', '--locked', '-q', '-p', 'deep-hook', ...(release ? ['--release'] : [])];
  return run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: cargo ${args.join(' ')} failed: ${r.stderr.slice(-3000)}`);
  });
}

// ---- Claude Code's user settings and DeepBuild's entries in it (README: DeepBuild's entries).
export function readSettings(home: string): Line {
  const text = readFileSync(settingsFile(home), 'utf8');
  const parsed = parseObject(text);
  if (!parsed) throw Error(`${settingsFile(home)} is no longer a JSON object: ${text.slice(0, 500)}`);
  return parsed;
}
/** Whether a hook command is DeepBuild's: it runs deep-hook, or the deep CLI (by its built file or as `deep`). */
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
export interface Entry { event: string; matcher: unknown; hook: Line }
export function deepEntries(settings: Line): Entry[] {
  const hooks = (settings.hooks ?? {}) as Record<string, Line[]>;
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((group) =>
    (Array.isArray(group?.hooks) ? group.hooks : []).map((hook: Line) => ({ event, matcher: group.matcher, hook }))))
    .filter((e) => isDeepBuild(e.hook.command));
}

/**
 * `deep setup` with HOME the test's home, a hub already answering and launchctl and systemctl stubbed. Fails with the
 * command's output unless it exits 0 with one asyncRewake waiter entry of DeepBuild's; builds the deep-hook its
 * entries name.
 */
export async function setup(home: string): Promise<void> {
  const r = await deep(home, ['setup']);
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  const settings = readSettings(home);
  const waiters = deepEntries(settings).filter((e) => e.hook.asyncRewake === true);
  if (waiters.length !== 1) throw Error(`BLOCKED: setup must write one asyncRewake waiter entry of DeepBuild's; found ${waiters.length}: ${JSON.stringify(deepEntries(settings).map((e) => ({ event: e.event, ...e.hook })))}`);
  for (const { hook } of deepEntries(settings)) {
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
/** The hub, with the test-only send-back surface on (README: Additions). */
/**
 * Hub settings for two waits a test sits through only when it answers inside neither (#964): NO_ASK_WAIT gives the hub
 * a 30 s MCP tool timeout, so the deep_ask relation reads broken and deep_ask says "still waiting" at once, not after
 * 40 s; SHORT_HOLD ends a stop's hold with nothing answered after SHORT_HOLD_MS, not 60 s.
 */
export const SHORT_HOLD_MS = 5000;
export const NO_ASK_WAIT = { MCP_TOOL_TIMEOUT: '30000' };
export const SHORT_HOLD = { DEEP_HUB_TEST_STOP_HOLD_MS: String(SHORT_HOLD_MS) };
export async function startHub(home: string, env: Record<string, string | undefined> = {}): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_TEST_SEND_BACK: '1', ...env }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), root: rootOf(home), child, output: () => out };
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
export async function control<T>(hub: Hub, use: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await use(conn);
  } finally {
    conn.close();
  }
}
export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; seq?: string; subject?: string; session?: string; data: Line }
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
export const sessionRows = async (hub: Hub): Promise<Line[]> => (await control(hub, (conn) => conn.call('sessions.read'))).sessions as Line[];
export const inbox = async (hub: Hub): Promise<Line[]> => (await control(hub, (conn) => conn.call('inbox.read'))).asks as Line[];
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
/** Polls `probe` until it holds; resolves with whether it did. */
export async function eventually(probe: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}
/** The kinds a hook itself maps to: what a person is shown about a session is never one of these. */
export const HOOK_KINDS = new Set(['session.start', 'session.end', 'user.ask', 'tool.before', 'tool.after', 'permission.request', 'agent.stop', 'task.completed']);

/**
 * What a person sees about a session or an ask (README: The view and a session's row): the session's row in
 * `sessions.read`, the inbox rows, and every event of the log that isn't a hook's own event and is about the session
 * (its `session`) or the ask (its subject, or its data naming the handle), each as JSON text.
 */
export async function viewTexts(hub: Hub, session: string, handle?: string): Promise<string[]> {
  const [rows, asks, events] = await Promise.all([sessionRows(hub), inbox(hub), allEvents(hub)]);
  const about = (text: string) => text.includes(session) || (handle !== undefined && text.includes(handle));
  return [
    ...rows.map((r) => JSON.stringify(r)).filter(about),
    ...asks.map((r) => JSON.stringify(r)).filter(about),
    ...events.filter((e) => !HOOK_KINDS.has(e.kind)).map((e) => JSON.stringify({ kind: e.kind, subject: e.subject, session: e.session, data: e.data })).filter(about),
  ];
}
/** The test-only send-back (README: Additions): the hub sends the session's next stop back with `reason`. */
export function sendBack(hub: Hub, session: string, reason: string): Promise<Line> {
  return control(hub, (conn) => conn.call('test.send_back', { session, reason })).catch((error: Error) => {
    throw Error(`the hub must plant a send-back for session ${session} through test.send_back, served with DEEP_HUB_TEST_SEND_BACK=1 (README: Additions): ${error.message}`);
  });
}
/** Your answer to an ask, by `deep inbox answer` (#24), the OS confirmation stubbed to confirm. */
export async function answer(home: string, handle: string, option: string): Promise<void> {
  const r = await deep(home, ['inbox', 'answer', handle, option]);
  if (r.code !== 0) throw Error(`deep inbox answer ${handle} ${option} must exit 0: ${shown(r)}`);
}
/** Every delivery.outcome event the log holds for an ask. */
export async function outcomes(hub: Hub, handle: string): Promise<Line[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'delivery.outcome' && (e.subject === handle || e.data?.delivery === handle)).map((e) => e.data);
}

// ---- Sessions and their hook payloads, shaped like the corpus's Claude Code payloads (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string; entrypoint?: string }
/** A session's ID, folder and transcript; `cwd` puts it in a worktree another session already works in. */
export function newSession(home: string, cwd?: string, id: string = randomUUID()): Session {
  const folder = cwd ?? join(dirname(home), `w${tag(3)}`);
  mkdirSync(folder, { recursive: true });
  const transcript = join(home, '.claude/projects', folder.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  if (!existsSync(transcript)) writeFileSync(transcript, '');
  return { id, cwd: folder, transcript };
}
export const callId = () => `toolu_${randomBytes(12).toString('hex')}`;
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt) base.prompt_id = s.prompt;
  switch (event) {
    case 'SessionStart': Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); delete base.prompt_id; break;
    case 'Stop': Object.assign(base, { last_assistant_message: 'Done.' }); break;
    case 'SessionEnd': Object.assign(base, { reason: 'other' }); break;
    default: break;
  }
  return { ...base, ...extra };
}
export function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: s.entrypoint ?? 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
/** The transcript entry Claude Code writes for a prompt you typed; returns its prompt ID, which the hooks of its turn carry. */
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
export interface StopOutcome { blocked: boolean; reasons: string[]; continued: boolean; overridden: boolean; count: number }
export interface Fired { ran: HookRun[]; background: HookRun[]; stop?: StopOutcome; stopHookActive?: boolean; settingsError?: string }
export interface Wake { at: number; stderr: string; woke: boolean; prompt: string | null; ran: HookRun[] }
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private rpc = 0;
  private constructor(private readonly child: ChildProcess, readonly home: string) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
    });
  }
  get pid(): number { return this.child.pid!; }
  get exited(): boolean { return this.child.exitCode !== null || this.child.signalCode !== null; }
  /**
   * Claude Code, one process, HOME the test's home. `args` are extra words on its command line, such as
   * `--resume <id>`, as a real `claude --resume <id>` carries them; `o` configures it (fixtures/claude.mjs).
   */
  static async start(home: string, o: { args?: string[]; wakes?: boolean; skip?: string[]; entrypoint?: string } = {}): Promise<Claude> {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), CLI, FACTS, ...(o.args ?? [])], { cwd: dirname(home), env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    const claude = new Claude(child, home);
    await claude.send({ op: 'configure', ...(o.wakes === undefined ? {} : { wakes: o.wakes }), ...(o.skip ? { skip: o.skip } : {}), ...(o.entrypoint ? { entrypoint: o.entrypoint } : {}) });
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
  async exec(command: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return (await this.send({ op: 'exec', command, cwd })) as unknown as { code: number; stdout: string; stderr: string };
  }
  /** Claude Code exits: the session's process and everything it started go. */
  async exit(): Promise<void> {
    await this.send({ op: 'exit' }).catch(() => undefined);
    const deadline = Date.now() + 10_000;
    while (!this.exited && Date.now() < deadline) await sleep(50);
  }
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const id = `${method}#${++this.rpc}`;
    const r = await this.send({ op: 'mcp', line: { jsonrpc: '2.0', id, method, params }, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async initialize(): Promise<void> {
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-25-fallbacks', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.send({ op: 'mcp', line: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
  }
  /**
   * A tool call of this session's deep mcp as Claude Code makes it: its PreToolUse (named `mcp__deep__<tool>`), the
   * call, then its PostToolUse with the call's result. Resolves with the reply and both hooks' runs.
   */
  async deepTool(s: Session, tool: string, args: Line, timeoutMs = 120_000): Promise<{ reply: Line; pre: Fired; post: Fired }> {
    const id = callId();
    const pre = await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args, tool_use_id: id }));
    const reply = await this.request('tools/call', { name: tool, arguments: args }, timeoutMs);
    const post = await this.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args, tool_use_id: id, tool_response: reply.result ?? reply.error ?? null }));
    return { reply, pre, post };
  }
  /** A Bash call, as Claude Code makes it: PreToolUse, the command as its child, PostToolUse. */
  async bash(s: Session, command: string): Promise<Fired[]> {
    const id = callId();
    const pre = await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command, description: 'List files' }, tool_use_id: id }));
    const ran = await this.exec(command, s.cwd);
    const post = await this.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: 'Bash', tool_input: { command, description: 'List files' }, tool_use_id: id, tool_response: { stdout: ran.stdout, stderr: ran.stderr, interrupted: false, isImage: false } }));
    return [pre, post];
  }
}
/** The runs of DeepBuild's entries among a hook's. */
export const ours = (f: Fired): HookRun[] => [...f.ran, ...f.background].filter((r) => isDeepBuild(r.command));
/** What DeepBuild's synchronous entries said back to a hook: their stdout and stderr, joined. */
export const said = (f: Fired): string => f.ran.filter((r) => isDeepBuild(r.command)).map((r) => `${r.stdout}\n${r.stderr}`).join('\n');
export const firedShown = (f: Fired) => JSON.stringify({ stop: f.stop, runs: [...f.ran, ...f.background].map((r) => ({ command: r.command.slice(-60), async: r.async, code: r.code, signal: r.signal, timedOut: r.timedOut, stdout: r.stdout.slice(0, 400), stderr: r.stderr.slice(0, 400) })) });

/** A question of the session's, raised by deep_ask; its options carry a tag no other text has. */
export interface Asked { handle: string; question: string; pick: { id: string; label: string }; other: { id: string; label: string }; reply: Promise<unknown> }
/**
 * The agent asks with `deep_ask` (#26) and the call runs on; resolves once the hub has the ask, with its handle. The
 * call's reply comes when the hub answers it, "waiting" past the agent's tool timeout or the answer.
 */
export async function ask(hub: Hub, claude: Claude, s: Session, word: string): Promise<Asked> {
  const t = tag(4);
  const pick = { id: `${word}${t}`, label: `Use ${word} ${t}` };
  const other = { id: `not${t}`, label: `Leave it ${t}` };
  const question = `Which way for ${word} ${t}?`;
  const reply = claude.deepTool(s, 'deep_ask', { kind: 'choice', question, options: [other, pick], recommended: other.id, steps: null, where: null, why: null, check: null }, 180_000);
  reply.catch(() => undefined);
  const created = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === question), 60_000, `the hub to record the deep_ask "${question}"`);
  return { handle: `ask:${created.id}`, question, pick, other, reply };
}
/** Whether a text carries an answer: the option it picked, by its label's tag or its ID. */
export const carries = (text: string, a: Asked) => text.includes(a.pick.label) || text.includes(a.pick.id);
/** Waits until the hub has recorded `n` Stops of the session: the stop being held is in. */
export async function stopsRecorded(hub: Hub, s: Session, n: number): Promise<void> {
  await waitFor(async () => (await allEvents(hub)).filter((e) => e.kind === 'agent.stop' && e.session === s.id).length >= n || undefined, 60_000, `the hub to record stop ${n} of session ${s.id}`);
}
/**
 * Waits until the hub's hold on a Stop is surely over: 1 s past the longest hold (60 s, or the hub's `holdMs`) from the
 * hook's start. On a loaded machine deep-hook can miss the hub's acknowledgement and let the stop through at once while
 * the hub still holds it; an answer given inside that window would go to the stop, not to the idle session.
 */
export async function pastHold(stop: Fired, holdMs = 60_000): Promise<void> {
  const started = Math.min(...stop.ran.map((r) => r.started));
  const wait = started + holdMs + 1000 - Date.now();
  if (wait > 0) await sleep(wait);
}
export const stopCount = async (hub: Hub, s: Session) => (await allEvents(hub)).filter((e) => e.kind === 'agent.stop' && e.session === s.id).length;
