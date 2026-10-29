// Shared test-side tools for issue #83 (README): temp homes with stubbed system tools, `deep setup` through the built
// CLI, the hub as a process with its socket's line protocol, the Claude Code stand-in (fixtures/claude.mjs, with its
// hook log), Codex's hooks run as Codex runs them (deep-hook codex <event>), a session's claim through `deep_claim`,
// the planted verdict (`test.verdict`), the receipt (`changes.read`), the forge stand-in, and the reference-Mac gate.
// Parts are adapted from tests/acceptance/25/routes/helpers.ts and tests/acceptance/25/live/helpers.ts and measure.ts
// (same repo, same license); this suite keeps its own copy so a redraft of theirs never moves these tests. Nothing here
// stands in for DeepBuild: every test reaches it through the CLI, deep-hook as the settings run it, the hub's socket
// and the files under the temporary home.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const GOLDENS = fileURLToPath(new URL('./goldens/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const NODE = process.execPath;
export const WIDTH = 80;

/** The criteria these files prove, each named by its number in the issue's order and its ID (README: Criteria to tests). */
export const AC1 = 'AC1 #83.8a03aacc';
export const AC2 = 'AC2 #83.5bcede40';
export const AC3 = 'AC3 #83.fd11082e';
export const AC4 = 'AC4 #83.4b0836ba';
export const AC5 = 'AC5 #83.87a5093c';
export const AC6 = 'AC6 #83.eb2dc033';
export const AC7 = 'AC7 #83.28c3309c';
export const AC8 = 'AC8 #83.89bfa3a4';
export const AC9 = 'AC9 #83.e8038389';
export const AC10 = 'AC10 #83.09932b63';
export const AC11 = 'AC11 #83.15ee3b42';
export const AC12 = 'AC12 #83.b4c17e65';

