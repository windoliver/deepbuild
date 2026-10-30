// Test-side tools for #19's status folder (README): temp homes with stand-ins first on PATH, the real `deep` CLI
// as a child process, the real hub (`deep hub run`) with its output going to <root>/logs/hub.log as its login
// service sends it, the hub's socket with the control token, the record seeded through @deepbuild/record and
// @deepbuild/asks before the hub starts, deep-hook as a settings entry runs it, the debug bundle read back, the
// forms a scrub-list value is printed in, and the budget rule. Parts are adapted from tests/acceptance/24, 315 and
// 18/install (same repo, same license); this folder keeps its own copy so a redraft there never moves these tests.
// Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { expect, type TestContext } from 'vitest';
import { openRecord, type Connection, type EventInput, type RecordStore } from '../../../../packages/record/src/index.ts';
import { askSources, openAsks, type AskKind, type Asks } from '../../../../packages/asks/src/index.ts';
import { withPlans } from '../../plans.ts';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const NODE = process.execPath;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const parse = (raw: string): Line | undefined => { try { const v: unknown = JSON.parse(raw); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };

// ---- ULIDs, minted at a given time.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted + Math.floor(Math.random() * 2 ** 40), i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}

// ---- Temp folders (short: a socket path must fit in 104 bytes on macOS) and processes this folder started.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh19t-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
export const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
/** Stops every process this folder started, by PID (SIGCONT and SIGTERM, then SIGKILL after 3 s), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- Homes. `<tmp>/h` is HOME for every process a test starts; `<tmp>/bin` comes first on PATH with the stand-ins.
const CLAUDE_FACTS = join(REPO, 'adapters/claude-code.facts.json');
const CODEX_FACTS = join(REPO, 'adapters/codex.facts.json');
const newest = (file: string): string => { const v = (JSON.parse(readFileSync(file, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; };
export interface Home { tmp: string; home: string; root: string; bin: string }
/**
 * A fresh home with `~/.claude` made and stand-ins for claude, codex, launchctl and systemctl first on PATH
 * (fixtures/agent-bin.sh): signed in, at the newest versions the adapters' facts cover.
 */
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin);
  for (const name of ['claude', 'codex', 'launchctl', 'systemctl']) {
    copyFileSync(join(FIXTURES, 'agent-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${newest(CLAUDE_FACTS)}\n`);
  writeFileSync(join(bin, 'codex.version'), `${newest(CODEX_FACTS)}\n`);
  writeFileSync(join(bin, 'claude.auth'), `${JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max' })}\n`);
  writeFileSync(join(bin, 'codex.login'), 'Logged in using ChatGPT\n');
  return { tmp, home, root: join(home, '.deepbuild'), bin };
}
export const rootOf = (home: string): string => join(home, '.deepbuild');
const binOf = (home: string): string => join(dirname(home), 'bin');

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** HOME the test's home, the stand-ins first on PATH, and no DEEP_, CLAUDE*, CODEX* or billing variable of this process's. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|TMUX|OTEL_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), SHELL: '/bin/sh', LC_ALL: 'C',
    PATH: `${binOf(home)}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number }
/** Runs a command to its end, timed from its spawn to its exit. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 60_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0 }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
/** `deep <args>` from the built CLI, run by you: a child of this test process, under no agent. */
export const deep = (home: string, args: readonly string[], o: { env?: Record<string, string | undefined>; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> =>
  run(NODE, [CLI, ...args], { env: childEnv(home, o.env), ...(o.cwd ? { cwd: o.cwd } : {}), timeoutMs: o.timeoutMs ?? 60_000 });
export const shown = (r: Ran): string => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}; stdout:\n${r.stdout.slice(0, 4000)}\nstderr:\n${r.stderr.slice(0, 2000)}`;

// ---- The hub: `deep hub run [--root <folder>]`, its stdout and stderr appended to <root>/logs/hub.log, as the login
// service the setup installs sends them (#16's service definition), so whatever the hub prints is a log under the root.
export interface Hub { pid: number; home: string; root: string; socket: string; log: string }
export async function startHub(home: string, o: { root?: string; plant?: string; env?: Record<string, string | undefined> } = {}): Promise<Hub> {
  const root = o.root ?? rootOf(home);
  mkdirSync(join(root, 'logs'), { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const log = join(root, 'logs', 'hub.log');
  const from = existsSync(log) ? statSync(log).size : 0;
  const fd = openSync(log, 'a', 0o600);
  const child = spawn(NODE, [CLI, 'hub', 'run', ...(o.root ? ['--root', o.root] : [])], {
    cwd: REPO, env: childEnv(home, { DEEP_HUB_PLANT: o.plant, ...o.env }), stdio: ['ignore', fd, fd], detached: true,
  });
  closeSync(fd);
  own(child.pid);
  let exited = false;
  child.on('exit', () => { exited = true; });
  const deadline = Date.now() + 30_000;
  for (;;) {
    const text = readFileSync(log).subarray(from).toString('utf8');
    if (text.split('\n').some((l) => parse(l)?.ready === true)) break;
    if (exited || Date.now() > deadline) {
      throw Error(`BLOCKED: the hub didn't start (deep hub run${o.root ? ` --root ${o.root}` : ''}${o.plant ? `, DEEP_HUB_PLANT=${o.plant}` : ''}): ${text.slice(-2000)}`);
    }
    await sleep(50);
  }
  return { pid: child.pid!, home, root, socket: join(root, 'hub.sock'), log };
}
export async function stopHub(hub: { pid: number }): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 20_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
}
/** The address setting every client reads (#16): `{"hub": {"address": "unix:<path>"}}` in ~/.deepbuild/config.json. */
export function setAddress(home: string, socket: string): void {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  const file = join(rootOf(home), 'config.json');
  const config = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Line) : {};
  config.hub = { ...(config.hub as Line | undefined), address: `unix:${socket}` };
  writeFileSync(file, `${JSON.stringify(config)}\n`);
}

// ---- The socket: one JSON line each way, `v: 1` (tests/acceptance/16/README.md, The socket).
export class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private readonly wakers = new Set<() => void>();
  private ids = 0;
  private closed = false;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8').on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        this.lines.push(parse(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) });
        this.buffer = this.buffer.slice(i + 1);
      }
      for (const w of [...this.wakers]) w();
    });
    const end = () => { this.closed = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  /** A `cli` connection with the control token the hub at `root` wrote, read from <root>/control.token. */
  static async control(root: string): Promise<Conn> {
    const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
    const conn = new Conn(net.connect(join(root, 'hub.sock')));
    if (!(await conn.wait(0))) throw Error(`BLOCKED: no hello from the hub at ${root}`);
    conn.sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    const answer = await conn.wait(1);
    if (answer?.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(answer)}`);
    return conn;
  }
  private wait(index: number, timeoutMs = 10_000): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.lines.length > index || this.closed) { clearTimeout(timer); this.wakers.delete(check); resolve(this.lines[index]); }
      };
      const timer = setTimeout(() => { this.wakers.delete(check); resolve(undefined); }, timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  async call(method: string, params: Line = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `t19s#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await new Promise<Line | undefined>((resolve) => {
      const check = () => {
        const found = this.lines.find((l) => l.id === id);
        if (found || this.closed) { clearTimeout(timer); this.wakers.delete(check); resolve(found); }
      };
      const timer = setTimeout(() => { this.wakers.delete(check); resolve(undefined); }, timeoutMs);
      this.wakers.add(check);
      check();
    });
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    return reply;
  }
  close(): void { this.sock.destroy(); }
}
export interface Ev { id: string; kind: string; subject?: string; session?: string; writer: string; data: Line; log_pos: number }
/** Every event in the log of the hub at `root`, through `events.read`. */
export async function events(root: string): Promise<Ev[]> {
  const conn = await Conn.control(root);
  try {
    const all: Ev[] = [];
    for (let after = 0; ;) {
      const reply = await conn.call('events.read', { after, limit: 1000 });
      if ('error' in reply) throw Error(`BLOCKED: events.read refused: ${JSON.stringify(reply.error)}`);
      const page = reply.result.events as Ev[];
      if (!page.length) return all;
      all.push(...page);
      after = page[page.length - 1]!.log_pos;
    }
  } finally {
    conn.close();
  }
}
/** Polls until `probe` returns a value, or throws BLOCKED naming what it waited for. */
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() > deadline) throw Error(`BLOCKED: waited ${timeoutMs} ms for ${what}`);
    await sleep(100);
  }
}

