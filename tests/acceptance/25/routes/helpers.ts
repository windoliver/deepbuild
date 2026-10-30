// Shared test-side tools for issue #25's route criteria (README): temp homes with stubbed system tools, `deep setup`
// through the built CLI, Claude Code's user settings and DeepBuild's entries in it, the hub as a process with its
// socket's line protocol, the Claude Code stand-in (fixtures/claude.mjs), a session that asks through `deep_ask` and
// stops, your answer through `deep inbox answer`, the transcript, the process table, and the p95 judgement. Parts are
// adapted from tests/acceptance/18/install/helpers.ts (same repo, same license); this suite keeps its own copy so a
// redraft of theirs never moves these tests. Nothing here stands in for DeepBuild: every test reaches it through the
// CLI, deep-hook and the waiter as the settings run them, the hub's socket and the files under the temporary home.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

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
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });
export const tag = (n = 6) => randomBytes(n).toString('hex');
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh25r-'));
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
export interface Proc { pid: number; ppid: number; pgid: number; rssKb: number; stat: string; command: string }
/** Every process on the machine, from `ps`: its group, resident size in KB and state. */
export function processes(): Proc[] {
  const text = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,rss=,stat=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return text.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), rssKb: Number(m[4]), stat: m[5]!, command: m[6]! }] : [];
  });
}
/** The live (not zombie) processes of a process group. */
export const groupOf = (pgid: number, table: Proc[] = processes()): Proc[] => table.filter((p) => p.pgid === pgid && !p.stat.startsWith('Z'));
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
/** Stops every process this suite started, and every member of the process groups its stand-ins started (SIGTERM, then SIGKILL), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  const groups = [...startedGroups];
  for (const pgid of groups) try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ }
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while (([...owned].some(alive) || groups.some((g) => groupOf(g).length)) && Date.now() < deadline) await sleep(100);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  for (const pgid of groups) try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  startedGroups.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
/** Process groups the stand-ins started for hook entries (each entry runs in its own group, as the stand-in's pid). */
const startedGroups = new Set<number>();

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, no DEEP_ setting or billing key of this process's. */
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
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; ended: number }
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
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/** `deep <args>` from the built CLI, HOME the test's home. */
export function deep(home: string, args: readonly string[], o: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(home, o.env), timeoutMs: o.timeoutMs ?? 180_000 });
}