/** The words a state may be named with (design: States people see); no other word names one. */
export const STATE_WORDS = ['queued', 'working', 'says done', 'PASS', 'sent back', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'needs you', 'stale', 'quiet'] as const;
export const OUTCOME_WORDS = ['PASS', 'sent back', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'] as const;
/** The next step's owner, as the line names it (README: Defined here, the line). */
export const OWNER = /\bnext: (agent|you|service|DeepBuild)\b/;

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
export const tag = (n = 4) => randomBytes(n).toString('hex');
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
export const CODEX_COVERED = (() => { const v = (JSON.parse(readFileSync(join(REPO, 'adapters/codex.facts.json'), 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

// ---- A checkout whose built CLI and deep-hook a test drives: this one, or the merge base's (budgets.test.ts).
export interface Checkout { label: string; root: string; cli: string; hook: string }
export const CURRENT: Checkout = { label: 'this checkout', root: REPO, cli: join(REPO, 'packages/cli/dist/main.js'), hook: join(REPO, 'target/debug/deep-hook') };

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh83-'));
  made.push(dir);
  return dir;
}
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts. `<tmp>/bin` comes first on PATH with stand-ins for
 * launchctl, systemctl, claude and codex (each logs its call and exits 0) and a `deep` that runs the checkout's built
 * CLI. `<tmp>/confirm` holds `confirmed` (the OS confirmation stubbed, #24). `<tmp>/hooks.jsonl` is the hook log.
 */
export interface Home { tmp: string; home: string; bin: string; hookLog: string; co: Checkout }
export function makeHome(co: Checkout = CURRENT): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
  mkdirSync(bin);
  for (const name of ['launchctl', 'systemctl', 'claude', 'codex']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  writeFileSync(join(bin, 'codex.version'), `${CODEX_COVERED}\n`);
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${co.cli}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  return { tmp, home, bin, hookLog: join(tmp, 'hooks.jsonl'), co };
}
export const rootOf = (h: Home) => join(h.home, '.deepbuild');
export const settingsFile = (h: Home) => join(h.home, '.claude', 'settings.json');

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
export function own(pid: number | undefined): void { if (pid) owned.add(pid); }
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
const closers: (() => void)[] = [];
/** Process groups the stand-in started for hook entries (each entry runs in its own group, as the entry's shell pid); the waiter among them. */
const startedGroups = new Set<number>();
/** Stops every process this suite started and every group its stand-ins started for hook entries (SIGTERM, then SIGKILL), closes its servers and removes its temp folders. */
export async function cleanup(): Promise<void> {
  for (const close of closers.splice(0)) close();
  for (const pgid of startedGroups) try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ }
  for (const pid of owned) for (const target of [pid, -pid]) try { process.kill(target, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) for (const target of [pid, -pid]) try { process.kill(target, 'SIGKILL'); } catch { /* gone */ }
  for (const pgid of startedGroups) try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  startedGroups.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'];
/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, no DEEP_, CLAUDE, forge or billing variable of this process's. */
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

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; started: number; ended: number }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const started = Date.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, started, ended: Date.now() }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
/** `deep <args>` from the home's checkout, HOME the test's home. */
export function deep(h: Home, args: readonly string[], env: Record<string, string | undefined> = {}, timeoutMs = 180_000): Promise<Ran> {
  return run(NODE, [h.co.cli, ...args], { env: childEnv(h, env), timeoutMs, cwd: h.co.root });
}

// ---- Claude Code's user settings and DeepBuild's entries in it.
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
 * `deep setup` with HOME the test's home, a hub already answering and launchctl/systemctl stubbed. Fails with the
 * command's output unless it exits 0; BLOCKED when an entry names a deep-hook that isn't there (never built here).
 */
export async function setup(h: Home, env: Record<string, string | undefined> = {}): Promise<void> {
  const r = await deep(h, ['setup'], env);
  if (r.code !== 0) throw Error(`BLOCKED: deep setup (${h.co.label}) must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  for (const { hook } of deepEntries(readSettings(h))) {
    for (const path of String(hook.command).match(/\/[^\s'"]*deep-hook\b/g) ?? []) {
      if (!existsSync(path)) throw Error(`BLOCKED: DeepBuild's entry runs ${path}, which doesn't exist (build it with cargo build -p deep-hook): ${hook.command}`);
    }
  }
}

// ---- The hub as a process: `deep hub run`, HOME the test's home (#16). Every hub serves test.verdict (README: Additions, 1).
export interface Hub { pid: number; h: Home; socket: string; root: string; child: ChildProcess; output(): string }
export interface HubOptions { plant?: string | undefined; forge?: string | undefined }
export async function startHub(h: Home, o: HubOptions = {}): Promise<Hub> {
  const env = childEnv(h, { DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_VERDICT: '1', DEEP_HUB_TEST_FORGE: o.forge, ...(o.forge ? { GH_TOKEN: 'test-forge-token' } : {}) });
  const child = spawn(NODE, [h.co.cli, 'hub', 'run'], { cwd: h.co.root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  if (!ready) throw Error(`BLOCKED: the hub (${h.co.label}) didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${out.slice(0, 2000)}`);
  const root = rootOf(h);
  return { pid: child.pid!, h, socket: join(root, 'hub.sock'), root, child, output: () => out };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (alive(hub.pid)) await sleep(50);
}
/** A hub with `deep setup` run against it: the home's Claude Code settings hold DeepBuild's entries. */
export async function hubWithSetup(h: Home, o: HubOptions = {}): Promise<Hub> {
  const hub = await startHub(h, o);
  await setup(h);
  return hub;
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
export const ofSession = (events: readonly Ev[], session: string, kind?: string): Ev[] => events.filter((e) => e.session === session && (kind === undefined || e.kind === kind));
/** The open asks in your inbox (`inbox.read`): the Needs-you count is their number. */
export const inboxRead = (hub: Hub): Promise<Line[]> => control(hub, async (conn) => (await conn.call('inbox.read')).asks as Line[]);
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

// ---- Sessions, their hook payloads and their transcripts, shaped like the corpus's (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string; agent: 'claude-code' | 'codex'; turn?: string }
/** A fresh session: a work folder of its own, a git repo there when `remote` names its origin (README: The repo). */
export function newSession(h: Home, o: { remote?: string; agent?: 'claude-code' | 'codex' } = {}): Session {
  const id = randomUUID();
  const cwd = join(h.tmp, `w${tag(3)}`);
  mkdirSync(cwd, { recursive: true });
  if (o.remote) initRepo(h, cwd, o.remote);
  const agent = o.agent ?? 'claude-code';
  const transcript = agent === 'codex'
    ? join(h.home, '.codex/sessions', `rollout-${id}.jsonl`)
    : join(h.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript, agent };
}
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
export function git(h: Home, cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, env: childEnv(h, GIT_ENV), encoding: 'utf8' });
  if (r.status !== 0) throw Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}
/** A repo with one commit and `origin` set to `remote` (no network is reached: the remote is a URL only). */
function initRepo(h: Home, cwd: string, remote: string): void {
  git(h, cwd, 'init', '-q', '-b', 'main');
  writeFileSync(join(cwd, 'README.md'), '# widgets\n');
  git(h, cwd, 'add', '.');
  git(h, cwd, 'commit', '-q', '-m', 'start');
  git(h, cwd, 'remote', 'add', 'origin', remote);
}
export const headOf = (h: Home, cwd: string): string => git(h, cwd, 'rev-parse', 'HEAD');
export const callId = () => `toolu_${randomBytes(12).toString('hex')}`;
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.agent === 'codex') {
    Object.assign(base, { model: 'gpt-reserve', permission_mode: 'bypassPermissions' });
    if (event !== 'SessionStart') base.turn_id = s.turn ?? (s.turn = randomUUID());
    if (event === 'SessionStart') base.source = 'startup';
    if (event === 'Stop') Object.assign(base, { stop_hook_active: false, last_assistant_message: 'Done.' });
    return { ...base, ...extra };
  }
  if (s.prompt) base.prompt_id = s.prompt;
  if (event === 'SessionStart') { Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); delete base.prompt_id; }
  if (event === 'Stop') Object.assign(base, { stop_hook_active: false, last_assistant_message: 'Done.' });
  if (event === 'SessionEnd') Object.assign(base, { reason: 'other' });
  return { ...base, ...extra };
}
export function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
/** Where a prompt came from, as Claude Code's transcript entries show it (adapters/claude-code.facts.json, origin rules). */
export type Origin = 'person' | 'scheduled' | 'subagent' | 'session';
/** The transcript entry Claude Code writes for a prompt, by its origin; the turn's hooks carry its prompt ID. */
export function promptEntry(s: Session, text: string, origin: Origin = 'person'): string {
  const promptId = randomUUID();
  s.prompt = promptId;
  const common = { promptId, type: 'user', message: { role: 'user', content: text } };
  if (origin === 'person') appendTranscript(s, { ...common, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  else if (origin === 'scheduled') appendTranscript(s, { ...common, isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, turnOrigin: 'scheduled' });
  else if (origin === 'subagent') appendTranscript(s, { ...common, isMeta: true, promptSource: 'system', turnOrigin: 'task_notification', origin: { kind: 'peer', from: 'a2711031fe8c87e48', senderTaskId: 'a2711031fe8c87e48', name: 'general-purpose', body: text, handback: true, handbackReportText: text } });
  else appendTranscript(s, { ...common, isMeta: true, promptSource: 'system', turnOrigin: 'peer', origin: { kind: 'peer', from: 'b4e2c0d1a9f8e7c6', name: 'other-session', body: text } });
  return promptId;
}
/** The assistant's reply text, as a transcript entry. */
export function assistantSays(s: Session, text: string): void {
  appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(6)}`, type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 10 } } });
}
export const transcriptEntries = (s: Session): Line[] => jsonLines(readFileSync(s.transcript, 'utf8'));
/** The lines the chat showed: every hook_system_message attachment of the transcript, in order (#80's desktop transcript). */
export const chatLines = (s: Session): string[] => transcriptEntries(s).filter((e) => e.type === 'attachment' && e.attachment?.type === 'hook_system_message').map((e) => String(e.attachment.content));

// ---- The Claude Code stand-in (fixtures/claude.mjs): one process per session.
export interface HookRun { command: string; async: boolean; asyncRewake: boolean; timeout: number; pid: number; invocation: string; session: string; started: number; ended: number | null; code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; blocked?: string; shown?: string[]; model?: boolean; settingsError?: string }
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private rpc = 0;
  exited = false;
  private constructor(private readonly child: ChildProcess, readonly h: Home) {
    child.on('exit', () => { this.exited = true; for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
    });
  }
  get pid(): number { return this.child.pid!; }
  /** Claude Code for one session, HOME the test's home; `env` is added to what its hooks and its deep mcp get. */
  static start(h: Home, env: Record<string, string | undefined> = {}): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), h.co.cli, FACTS, h.hookLog], { cwd: h.tmp, env: childEnv(h, env), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
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
    const fired = (await this.send({ op: 'hook', event, payload: body, settings: settingsFile(this.h) })) as unknown as Fired;
    for (const r of [...fired.ran, ...fired.background]) startedGroups.add(r.pid);
    return fired;
  }
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const id = `${method}#${++this.rpc}`;
    const r = await this.send({ op: 'mcp', line: { jsonrpc: '2.0', id, method, params }, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async notify(method: string, params: Line = {}): Promise<void> { await this.send({ op: 'mcp', line: { jsonrpc: '2.0', method, params } }); }
  async initialize(): Promise<void> {
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-83', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.notify('notifications/initialized');
  }
  /** A deep_* tool call as Claude Code makes it: its tool_use entry, PreToolUse, the call, its tool_result entry, PostToolUse. */
  async deepTool(s: Session, tool: string, args: Line, timeoutMs = 120_000): Promise<Line> {
    const call = callId();
    appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(6)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: `mcp__deep__${tool}`, input: args }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
    await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args, tool_use_id: call }));
    const reply = await this.request('tools/call', { name: tool, arguments: args }, timeoutMs);
    appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: JSON.stringify(reply.result?.content ?? reply.error ?? reply) }] } });
    await this.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args, tool_use_id: call, tool_response: reply.result ?? reply.error ?? null }));
    return reply;
  }
  /** A built-in tool call (Edit, Write, Bash): its tool_use entry, PreToolUse, its tool_result entry, PostToolUse. */
  async tool(s: Session, tool: string, input: Line, response: Line): Promise<string> {
    const call = callId();
    appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(6)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: tool, input }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
    await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: call }));
    appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await this.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: tool, tool_input: input, tool_use_id: call, tool_response: response }));
    return call;
  }
  /** The session ends: Claude Code stops its deep mcp and exits. */
  async end(): Promise<void> {
    const gone = new Promise<void>((resolve) => { if (this.exited) resolve(); else this.child.once('exit', () => resolve()); });
    await this.send({ op: 'end' }).catch(() => undefined);
    await gone;
  }
  quit(): void { try { this.child.kill('SIGTERM'); } catch { /* gone */ } }
}
export const ours = (runs: HookRun[]): HookRun[] => runs.filter((r) => isDeepBuild(r.command));
export const firedShown = (f: Fired) => JSON.stringify({ blocked: f.blocked, shown: f.shown, model: f.model, runs: [...f.ran, ...f.background].map((r) => ({ command: r.command.slice(0, 120), code: r.code, signal: r.signal, timedOut: r.timedOut, stdout: r.stdout.slice(0, 600), stderr: r.stderr.slice(0, 400) })) });