// ---- The record, seeded with the hub stopped, through the record's and the asks core's public entries.
export const REPOS = ['orchard', 'quarry', 'tundra'] as const;
export type Repo = string;
export type State = 'needs-you' | 'stuck' | 'flagged' | 'working' | 'quiet';
export interface Planned { repo: Repo; agent: 'claude-code' | 'codex'; state: State; how: string; lead: string }
export interface Seeded extends Planned { id: string }
/** A session ID as its agent mints it, a UUID, with its first character chosen so the seed controls how IDs sort. */
function sessionId(lead: string, taken: Set<string>): string {
  for (;;) {
    const id = `${lead}${randomUUID().slice(1)}`;
    if (!taken.has(id.slice(0, 8))) { taken.add(id.slice(0, 8)); return id; }
  }
}
const who = { actor: 'you', scope: 'you' };
const handle = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
const ASK_OPTIONS: Record<string, Line[]> = {
  authority: [{ id: 'approve', label: 'Push it', decision: 'allow' }, { id: 'decline', label: 'Hold the push', decision: 'deny' }],
  taste: [{ id: 'blue', label: 'Blue header', decision: 'none' }, { id: 'green', label: 'Green header', decision: 'none' }],
  choice: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }],
};
const ASK_DEFAULT: Record<string, string> = { authority: 'decline', taste: 'blue', choice: 'sqlite' };
function askData(kind: 'authority' | 'taste' | 'choice', subject: string, raised: number): Line {
  return {
    kind, question: kind === 'authority' ? `Push ${subject} to origin?` : `Which way for ${subject}?`, options: structuredClone(ASK_OPTIONS[kind]),
    recommended: kind === 'authority' ? null : ASK_DEFAULT[kind], deadline: raised + DAY, fallback: 'you', default: ASK_DEFAULT[kind],
    provisional: false, owner: 'you', key: sha256(`${kind}:${subject}`), pinned_to: { kind: 'evidence', ref: sha256(subject) },
  };
}
const sourceOf = (kind: AskKind): string => askSources().find((row) => row.kind === kind)!.source;