// ---- deep-hook: setup names the path its entries run; one that is missing is built once, or the test is BLOCKED.
const builds = new Map<string, Promise<void>>();
function cargoBuild(release: boolean): Promise<void> {
  const key = release ? 'release' : 'debug';
  let made = builds.get(key);
  if (!made) {
    const args = ['build', '--locked', '-q', '-p', 'deep-hook', ...(release ? ['--release'] : [])];
    made = run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => {
      if (r.code !== 0) throw Error(`BLOCKED: cargo ${args.join(' ')} failed: ${r.stderr.slice(-3000)}`);
    });
    builds.set(key, made);
  }
  return made;
}
/** Builds every deep-hook binary of this checkout that an entry of DeepBuild's names and that is missing; BLOCKED if it still is. */
export async function ensureBinaries(settings: Line): Promise<void> {
  for (const { hook } of deepEntries(settings)) {
    for (const path of String(hook.command).match(/\/[^\s'"]*deep-hook\b/g) ?? []) {
      if (existsSync(path)) continue;
      if (path === join(REPO, 'target/release/deep-hook')) await cargoBuild(true);
      else if (path === join(REPO, 'target/debug/deep-hook')) await cargoBuild(false);
      if (!existsSync(path)) throw Error(`BLOCKED: DeepBuild's entry runs ${path}, which doesn't exist: ${hook.command}`);
    }
  }
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
export interface Entry { event: string; group: number; index: number; matcher: unknown; hook: Line }
export function entries(settings: Line): Entry[] {
  const hooks = (settings.hooks ?? {}) as Record<string, Line[]>;
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((group, g) =>
    (Array.isArray(group?.hooks) ? group.hooks : []).map((hook: Line, index: number) => ({ event, group: g, index, matcher: group.matcher, hook }))));
}
export const deepEntries = (settings: Line): Entry[] => entries(settings).filter((e) => isDeepBuild(e.hook.command));
/**
 * DeepBuild's waiter entries: its entries with asyncRewake, one under Stop and one under StopFailure, with the same
 * command and timeout (issue #25 and design, amended Oct 29: "a turn that ends on an API error fires only
 * StopFailure"). A setup that writes the waiter under Stop only fails here, naming that cause.
 */
export function waiterEntries(settings: Line): { stop: Entry; failure: Entry } {
  const found = deepEntries(settings).filter((e) => e.hook.asyncRewake === true);
  const shownAll = JSON.stringify(deepEntries(settings).map((e) => ({ event: e.event, ...e.hook })));
  const stop = found.filter((e) => e.event === 'Stop');
  const failure = found.filter((e) => e.event === 'StopFailure');
  const elsewhere = found.filter((e) => e.event !== 'Stop' && e.event !== 'StopFailure');
  if (stop.length === 1 && failure.length === 0 && elsewhere.length === 0) throw Error(`setup wrote the waiter's entry under Stop only: a turn that ends on an API error fires only StopFailure, so setup must also write it under StopFailure, with the same command and timeout: ${shownAll}`);
  if (stop.length !== 1 || failure.length !== 1 || elsewhere.length !== 0) throw Error(`setup must write DeepBuild's asyncRewake waiter entry once under Stop and once under StopFailure, and nowhere else, into ~/.claude/settings.json; found ${stop.length} under Stop, ${failure.length} under StopFailure, ${elsewhere.length} elsewhere: ${shownAll}`);
  const [a, b] = [stop[0]!.hook, failure[0]!.hook];
  if (a.command !== b.command || a.timeout !== b.timeout) throw Error(`setup must write the waiter's entry under Stop and under StopFailure with the same command and timeout: Stop ${JSON.stringify(a)}, StopFailure ${JSON.stringify(b)}`);
  return { stop: stop[0]!, failure: failure[0]! };
}

/** `deep setup` with HOME the test's home, a hub already answering; fails with the command's output unless it exits 0. */
export async function setup(home: string, env: Record<string, string | undefined> = {}): Promise<Ran> {
  const r = await deep(home, ['setup'], { env });
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  if (!existsSync(settingsFile(home))) throw Error(`BLOCKED: deep setup exited 0 but wrote no ${settingsFile(home)}: ${shown(r)}`);
  await ensureBinaries(readSettings(home));
  return r;
}
/** Your settings, <home>/.deepbuild/config.json (the asks block is where each kind's deadline lives, #318). */
export function editConfig(home: string, edit: (config: Line) => void): void {
  const file = join(rootOf(home), 'config.json');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const config = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? {}) : {};
  edit(config);
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

// ---- The hub as a process: `deep hub run`, HOME the test's home (#16).
export interface Hub { pid: number; home: string; socket: string; root: string; child: ChildProcess; output(): string }
export interface HubOptions { plant?: string | undefined; clock?: number | undefined }
export async function startHub(home: string, o: HubOptions = {}): Promise<Hub> {
  const env = childEnv(home, { DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_CLOCK: o.clock === undefined ? undefined : String(Math.round(o.clock)) });
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
  if (!ready) throw Error(`BLOCKED: the hub didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), root: rootOf(home), child, output: () => out };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (alive(hub.pid)) await sleep(50);
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
/** Polls until probe gives a value, or fails naming what it waited for. */
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(200);
  }
}

// ---- Sessions, their hook payloads and their transcripts, shaped like the corpus's (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
export function newSession(home: string): Session {
  const id = randomUUID();
  const cwd = join(dirname(home), `w${tag(3)}`);
  mkdirSync(cwd, { recursive: true });
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
    // A turn that ends on an API error (facts: StopFailure requires `error`), one with no automatic continue (API_ERROR).
    case 'StopFailure': Object.assign(base, { error: API_ERROR, last_assistant_message: `API Error: ${API_ERROR}` }); break;
    case 'SessionEnd': Object.assign(base, { reason: 'other' }); break;
    default: break;
  }
  return { ...base, ...extra };
}
/**
 * The API error the tests' StopFailure turns end on. Not `overloaded` or `rate_limit`: the facts map those to
 * rate_limited, a transient cause, and the design gives a transient stop one automatic continue, which a correct hub
 * sends through the session's waiter, so the waiter would wake the session before your answer. Not
 * `authentication_failed` either: a sign-in problem raises an unblock task whose closing resumes the session the same
 * way. `invalid_request` is a value Claude Code's hooks reference lists that the facts map to no cause (unknown), and an
 * unknown cause gets nothing: the session stays stopped and idle, its waiter waiting (design: Tasks close themselves).
 */
export const API_ERROR = 'invalid_request';
/** The synthetic assistant entry Claude Code writes for a turn's API error (facts: stop.cause.errors, model <synthetic>). */
export function apiError(s: Session, error = API_ERROR): void {
  appendTranscript(s, { type: 'assistant', isApiErrorMessage: true, error, message: { model: '<synthetic>', id: randomUUID(), type: 'message', role: 'assistant', content: [{ type: 'text', text: `API Error: ${error}` }], stop_reason: 'stop_sequence', usage: { input_tokens: 0, output_tokens: 0 } } });
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
export const transcriptEntries = (s: Session): Line[] => jsonLines(readFileSync(s.transcript, 'utf8'));
/** Whether an entry holds a tool call or its result: the agent's own deep_ask call and reply name its ask, and aren't a delivery. */
const isToolEntry = (e: Line): boolean => Array.isArray(e.message?.content) && e.message.content.some((c: Line) => c?.type === 'tool_use' || c?.type === 'tool_result');
/** The transcript entries that carry one of `ids` (the answer's ID: its ask's or its answer event's), tool calls and results aside. */
export const carriers = (s: Session, ids: string[]): Line[] => transcriptEntries(s).filter((e) => !isToolEntry(e) && ids.some((id) => JSON.stringify(e).includes(id)));

// ---- The Claude Code stand-in (fixtures/claude.mjs): one process per session.
export interface HookRun { command: string; async: boolean; asyncRewake: boolean; timeout: number; pid: number; session: string; started: number; ended: number | null; code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; expired: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; blocked?: string; settingsError?: string }
export interface Wake { pid: number; session: string; event?: string; code: number; at: number; stderr: string; dropped?: boolean; started?: number; prompt?: string; promptId?: string; fired?: Fired }
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
  get pid(): number { return this.child.pid!; }
  /** Claude Code for one session, HOME the test's home; `env` is added to what its hooks and its deep mcp get. */
  static start(home: string, env: Record<string, string | undefined> = {}): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), CLI, FACTS], { cwd: dirname(home), env: childEnv(home, env), stdio: ['pipe', 'pipe', 'inherit'] });
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
    for (const r of fired.background) startedGroups.add(r.pid);
    for (const r of fired.ran) startedGroups.add(r.pid);
    return fired;
  }
  async background(): Promise<(HookRun & { event: string })[]> { return (await this.send({ op: 'background' })).background as (HookRun & { event: string })[]; }
  async expire(seconds: number): Promise<(HookRun & { event: string })[]> { return (await this.send({ op: 'expire', seconds })).stopped as (HookRun & { event: string })[]; }
  async configure(o: { wake: boolean }): Promise<void> { await this.send({ op: 'configure', ...o }); }
  /** The session ends: Claude Code stops its deep mcp and exits, leaving its background entries to end on their own. */
  async end(): Promise<void> {
    const gone = new Promise<void>((resolve) => { if (this.exited) resolve(); else this.child.once('exit', () => resolve()); });
    await this.send({ op: 'end' }).catch(() => undefined);
    await gone;
  }
  /** Claude Code killed (SIGKILL): nothing of it runs on, and nothing it started is stopped. */
  async kill(): Promise<void> {
    const gone = new Promise<void>((resolve) => { if (this.exited) resolve(); else this.child.once('exit', () => resolve()); });
    this.child.kill('SIGKILL');
    await gone;
  }
  /** One JSON-RPC request to this session's own `deep mcp`. */
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const id = `${method}#${++this.rpc}`;
    const r = await this.send({ op: 'mcp', line: { jsonrpc: '2.0', id, method, params }, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    await this.send({ op: 'mcp', line: { jsonrpc: '2.0', method, params } });
  }
  async initialize(): Promise<void> {
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-25-routes', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.notify('notifications/initialized');
  }
  /** The live asyncRewake runs of DeepBuild's waiter for a session: started by a hook, not yet exited, with a live process in their group. */
  async liveWaiters(session: string): Promise<(HookRun & { event: string })[]> {
    const table = processes();
    return (await this.background()).filter((r) => r.asyncRewake && isDeepBuild(r.command) && r.session === session && r.ended === null && groupOf(r.pid, table).length > 0);
  }
}
/** The runs of DeepBuild's entries among a hook's. */
export const ours = (f: Fired): HookRun[] => [...f.ran, ...f.background].filter((r) => isDeepBuild(r.command));
export const firedShown = (f: Fired) => JSON.stringify({ blocked: f.blocked, runs: [...f.ran, ...f.background].map((r) => ({ command: r.command.slice(0, 160), code: r.code, signal: r.signal, timedOut: r.timedOut, stdout: r.stdout.slice(0, 600), stderr: r.stderr.slice(0, 600) })) });

// ---- A session that asks you something through deep_ask and stops (README: An asking session).
export interface Option { id: string; label: string }
export interface Asking { s: Session; claude: Claude; handle: string; id: string; question: string; blue: Option; green: Option }
/**
 * A session of its own Claude Code: it starts, you type a prompt, the agent calls `deep_ask` (a choice between two
 * options, blue recommended) and Claude Code waits for the call as it waits for any tool call, until deep_ask says
 * it's still waiting; then its PostToolUse, the agent's last words. The session hasn't stopped yet.
 */
export async function askingSession(hub: Hub, home: string, env: Record<string, string | undefined> = {}): Promise<Asking> {
  return (await beginAsk(hub, home, env)).finish();
}
/**
 * The first half of an asking session: up to the deep_ask call filing its ask (the call still running); `finish`
 * waits for the call's reply and ends the turn's work. Sessions are begun one at a time and finished together, so
 * twenty of them don't start their hooks all at once on a loaded machine.
 */
export async function beginAsk(hub: Hub, home: string, env: Record<string, string | undefined> = {}): Promise<{ finish: () => Promise<Asking> }> {
  const s = newSession(home);
  const claude = Claude.start(home, env);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Pick a header colour, then stop.');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Pick a header colour, then stop.' }));
  await claude.initialize();
  const t = tag(4);
  const blue = { id: `blue${t}`, label: `Blue header ${t}` };
  const green = { id: `green${t}`, label: `Green header ${t}` };
  const question = `Which header colour for ${t}?`;
  const args = { kind: 'choice', question, options: [blue, green], recommended: blue.id };
  const call = callId();
  appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: 'mcp__deep__deep_ask', input: args }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
  await claude.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: call }));
  let replied: Line | undefined;
  const replying = claude.request('tools/call', { name: 'deep_ask', arguments: args }, 120_000).then((r) => (replied = r), (error: Error): Line => (replied = { error: error.message }));
  const created = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === question), 60_000, `the deep_ask "${question}" filed under ${s.id}`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}; deep_ask replied ${JSON.stringify(replied ?? 'nothing yet').slice(0, 1500)}`); });
  return {
    finish: async () => {
      const reply = await replying;
      const content = JSON.stringify(reply.result?.content ?? reply.error ?? reply);
      appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content }] } });
      await claude.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: call, tool_response: reply.result ?? {} }));
      assistantSays(s, 'I asked which header colour you want; I will wait for your answer.');
      return { s, claude, handle: `ask:${created.id}`, id: created.id, question, blue, green };
    },
  };
}
/** Your answer, given with `deep inbox answer` (#24, the OS confirmation stubbed); resolves when the command has exited 0. */
export async function answer(home: string, handle: string, option: string, plant?: string): Promise<Ran> {
  const r = await deep(home, ['inbox', 'answer', handle, option], { env: plant ? { DEEP_HUB_PLANT: plant } : {} });
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ${handle} ${option} must exit 0: ${shown(r)}`);
  return r;
}
/** The record's delivery outcomes for an ask (delivery.outcome@1), in log order. */
export async function outcomes(hub: Hub, id: string): Promise<Ev[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'delivery.outcome' && (e.subject === `ask:${id}` || String(e.data?.delivery ?? '').replace(/^ask:/, '') === id));
}
/** The IDs an answer is known by: its ask's, and its ask.answered event's once there is one. */
export async function answerIds(hub: Hub, id: string): Promise<string[]> {
  const answered = (await allEvents(hub)).filter((e) => e.kind === 'ask.answered' && e.subject === `ask:${id}`).map((e) => e.id);
  return [id, ...answered];
}
/** Whether a text carries a given option of an ask, by its label or its ID. */
export const carries = (text: string, o: Option): boolean => text.includes(o.label) || text.includes(o.id);