/**
 * A Claude Code session begun: SessionStart, then a prompt you typed and its UserPromptSubmit. The session's deep mcp
 * is initialized so the agent can call deep_* tools.
 */
export async function begin(h: Home, s: Session, prompt = 'Fix the cart total, then stop.', env: Record<string, string | undefined> = {}): Promise<Claude> {
  const claude = Claude.start(h, env);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  promptEntry(s, prompt, 'person');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt }));
  await claude.initialize();
  return claude;
}
/** Work in the turn: one Edit of a file in the session's folder, through its hooks (README: A judged stop). */
export async function edits(claude: Claude, s: Session, file = 'total.ts'): Promise<void> {
  const path = join(s.cwd, file);
  writeFileSync(path, 'export const total = (n: number) => n * 1.08;\n');
  await claude.tool(s, 'Edit', { file_path: path, old_string: 'n * 1.07', new_string: 'n * 1.08' }, { filePath: path, oldString: 'n * 1.07', newString: 'n * 1.08' });
}
/** The agent's last words and its Stop. */
export async function stop(claude: Claude, s: Session, said = 'Done: the cart total is fixed.'): Promise<Fired> {
  assistantSays(s, said);
  return claude.hook('Stop', payload(s, 'Stop', { last_assistant_message: said }));
}
/**
 * The line Claude Code's chat shows for a Stop (README: Defined here, where the line shows): the reply's
 * `systemMessage`, or the first line of a send-back's block reason. Undefined when the reply carried neither.
 */