/** Appends sessions' events as their hooks, the core and the asks core would, on a clock the seed moves. */
export class Seeder {
  private constructor(readonly record: RecordStore, readonly asks: Asks, private readonly clock: { now: number }) {}
  static async open(root: string, start: number): Promise<Seeder> {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const clock = { now: start };
    const record = await openRecord({ path: join(root, 'ledger.db'), now: () => clock.now });
    const asks = withPlans(await openAsks({ record, now: () => clock.now, deliver: () => undefined }));
    return new Seeder(record, asks, clock);
  }
  at(ms: number): this { this.clock.now = ms; return this; }
  private hook(s: Seeded): Connection { return { writer: 'hook', ...who, session: s.id, project: s.repo, agent: s.agent }; }
  private core(s: Seeded): Connection { return { writer: 'core', ...who, session: s.id, project: s.repo }; }
  private event(kind: string, v: number, data: Line, subject?: string): EventInput {
    return { v, id: ulid(this.clock.now), kind, ts: this.clock.now, ...(subject ? { subject } : {}), data };
  }
  async start(s: Seeded, n: number): Promise<void> {
    await this.record.append(this.hook(s), this.event('session.start', 3, { agent: s.agent, worktree: `/work/${s.repo}/wt${n}`, branch: `topic-${n}`, thread: s.id, loads: [] }));
  }
  async attention(s: Seeded, state: 'working' | 'waiting' | 'stuck' | 'unknown'): Promise<void> {
    await this.record.append(this.core(s), this.event('session.attention', 2, { state }, `session:${handle(s.id)}`));
  }
  async prompt(s: Seeded, text: string, msg = 0): Promise<void> {
    await this.record.append(this.hook(s), this.event('user.ask', 1, { msg, text, tasks: [], from: 'person' }));
  }
  async tool(s: Seeded, command: string, call: string): Promise<void> {
    await this.record.append(this.hook(s), this.event('tool.before', 3, { kind: 'shell', paths: [], command, call }));
  }
  /** The turn's stop, as Claude Code's Stop or StopFailure hook reports it (agent.stop@3). */
  async stop(s: Seeded, data: Line): Promise<void> {
    await this.record.append(this.hook(s), this.event('agent.stop', 3, { turn: 1, did_work: true, usage: null, ...data }, `session:${handle(s.id)}`));
  }
  /** The core's reading that the session's process is gone (session.gone@1): the app quit under it. */
  async gone(s: Seeded): Promise<void> {
    await this.record.append(this.core(s), this.event('session.gone', 1, { pid: 4242, start: 'Mon Oct 27 09:00:00 2026' }, `session:${handle(s.id)}`));
  }
  /** An ask DeepBuild's core raises for the session, left open. */
  async raise(s: Seeded, kind: 'authority' | 'taste' | 'choice', subject: string): Promise<string> {
    return this.asks.raise(this.core(s), sourceOf(kind), askData(kind, subject, this.clock.now));
  }
  close(): Promise<void> { return this.record.close(); }
}