// ---- Timing (README: Timing): p95 over the samples, and the machine's load when it misses.
export function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)]!;
}
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
/**
 * PASS when the p95 is within the limit. A miss on a machine loaded past its core count is INCONCLUSIVE (a skip that
 * says so, with the load), never PASS; a miss on a machine that isn't is a FAIL.
 */
export function judgeP95(ctx: TestContext, name: string, samples: number[], limitMs: number): void {
  const value = p95(samples);
  const text = `${name}: p95 ${value.toFixed(0)} ms over ${samples.length} samples (${samples.map((v) => v.toFixed(0)).join(', ')} ms) against ${limitMs} ms`;
  console.log(text);
  if (value <= limitMs) return;
  const busy = loadavg()[0]! > availableParallelism();
  if (busy) ctx.skip(`INCONCLUSIVE ${text}, read at ${loadReading()}`);
  throw Error(`FAIL ${text}, at ${loadReading()}`);
}

// ---- Idle sessions and how soon an answer wakes them (AC2, AC6).
/**
 * `n` sessions, each of its own Claude Code, asking through deep_ask at once and stopping: each stop's hold ends with
 * no answer, so each session is idle, its waiter waiting.
 */
export async function idleSessions(hub: Hub, home: string, n: number, env: Record<string, string | undefined> = {}): Promise<Asking[]> {
  const begun = [];
  for (let i = 0; i < n; i++) begun.push(await beginAsk(hub, home, env));
  const sessions = await Promise.all(begun.map((b) => b.finish()));
  const stops = await Promise.all(sessions.map((a) => a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }))));
  stops.forEach((fired, i) => {
    if (fired.blocked) throw Error(`nothing is answered yet, so ${sessions[i]!.s.id}'s stop goes through: ${firedShown(fired)}`);
  });
  for (const a of sessions) await waitFor(async () => (await a.claude.liveWaiters(a.s.id)).length > 0 || undefined, 30_000, `the waiter of ${a.s.id}, waiting once its Stop went through`);
  return sessions;
}
export interface Woken { session: string; ms: number; wake: Wake }
/**
 * Answers each session's ask in turn with `deep inbox answer` and waits up to 30 s for that session to wake: the time
 * from the answer command's exit (your answer recorded) to the start of the wake's turn at Claude Code's side. A
 * session that never wakes, or wakes with a turn that doesn't carry its answer, fails at once, naming it.
 */
export async function answerEach(ac: string, home: string, sessions: Asking[], plant?: string): Promise<number[]> {
  const out: number[] = [];
  for (const [i, a] of sessions.entries()) {
    const r = await answer(home, a.handle, a.green.id, plant);
    const wake = await waitFor(() => a.claude.wakes.find((w) => w.session === a.s.id && !w.dropped), 30_000, `${a.s.id} waking`).catch(() => undefined);
    if (!wake) throw Error(`${ac} idle session ${a.s.id} (${i + 1} of ${sessions.length} answered) never woke within 30 s of its answer to ${a.handle}`);
    if (!carries(wake.prompt ?? '', a.green)) throw Error(`${ac} a wake's turn must carry the session's answer; ${a.s.id}'s prompt was ${JSON.stringify(wake.prompt ?? '').slice(0, 400)}`);
    out.push(Math.max(0, (wake.started ?? wake.at) - r.ended));
  }
  return out;
}