export function lineOf(f: Fired): string | undefined {
  if (f.shown?.length) return f.shown[0];
  if (f.blocked) return f.blocked.split('\n')[0];
  return undefined;
}
/** The status answer a prompt got from the record: the UserPromptSubmit reply's block reason (the prompt never reached the model). */
export const answerOf = (f: Fired): string | undefined => (f.blocked !== undefined ? f.blocked : undefined);
/** Whether a prompt reached the model, from Claude Code's side: the hook log's model line for it. */
export const modelCalled = (h: Home, s: Session, prompt: string): boolean => readLines(h.hookLog).some((l) => l.phase === 'model' && l.session === s.id && l.prompt === prompt);

// ---- Codex: its hooks run as Codex runs DeepBuild's entry, `deep-hook codex <event>` with the payload on stdin (README: Codex).
export interface CodexRun { ran: Ran; reply: Line | undefined }
export async function codexHook(h: Home, s: Session, event: string, extra: Line = {}): Promise<CodexRun> {
  const body = payload(s, event, extra);
  const ran = await run(h.co.hook, ['codex', event], { cwd: s.cwd, env: childEnv(h), input: JSON.stringify(body), timeoutMs: 60_000 });
  if (h.hookLog) writeFileSync(h.hookLog, `${JSON.stringify({ at: Date.now(), agent: 'codex', session: s.id, event, phase: 'reply', exit: ran.code, ms: ran.ended - ran.started, reply: parseObject(ran.stdout.trim()) ?? ran.stdout.slice(0, 2000), ...(body.prompt !== undefined ? { prompt: body.prompt } : {}) })}\n`, { flag: 'a' });
  return { ran, reply: parseObject(ran.stdout.trim()) };
}
/** The line Codex's chat shows for a reply: its `systemMessage`, or the first line of a block's reason. */
export function codexLineOf(r: CodexRun): string | undefined {
  if (typeof r.reply?.systemMessage === 'string') return r.reply.systemMessage;
  if (r.reply?.decision === 'block') return String(r.reply.reason ?? '').split('\n')[0];
  if (r.ran.code === 2) return r.ran.stderr.trim().split('\n')[0];
  return undefined;
}
/** What a Codex prompt's reply added for the model: its additionalContext, or undefined. */
export const codexContextOf = (r: CodexRun): string | undefined => (typeof r.reply?.hookSpecificOutput?.additionalContext === 'string' ? r.reply.hookSpecificOutput.additionalContext : undefined);