/**
 * The 30 sessions of AC8 (README: The 30 sessions): 3 that need you (an open ask), 3 stuck, 3 flagged, 2 working and
 * 19 quiet, over three repos and both agents. The attention sessions sort last by ID and sit mostly in the repos that
 * sort last by name; the quiet ones sort first and were last seen days ago.
 */
export const THIRTY: readonly Planned[] = [
  { repo: 'tundra', agent: 'claude-code', state: 'needs-you', how: 'an open authority ask', lead: 'f' },
  { repo: 'tundra', agent: 'codex', state: 'needs-you', how: 'an open choice ask', lead: 'f' },
  { repo: 'quarry', agent: 'claude-code', state: 'needs-you', how: 'two open asks, taste and authority', lead: 'e' },
  { repo: 'tundra', agent: 'claude-code', state: 'stuck', how: 'stopped failed on sign-in, owner you', lead: 'f' },
  { repo: 'quarry', agent: 'claude-code', state: 'stuck', how: 'stopped failed on a rate limit, owner service', lead: 'e' },
  { repo: 'orchard', agent: 'codex', state: 'stuck', how: 'its attention reads stuck', lead: 'f' },
  { repo: 'tundra', agent: 'claude-code', state: 'flagged', how: 'ended without a claim when the plan window ran out', lead: 'f' },
  { repo: 'quarry', agent: 'codex', state: 'flagged', how: 'its process gone mid-turn, the app quit, no claim', lead: 'e' },
  { repo: 'tundra', agent: 'claude-code', state: 'flagged', how: 'ended without a claim when the agent crashed', lead: 'e' },
  { repo: 'orchard', agent: 'claude-code', state: 'working', how: 'a tool call a minute ago', lead: 'c' },
  { repo: 'quarry', agent: 'codex', state: 'working', how: 'a tool call two minutes ago', lead: 'c' },
  ...Array.from({ length: 19 }, (_, i): Planned => ({
    repo: i < 11 ? 'orchard' : i < 16 ? 'quarry' : 'tundra', agent: i % 3 === 0 ? 'codex' : 'claude-code', state: 'quiet',
    how: `hooks quiet since ${2 + (i % 4)} days ago`, lead: String(i % 4),
  })),
];
/** Seeds the planned sessions, as they'd stand at `now`, into the record at <root>/ledger.db; returns them with their IDs. */
export async function seedSessions(root: string, plan: readonly Planned[], now: number, s?: Seeder): Promise<Seeded[]> {
  const seeder = s ?? await Seeder.open(root, now - 6 * DAY);
  const taken = new Set<string>();
  const out: Seeded[] = plan.map((p) => ({ ...p, id: sessionId(p.lead, taken) }));
  try {
    // The quiet ones first in the log, then the rest: a listing in log order puts the attention sessions last.
    const order = [...out.filter((x) => x.state === 'quiet'), ...out.filter((x) => x.state !== 'quiet')];
    for (const [n, x] of order.entries()) {
      switch (x.state) {
        case 'quiet': {
          const last = now - (2 + (n % 4)) * DAY;
          await seeder.at(last - HOUR).start(x, n);
          await seeder.at(last - 50 * MINUTE).prompt(x, 'tidy the imports');
          await seeder.at(last - 40 * MINUTE).tool(x, 'npm test', `call_${n}`);
          await seeder.at(last).attention(x, 'unknown');
          break;
        }
        case 'working': {
          await seeder.at(now - 20 * MINUTE).start(x, n);
          await seeder.at(now - 15 * MINUTE).prompt(x, 'add the export button');
          await seeder.at(now - (x.how.includes('two') ? 2 : 1) * MINUTE).tool(x, 'npm run build', `call_${n}`);
          break;
        }
        case 'needs-you': {
          await seeder.at(now - 40 * MINUTE).start(x, n);
          await seeder.at(now - 35 * MINUTE).prompt(x, 'ship the release');
          if (x.how.includes('taste')) {
            await seeder.at(now - 8 * MINUTE).raise(x, 'taste', `the header of ${x.repo}`);
            await seeder.at(now - 6 * MINUTE).raise(x, 'authority', `release/${n}`);
          } else {
            await seeder.at(now - 6 * MINUTE).raise(x, x.how.includes('choice') ? 'choice' : 'authority', `release/${n}`);
          }
          break;
        }
        case 'stuck': {
          await seeder.at(now - 90 * MINUTE).start(x, n);
          await seeder.at(now - 80 * MINUTE).prompt(x, 'run the migration');
          if (x.how.includes('sign-in')) await seeder.at(now - 20 * MINUTE).stop(x, { cause: 'sign_in_required', outcome: 'failed', owner: 'you' });
          else if (x.how.includes('rate limit')) await seeder.at(now - 25 * MINUTE).stop(x, { cause: 'rate_limited', outcome: 'failed', owner: 'service' });
          else await seeder.at(now - 15 * MINUTE).attention(x, 'stuck');
          break;
        }
        case 'flagged': {
          await seeder.at(now - 3 * HOUR).start(x, n);
          await seeder.at(now - 170 * MINUTE).prompt(x, 'port the parser');
          await seeder.at(now - 160 * MINUTE).tool(x, 'cargo test', `call_${n}`);
          if (x.how.includes('plan window')) await seeder.at(now - 30 * MINUTE).stop(x, { cause: 'plan_window_spent', plan_resets: now + 2 * HOUR, outcome: 'failed' });
          else if (x.how.includes('app quit')) await seeder.at(now - 45 * MINUTE).gone(x);
          else await seeder.at(now - 50 * MINUTE).stop(x, { cause: 'agent_crashed', outcome: 'failed' });
          break;
        }
      }
    }
  } finally {
    if (!s) await seeder.close();
  }
  return out;
}
export const ATTENTION: ReadonlySet<State> = new Set(['needs-you', 'stuck', 'flagged']);

// ---- `deep status` read back (README: What `deep status` prints).
export const prefixOf = (id: string): string => id.slice(0, 8).toLowerCase();
/** 0-based index of the first line naming the session by the first 8 characters of its ID, or -1. */
export function lineOf(lines: readonly string[], s: { id: string }): number {
  return lines.findIndex((l) => l.toLowerCase().includes(prefixOf(s.id)));
}
const names = (line: string, repo: string): boolean => new RegExp(`(^|[^A-Za-z0-9_-])${repo}([^A-Za-z0-9_-]|$)`).test(line);
/** The forms a hub's location can be named in: its root, its socket, its `unix:` address, home shown as `~`, with or without /private. */
export function hubNames(home: string, root: string): string[] {
  const forms = new Set<string>();
  for (const r of [root, root.replace(/^\/private\//, '/'), root.startsWith('/tmp/') ? `/private${root}` : root]) {
    forms.add(r);
    for (const h of [home, home.replace(/^\/private\//, '/')]) if (r.startsWith(`${h}/`)) forms.add(`~${r.slice(h.length)}`);
  }
  return [...forms];
}
/**
 * What's wrong with a `deep status` output for these sessions, as one line per problem (empty: nothing wrong):
 * an attention session not named within the first 20 lines; a shown session not under its repo; a working session
 * not shown; a quiet session listed on a line of its own, or the quiet counts not adding up; the hub not named.
 */
export function judgeStatus(stdout: string, sessions: readonly Seeded[], hub: readonly string[], repos: readonly string[] = REPOS): string[] {
  const lines = stdout.split('\n');
  const problems: string[] = [];
  const quiet = sessions.filter((s) => s.state === 'quiet');
  for (const s of sessions) {
    const at = lineOf(lines, s);
    if (ATTENTION.has(s.state) && (at < 0 || at >= 20)) {
      problems.push(`session ${s.id} (${s.state}: ${s.how}; repo ${s.repo}) is ${at < 0 ? 'not shown' : `on line ${at + 1}`}, not within the first 20 lines`);
    }
    if (s.state === 'working' && at < 0) problems.push(`session ${s.id} (working: ${s.how}; repo ${s.repo}) is not shown`);
    if (s.state === 'quiet' && at >= 0) problems.push(`quiet session ${s.id} (repo ${s.repo}) is listed on line ${at + 1} instead of folded into the quiet line`);
    if (s.state !== 'quiet' && at >= 0) {
      let i = at;
      while (i >= 0 && !repos.some((r) => names(lines[i]!, r))) i--;
      const under = i >= 0 ? repos.filter((r) => names(lines[i]!, r)) : [];
      if (!under.includes(s.repo)) {
        problems.push(`session ${s.id} (repo ${s.repo}) on line ${at + 1} is ${under.length ? `under ${under.join(', ')}` : 'under no repo'}: sessions are grouped by repo`);
      }
    }
  }
  const folded = [...stdout.matchAll(/(\d+)\s+quiet\b/gi)].reduce((sum, m) => sum + Number(m[1]), 0);
  if (folded !== quiet.length) problems.push(`the quiet lines ("<n> quiet") count ${folded} sessions, not the ${quiet.length} quiet ones`);
  if (!hub.some((name) => stdout.includes(name))) problems.push(`it doesn't say which hub it reads: none of ${hub.join(', ')} appears`);
  return problems;
}

// ---- The debug bundle read back: the file whose path `deep debug bundle` prints last, gzip inflated.
export interface Bundle { path: string; text: string; strings: string }
export function readBundle(path: string): Bundle {
  const bytes = readFileSync(path);
  const inflated = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  const text = inflated.toString('utf8');
  // Every string in it, decoded, when it is JSON, so a value JSON escapes is still found as it is.
  const leaves: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') { leaves.push(v); const inner = parse(v); if (inner) walk(inner); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { leaves.push(k); walk(x); }
  };
  walk(parse(text));
  return { path, text: `${bytes.toString('latin1')}\n${text}`, strings: leaves.join('\n') };
}

// ---- The forms a scrub-list value is printed in (design: Privacy; #15's forms): raw, URL-encoded with either case of
// hex, and base64 after 0, 1 or 2 leading bytes in both alphabets, each as the core that depends on the value alone.
export interface Form { name: string; text: string }
const urlEncode = (value: string, upper: boolean): string => [...Buffer.from(value, 'utf8')].map((b) => {
  const ch = String.fromCharCode(b);
  if (/[A-Za-z0-9\-_.~]/.test(ch)) return ch;
  const h = b.toString(16).padStart(2, '0');
  return `%${upper ? h.toUpperCase() : h}`;
}).join('');
export function everyForm(value: string): Form[] {
  const bytes = Buffer.from(value, 'utf8');
  const forms: Form[] = [
    { name: 'raw', text: value },
    { name: 'URL-encoded, upper-case hex', text: urlEncode(value, true) },
    { name: 'URL-encoded, lower-case hex', text: urlEncode(value, false) },
  ];
  for (const k of [0, 1, 2]) {
    const std = Buffer.concat([Buffer.from('r:'.slice(2 - k)), bytes]).toString('base64');
    const core = std.slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + bytes.length)) / 6));
    forms.push({ name: `base64 at offset ${k}`, text: core });
    forms.push({ name: `base64url at offset ${k}`, text: core.replace(/\+/g, '-').replace(/\//g, '_') });
  }
  return forms.filter((f, i) => f.text.length >= 8 && forms.findIndex((g) => g.text === f.text) === i);
}
export const base64Of = (value: string, lead = ''): string => Buffer.from(`${lead}${value}`, 'utf8').toString('base64');
export const urlEncodedOf = (value: string): string => urlEncode(value, true);

/** Every file under a folder, sockets and other non-files left out. */
export function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    return e.isDirectory() ? walk(path) : e.isFile() ? [path] : [];
  });
}
export interface Canary { name: string; forms: Form[] }
/**
 * The sweep: every file under `root`, and each extra file, read as bytes (and inflated too when gzip), searched for
 * every form of every canary. One line per hit: `<file>: <canary> (<form>)`.
 */