// ---- A claim, and the verdict planted on it (README: Defined here, test.verdict).
export interface Claimed { claim: string; id: string; task: string; commit: string }
/** The agent's claim through `deep_claim`, at the folder's HEAD (or a fixed commit when it is no repo). */
export async function claim(claude: Claude, s: Session, o: { task?: string; commit?: string } = {}): Promise<Claimed> {
  const task = o.task ?? `task:${ulidLike()}`;
  const commit = o.commit ?? (existsSync(join(s.cwd, '.git')) ? headOf(claude.h, s.cwd) : 'a'.repeat(40));
  const reply = await claude.deepTool(s, 'deep_claim', { task_ref: task, attempt: 1, commit, scope: 'session', predictions: null });
  const text = JSON.stringify(reply);
  const m = /claim:([0-9A-Z]{26})/.exec(text);
  if (!m) throw Error(`BLOCKED: deep_claim must answer with the claim's handle: ${text.slice(0, 800)}`);
  return { claim: `claim:${m[1]}`, id: m[1]!, task, commit };
}
const ulidLike = () => { const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; let s = ''; for (let i = 0; i < 26; i++) s += chars[Math.floor(Math.random() * 32)]; return s; };
export type Outcome = 'PASS' | 'FAIL' | 'BLOCKED' | 'INVALID' | 'INCONCLUSIVE';
export interface Requirement { req: string; outcome: Outcome | 'pending'; check: string; smallest?: string | null; points_to?: string | null }
export interface Planted {
  session: string;
  claim: string;
  /** null: no verdict yet (the stop says done, its checks still running). */
  outcome: Outcome | null;
  requirements: Requirement[];
  /** The send-back round, for FAIL. */
  round?: number;
  /** Checks still running, with the time each is expected to take. */
  running?: { check: string; about_s: number }[];
  /** Checks that ran to an end. */
  ran?: { check: string; outcome: 'passed' | 'failed' }[];
}
/** Plants the verdict (`test.verdict`): the record gets the verdict.made and run events the design names for that state. */
export async function plant(hub: Hub, p: Planted): Promise<Line> {
  try {
    return await control(hub, (conn) => conn.call('test.verdict', p));
  } catch (error) {
    throw Error(`BLOCKED: the hub must serve test.verdict with DEEP_HUB_TEST_VERDICT=1 (README: Additions, 1): ${(error as Error).message}`);
  }
}
export const req = (n: number, outcome: Requirement['outcome'], check = 'unit', extra: Partial<Requirement> = {}): Requirement => ({ req: `req:01K74G0A1B2C3D4E5F6G7H8J9K#R${n}`, outcome, check, smallest: null, points_to: null, ...extra });

// ---- The receipt (README: Defined here, the receipt): changes.read for the claim.
export interface Receipt {
  line: string; second: string; checks: { check: string; outcome: string }[];
  asks: { ask: string; pr: { state: string; url: string } | null }[];
  produced: { pr: string | null; files: string[]; pages: string[] };
  next_issue: { number: number; url: string } | null;
  [key: string]: unknown;
}
export async function receipt(hub: Hub, c: Claimed): Promise<Receipt> {
  const r = await control(hub, (conn) => conn.call('changes.read', { id: c.claim }));
  const change = (r.change ?? r) as Line;
  return change as Receipt;
}
export const receiptShown = (r: Receipt) => JSON.stringify({ line: r.line, second: r.second, checks: r.checks, asks: r.asks, produced: r.produced, next_issue: r.next_issue }).slice(0, 2000);

// ---- The forge stand-in: a GitHub-shaped API the hub reads PR state, checks, releases and issues from (README: The forge).
export interface ForgePR { number: number; state: 'open' | 'closed'; merged: boolean; merge_sha?: string; head_sha: string; body: string; checks?: 'running' | 'done' }
export interface ForgeIssue { number: number; title: string; state: 'open' | 'closed'; body: string }
export interface ForgeSpec { owner: string; repo: string; pulls: ForgePR[]; issues: ForgeIssue[]; releases: { tag: string; sha: string }[] }
export interface Forge { url: string; spec: ForgeSpec; requests: string[]; close(): void }
export const prUrl = (f: ForgeSpec, n: number) => `https://github.com/${f.owner}/${f.repo}/pull/${n}`;
export const issueUrl = (f: ForgeSpec, n: number) => `https://github.com/${f.owner}/${f.repo}/issues/${n}`;
export function startForge(spec: ForgeSpec): Promise<Forge> {
  const requests: string[] = [];
  const json = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((reqt, res) => {
    const url = new URL(reqt.url ?? '/', 'http://forge');
    requests.push(url.pathname + url.search);
    const base = `/repos/${spec.owner}/${spec.repo}`;
    if (!url.pathname.startsWith(base)) return json(res, 404, { message: 'Not Found' });
    const rest = url.pathname.slice(base.length);
    let m: RegExpExecArray | null;
    const pull = (p: ForgePR) => ({ number: p.number, state: p.state, merged: p.merged, merged_at: p.merged ? '2026-10-28T00:00:00Z' : null, merge_commit_sha: p.merge_sha ?? null, html_url: prUrl(spec, p.number), body: p.body, head: { sha: p.head_sha }, base: { ref: 'main' } });
    const issue = (i: ForgeIssue) => ({ number: i.number, title: i.title, state: i.state, body: i.body, html_url: issueUrl(spec, i.number) });
    if ((m = /^\/pulls\/(\d+)$/.exec(rest))) { const p = spec.pulls.find((x) => x.number === Number(m![1])); return p ? json(res, 200, pull(p)) : json(res, 404, { message: 'Not Found' }); }
    if (rest === '/pulls') return json(res, 200, spec.pulls.filter((p) => (url.searchParams.get('state') ?? 'open') === 'all' || p.state === (url.searchParams.get('state') ?? 'open')).map(pull));
    if ((m = /^\/commits\/([0-9a-f]{40})\/check-runs$/.exec(rest))) {
      const p = spec.pulls.find((x) => x.head_sha === m![1]);
      const runs = p ? [{ name: 'preflight', status: p.checks === 'running' ? 'in_progress' : 'completed', conclusion: p.checks === 'running' ? null : 'success' }] : [];
      return json(res, 200, { total_count: runs.length, check_runs: runs });
    }
    if ((m = /^\/commits\/([0-9a-f]{40})\/status$/.exec(rest))) {
      const p = spec.pulls.find((x) => x.head_sha === m![1]);
      return json(res, 200, { state: p?.checks === 'running' ? 'pending' : 'success', statuses: [] });
    }
    if ((m = /^\/issues\/(\d+)$/.exec(rest))) { const i = spec.issues.find((x) => x.number === Number(m![1])); return i ? json(res, 200, issue(i)) : json(res, 404, { message: 'Not Found' }); }
    if (rest === '/issues') { const state = url.searchParams.get('state') ?? 'open'; return json(res, 200, spec.issues.filter((i) => state === 'all' || i.state === state).map(issue)); }
    if (rest === '/releases') return json(res, 200, spec.releases.map((r, i) => ({ id: i + 1, tag_name: r.tag, target_commitish: r.sha, html_url: `https://github.com/${spec.owner}/${spec.repo}/releases/tag/${r.tag}` })));
    return json(res, 404, { message: 'Not Found' });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      const forge: Forge = { url: `http://127.0.0.1:${port}`, spec, requests, close: () => server.close() };
      closers.push(forge.close);
      resolve(forge);
    });
  });
}
/** An issue body in this repo's own shape: its epic and what it depends on. */
export const issueBody = (epic: number, dependsOn: number[]): string => `Some work.\n\n**Epic:** #${epic}\n\n### Depends on\n${dependsOn.map((n) => `- #${n} Earlier work`).join('\n')}\n`;