export function sweep(root: string, canaries: readonly Canary[], extra: readonly string[] = []): string[] {
  const hits: string[] = [];
  for (const file of [...new Set([...walk(root), ...extra.filter((f) => existsSync(f))])]) {
    const bytes = readFileSync(file);
    let text = bytes.toString('latin1');
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) { try { text += `\n${gunzipSync(bytes).toString('latin1')}`; } catch { /* a cut gzip: its bytes are searched as they are */ } }
    for (const c of canaries) for (const f of c.forms) if (text.includes(f.text)) hits.push(`${file}: ${c.name} (${f.name})`);
  }
  return hits;
}

// ---- deep-hook, built once per test process, run as an agent's hook entry runs it (#315).
let built: Promise<string> | undefined;
export function buildDeepHook(): Promise<string> {
  built ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutMs: 900_000 }).then((r) => {
    if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: cargo build --locked -q -p deep-hook failed: ${r.stderr.slice(-3000)}`);
    spawnSync(DEEP_HOOK, ['--version'], { stdio: 'ignore', timeout: 30_000 });
    return DEEP_HOOK;
  });
  return built;
}
export interface Session { id: string; cwd: string; transcript: string }
/** A Claude Code session of the test's own: a working folder, and its transcript where Claude Code keeps it under HOME. */
export function newSession(home: string, tmp: string): Session {
  const id = randomUUID();
  const cwd = join(tmp, 'work');
  mkdirSync(cwd, { recursive: true });
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
/** Hook JSON shaped like the corpus's Claude Code 2.1.304 payloads (adapters/corpus/claude-code). */
export function payload(s: Session, event: string, extra: Line = {}): Line {
  return { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default', ...extra };
}
/** `deep-hook claude-code <event>`, the hook JSON on stdin, HOME the agent's, in the session's folder. */
export function hook(home: string, s: Session, event: string, body: Line): Promise<Ran> {
  return run(DEEP_HOOK, ['claude-code', event], { cwd: s.cwd, env: childEnv(home), input: JSON.stringify(body), timeoutMs: 90_000 });
}
/** Lines appended to the session's transcript as Claude Code writes them: the prompt, the Bash call and its output. */
export function transcriptTurn(s: Session, prompt: string, command: string, output: string, call: string): void {
  const base = { isSidechain: false, userType: 'external', entrypoint: 'cli', cwd: s.cwd, sessionId: s.id, version: newest(CLAUDE_FACTS), gitBranch: 'main' };
  const at = (n: number) => new Date(Date.now() + n).toISOString();
  const lines = [
    { ...base, type: 'user', uuid: randomUUID(), timestamp: at(0), message: { role: 'user', content: prompt } },
    { ...base, type: 'assistant', uuid: randomUUID(), timestamp: at(1), message: { role: 'assistant', model: 'claude-haiku-5-5', type: 'message', content: [{ type: 'tool_use', id: call, name: 'Bash', input: { command } }] } },
    { ...base, type: 'user', uuid: randomUUID(), timestamp: at(2), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: output }] }, toolUseResult: { stdout: output, stderr: '', interrupted: false } },
  ];
  writeFileSync(s.transcript, `${readFileSync(s.transcript, 'utf8')}${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}
export const callId = (): string => `toolu_${randomBytes(12).toString('hex')}`;

// ---- Budgets: the design's rule for timing results (Numbers version 0 has to hold), as tests/acceptance/24 and 237 judge them.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing or memory reading here is only a reading, or null on a reference Mac in a fit state. */
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
  return loadProblem();
}
/** A machine loaded past its core count: its readings are readings only (design: Sessions that know about each other, Load). */
export function loadProblem(): string | null {
  const [one] = loadavg();
  const cores = availableParallelism();
  return one! > cores ? `under heavy load: 1-minute load ${one!.toFixed(1)} on ${cores} cores` : null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const text = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(text);
  if (runs.every((r) => r < limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${text}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${text}`);
}
/** `deep <args>` under /usr/bin/time -l: its time from spawn to exit, and its peak resident memory in bytes. */
export async function measured(home: string, args: readonly string[], o: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<Ran & { peakBytes: number }> {
  const r = await run('/usr/bin/time', ['-l', NODE, CLI, ...args], { env: childEnv(home, o.env), ...(o.cwd ? { cwd: o.cwd } : {}), timeoutMs: 120_000 });
  const peak = /(\d+)\s+maximum resident set size/.exec(r.stderr);
  if (!peak) throw Error(`BLOCKED: /usr/bin/time -l printed no maximum resident set size: ${r.stderr.slice(-1000)}`);
  return { ...r, peakBytes: Number(peak[1]) };
}