// ---- Timing (README: Budgets): the reference-Mac gate, nearest-rank percentiles and the five-run judgement, as #25's live suite reads them.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export const load = (): { one: number; cores: number } => ({ one: loadavg()[0]!, cores: availableParallelism() });
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
export interface Judged { verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; text: string }
/** The design's rule for a timing result over five runs: PASS, FAIL, or INCONCLUSIVE when the runs straddle the limit by less than their spread. */
export function judge(name: string, runs: number[], limit: number, unit: string): Judged {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const text = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} ${unit} against under ${limit} ${unit} (margin ${Number.isFinite(margin) && margin < 100 ? `${(margin * 100).toFixed(0)}%` : 'spread'})`;
  if (runs.every((r) => r < limit)) return { verdict: 'PASS', text };
  if (runs.every((r) => r > limit * (1 + margin))) return { verdict: 'FAIL', text };
  return { verdict: 'INCONCLUSIVE', text };
}
export function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
/** Skips the test as INCONCLUSIVE, printing why, when the machine's readings don't count; returns otherwise. */
export function inconclusiveIfLoaded(ctx: TestContext, loads: { one: number; cores: number }[], what: string): void {
  const problem = environmentProblem(loads);
  if (!problem) return;
  console.log(`INCONCLUSIVE (${problem}): ${what}`);
  ctx.skip(`INCONCLUSIVE (${problem}): ${what}`);
}

// ---- The merge base's side (README: Budgets, the merge base), as #25's live suite builds it.
const gitAt = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const sameAs = (sha: string, paths: string[]) => spawnSync('git', ['diff', '--quiet', sha, '--', ...paths], { cwd: REPO }).status === 0
  && gitAt('ls-files', '--others', '--exclude-standard', '--', ...paths) === '';
/**
 * The merge base with origin/main, built: this checkout when its code is the base's, else a copy from `git archive`
 * at /tmp/dh83-base-<sha>, kept between runs, with its workspaces built (its node_modules linked to this checkout's
 * when the lockfiles match, else `npm ci`) and its deep-hook (copied when crates/ is the base's, else built).
 */
export async function mergeBase(): Promise<Checkout> {
  let sha: string;
  try { sha = gitAt('merge-base', 'HEAD', 'origin/main'); } catch (e) { throw Error(`BLOCKED: no merge base with origin/main to compare with: ${(e as Error).message.split('\n')[0]}`); }
  const label = `the merge base ${sha.slice(0, 12)}`;
  if (sameAs(sha, ['packages', 'crates', 'Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json'])) return { ...CURRENT, label: `${label} (this checkout's own code)` };
  const dir = `/tmp/dh83-base-${sha.slice(0, 12)}`;
  const co: Checkout = { label, root: dir, cli: join(dir, 'packages/cli/dist/main.js'), hook: join(dir, 'target/debug/deep-hook') };
  if (existsSync(join(dir, '.built'))) return co;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync('/bin/sh', ['-c', `git -C '${REPO}' archive ${sha} | tar -x -C '${dir}'`], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  const step = async (what: string, command: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
    const r = await run(command, args, { cwd: dir, env, timeoutMs: 1_800_000 });
    if (r.code !== 0) throw Error(`BLOCKED: building ${label} for the comparison: ${what} failed: ${r.stderr.slice(-2000)}`);
  };
  if (gitAt('show', `${sha}:package-lock.json`) === readFileSync(join(REPO, 'package-lock.json'), 'utf8').trim()) {
    mkdirSync(join(dir, 'node_modules/@deepbuild'), { recursive: true });
    for (const entry of readdirSync(join(REPO, 'node_modules'))) if (entry !== '@deepbuild') symlinkSync(join(REPO, 'node_modules', entry), join(dir, 'node_modules', entry));
    for (const pkg of readdirSync(join(dir, 'packages'))) {
      const file = join(dir, 'packages', pkg, 'package.json');
      const name = existsSync(file) ? String((JSON.parse(readFileSync(file, 'utf8')) as Line).name ?? '') : '';
      if (name.startsWith('@deepbuild/')) symlinkSync(join(dir, 'packages', pkg), join(dir, 'node_modules/@deepbuild', name.slice('@deepbuild/'.length)));
    }
  } else {
    await step('npm ci', 'npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund']);
  }
  await step('npm run build --workspaces', 'npm', ['run', 'build', '--workspaces']);
  if (sameAs(sha, ['crates', 'Cargo.toml', 'Cargo.lock']) && existsSync(CURRENT.hook)) {
    mkdirSync(join(dir, 'target/debug'), { recursive: true });
    copyFileSync(CURRENT.hook, co.hook);
    chmodSync(co.hook, 0o755);
  } else {
    await step('cargo build -p deep-hook', 'cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { ...process.env, CARGO_TARGET_DIR: join(dir, 'target') });
  }
  writeFileSync(join(dir, '.built'), `${sha}\n`);
  return co;
}
