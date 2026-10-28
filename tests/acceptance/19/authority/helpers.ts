// Shared test-side tools for issue #19's authority criteria (README): temp homes with stubbed system tools, `deep
// setup` through the built CLI, the installed hub and a dev hub as processes with their sockets' line protocol, a
// forwarded socket that keeps every acknowledgement, the Claude Code stand-in (fixtures/claude.mjs) whose hooks run
// setup's entries, a double fork from the stand-in's shell that launchd adopts, the record seeded through the record
// and asks core, and the probes that read whether the next hook reply is gated or watch-only. Parts are adapted from
// tests/acceptance/18/install/helpers.ts and tests/acceptance/24/helpers.ts (same repo, same license); this suite
// keeps its own copy so a redraft of theirs never moves these tests. Nothing here stands in for DeepBuild: every
// test reaches it through the CLI, deep-hook as setup's entries run it, the hubs' sockets and files under the home.
// Processes are stopped by PID only, never by name or port.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { openRecord } from '../../../../packages/record/src/index.ts';
import type { Connection } from '../../../../packages/record/src/index.ts';
import { askSources, openAsks } from '../../../../packages/asks/src/index.ts';
import type { AskKind } from '../../../../packages/asks/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const NODE = process.execPath;
export const DAY = 86_400_000;

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
const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh19a-'));
  made.push(dir);
  return dir;
}
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts. `<tmp>/bin` comes first on PATH with stand-ins for
 * launchctl, systemctl and claude (each logs its call to `<tmp>/bin/calls.log` and exits 0) and a `deep` that runs the
 * built CLI. `<tmp>/confirm` is the OS confirmation's stub (README: the seam), `cancelled` until a test says otherwise.
 */
export interface Home { tmp: string; home: string; bin: string; confirm: string }
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
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'cancelled\n');
  return { tmp, home, bin, confirm };
}
/** What the stubbed OS confirmation answers from now on, for every process that asks (hub or CLI). */
export const confirmWith = (h: Home, answer: 'confirmed' | 'cancelled'): void => writeFileSync(h.confirm, `${answer}\n`);
export const rootOf = (home: string) => join(home, '.deepbuild');
export const settingsFile = (home: string) => join(home, '.claude', 'settings.json');
export const binOf = (home: string) => join(dirname(home), 'bin');
/** The stubbed launchctl's and systemctl's calls so far, one per line. */
export const serviceCalls = (h: Home): string[] => (existsSync(join(h.bin, 'calls.log')) ? readFileSync(join(h.bin, 'calls.log'), 'utf8').split('\n').filter((l) => /^(launchctl|systemctl) /.test(l)) : []);
/** A call that would stop, unload or remove the hub's login service. */
export const STOPS_SERVICE = /\b(bootout|unload|remove|stop|kill|disable|kickstart -k)\b/;

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
 * The environment a child gets: HOME the test's home, the stand-ins first on PATH, the OS confirmation's stub
 * (DEEP_HUB_TEST_CONFIRM) set, and no DEEP_, CLAUDE or CODEX setting or billing key of this process's.
 */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('TMUX') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
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

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string | undefined; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
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
export const shown = (r: { code: number | null; stdout: string; stderr: string }) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/** `deep <args>` from the built CLI, run by you: a child of this test process, under no agent. */
export function deep(home: string, args: readonly string[], o: { env?: Record<string, string | undefined>; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(home, o.env), cwd: o.cwd, timeoutMs: o.timeoutMs ?? 180_000 });
}

// ---- deep-hook: built once per test process; setup names the path its entries run.
const builds = new Map<string, Promise<void>>();
export function cargoBuild(release: boolean): Promise<void> {
  const key = release ? 'release' : 'debug';
  let building = builds.get(key);
  if (!building) {
    const args = ['build', '--locked', '-q', '-p', 'deep-hook', ...(release ? ['--release'] : [])];
    building = run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => {
      if (r.code !== 0) throw Error(`BLOCKED: cargo ${args.join(' ')} failed: ${r.stderr.slice(-3000)}`);
    });
    builds.set(key, building);
  }
  return building;
}
/** The deep-hook binary an entry's command runs, built if it names this checkout's target and is missing. */
async function hookBinary(command: string): Promise<string> {
  const path = command.match(/\/[^\s'"]*deep-hook\b/)?.[0];
  if (!path) throw Error(`BLOCKED: DeepBuild's entry names no deep-hook binary: ${command}`);
  if (!existsSync(path)) {
    if (path === join(REPO, 'target/release/deep-hook')) await cargoBuild(true);
    else if (path === join(REPO, 'target/debug/deep-hook')) await cargoBuild(false);
  }
  if (!existsSync(path)) throw Error(`BLOCKED: DeepBuild's entry runs ${path}, which doesn't exist: ${command}`);
  return path;
}

// ---- Claude Code's user settings and DeepBuild's entries in it.
export function readSettings(home: string): Line {
  const text = readFileSync(settingsFile(home), 'utf8');
  const parsed = parseObject(text);
  if (!parsed) throw Error(`${settingsFile(home)} is not a JSON object: ${text.slice(0, 500)}`);
  return parsed;
}
/** Whether a hook command is DeepBuild's: it runs deep-hook, or the deep CLI (by its built file or as `deep`). */
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
/** Every hook entry of the settings whose command is DeepBuild's, with its event. */
export function deepEntries(settings: Line): { event: string; command: string }[] {
  const hooks = (settings.hooks ?? {}) as Record<string, Line[]>;
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((group) =>
    (Array.isArray(group?.hooks) ? group.hooks : []).filter((h: Line) => isDeepBuild(h.command)).map((h: Line) => ({ event, command: String(h.command) }))));
}

/**
 * `deep setup`, HOME the test's home, run by you with a hub already answering and launchctl/systemctl stubbed (README:
 * Setup). Fails unless it exits 0 with DeepBuild's PreToolUse and Stop entries in Claude Code's user settings, and
 * builds the deep-hook they name. Returns that binary's path.
 */
export async function setup(h: Home, env: Record<string, string | undefined> = {}): Promise<string> {
  await cargoBuild(false);
  confirmWith(h, 'confirmed');
  const r = await deep(h.home, ['setup'], { env });
  confirmWith(h, 'cancelled');
  if (r.code !== 0) throw Error(`deep setup must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  if (!existsSync(settingsFile(h.home))) throw Error(`deep setup exited 0 but wrote no ${settingsFile(h.home)}: ${shown(r)}`);
  const ours = deepEntries(readSettings(h.home));
  const pre = ours.find((e) => e.event === 'PreToolUse' && /deep-hook/.test(e.command));
  if (!pre || !ours.some((e) => e.event === 'Stop')) throw Error(`deep setup must write DeepBuild's PreToolUse and Stop entries into ${settingsFile(h.home)}: ${JSON.stringify(ours)}`);
  for (const e of ours) if (/deep-hook/.test(e.command)) await hookBinary(e.command);
  return hookBinary(pre.command);
}

// ---- Guard entries: rules.json, the shipped defaults and one gate of your own.
/** Your own guard entry: a block, not fail_closed, so only the hub enforces it; `deep off` makes it watch-only. */
export const YOUR_GATE = 'yours-no-make-release';
export const YOUR_GATE_COMMAND = 'make release';
const yourGate = {
  match: `run:${YOUR_GATE_COMMAND}`, scope: 'you', mode: 'block', fail_closed: false,
  reason: 'You release by hand from the release checklist.', next_step: 'Ask the person to run the release.',
};
/**
 * ~/.deepbuild/rules.json after setup: whatever setup wrote, the shipped defaults (crates/deep-hook/default-rules.json)
 * where it wrote none, and your one gate added. Returns the names of its fail_closed entries.
 */
export function installRules(home: string): string[] {
  const file = join(rootOf(home), 'rules.json');
  const rules = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? { v: 1, entries: {} }) : (parseObject(readFileSync(DEFAULT_RULES, 'utf8'))!);
  rules.entries = { ...(rules.entries as Line), [YOUR_GATE]: yourGate };
  writeFileSync(file, `${JSON.stringify(rules, null, 2)}\n`, { mode: 0o600 });
  return Object.entries(rules.entries as Record<string, Line>).filter(([, e]) => e.fail_closed === true).map(([name]) => name);
}

// ---- Hubs as processes: `deep hub run [--root <folder>]`, HOME the test's home (#16).
export interface Hub { pid: number; home: string; socket: string; root: string; child: ChildProcess; output(): string }
export async function startHub(home: string, o: { root?: string; plant?: string | undefined } = {}): Promise<Hub> {
  const env = childEnv(home, { DEEP_HUB_PLANT: o.plant });
  const child = spawn(NODE, [CLI, 'hub', 'run', ...(o.root ? ['--root', o.root] : [])], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  if (!ready) throw Error(`BLOCKED: the hub${o.root ? ` at ${o.root}` : ''} didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${out.slice(0, 2000)}`);
  const root = o.root ?? rootOf(home);
  return { pid: child.pid!, home, socket: join(root, 'hub.sock'), root, child, output: () => out };
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
/** Whether a hub answers at `socket` with its hello. */
export const answers = (socket: string): Promise<boolean> => Conn.open(socket, 3000).then((c) => { c.close(); return true; }, () => false);
export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; subject?: string; session?: string; data: Line }
/** Every event in the hub's log, paged by log_pos through `events.read`. */
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

// ---- A forwarded socket at the address setting that keeps every byte both ways (#16's forwarder, #18's copy).
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
/** The address setting `{"hub": {"address": "unix:<path>"}}` in <home>/.deepbuild/config.json (#16), other keys kept. */
export function setAddress(home: string, path: string): void {
  const file = join(rootOf(home), 'config.json');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const config = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? {}) : {};
  config.hub = { ...(config.hub as Line | undefined), address: `unix:${path}` };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
/** The hub's acknowledgement of the request deep-hook sent through the forwarder for `pick`, once it is there. */
export function ackOf(fwd: Forwarder, pick: (request: Line) => boolean): { request: Line; ack: Line | undefined } | undefined {
  const request = jsonLines(fwd.upText()).filter((l) => typeof l.event === 'string' && pick(l)).at(-1);
  if (!request) return undefined;
  return { request, ack: jsonLines(fwd.downText()).find((l) => l.ack === request.id) };
}

// ---- Sessions and their hook payloads, shaped like the corpus's Claude Code payloads (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
/** A git repository for sessions to work in: the worktree. */
export function makeWorktree(tmp: string, name = `w${tag(2)}`): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1' } });
  return dir;
}
export function newSession(home: string, cwd: string, id: string = randomUUID()): Session {
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  if (!existsSync(transcript)) writeFileSync(transcript, '');
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
/** The transcript entry Claude Code writes for a prompt you typed; returns its prompt ID, which the hooks of its turn carry. */
export function typedPrompt(s: Session, text: string): string {
  const promptId = randomUUID();
  s.prompt = promptId;
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', type: 'user', promptId, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  return promptId;
}

// ---- The Claude Code stand-in (fixtures/claude.mjs): one process per session.
export interface HookRun { command: string; async: boolean; asyncRewake: boolean; timeout: number; pid: number; started: number; ended: number | null; code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; settingsError?: string }
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
  /** Claude Code for one session, HOME the test's home; `env` is added to what its hooks, its commands and its deep mcp get. */
  static start(home: string, env: Record<string, string | undefined> = {}): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), CLI, FACTS], { cwd: dirname(home), env: childEnv(home, env), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
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
    return (await this.send({ op: 'hook', event, payload: body, settings: settingsFile(this.home) })) as unknown as Fired;
  }
  /** A command as the Bash tool runs it, a child of this session's process. */
  async exec(command: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return (await this.send({ op: 'exec', command, cwd })) as unknown as { code: number; stdout: string; stderr: string };
  }
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
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-19-authority', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.notify('notifications/initialized');
  }
  /** A deep mcp tool call as Claude Code makes it: its PreToolUse first, then the call. */
  async deepTool(s: Session, tool: string, args: Line, timeoutMs = 120_000): Promise<Line> {
    await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args, tool_use_id: callId() }));
    return this.request('tools/call', { name: tool, arguments: args }, timeoutMs);
  }
}
/** The runs of DeepBuild's entries among a hook's synchronous ones. */
export const ours = (f: Fired): HookRun[] => f.ran.filter((r) => isDeepBuild(r.command));
export const firedShown = (f: Fired) => JSON.stringify(f.ran.map((r) => ({ command: r.command.slice(0, 160), code: r.code, signal: r.signal, timedOut: r.timedOut, stdout: r.stdout.slice(0, 400), stderr: r.stderr.slice(0, 400) })));
/** Claude Code's reading of a PreToolUse reply: a deny is exit 2 or a `permissionDecision: deny` (#315). */
export function denied(r: { code: number | null; stdout: string }): boolean {
  if (r.code === 2) return true;
  const out = parseObject(r.stdout.trim());
  return out?.hookSpecificOutput?.permissionDecision === 'deny' || out?.decision === 'block';
}

// ---- A session of the stand-in with its hooks running setup's entries, the hub reached through the forwarder.
export interface World { h: Home; hub: Hub; fwd: Forwarder; claude: Claude; s: Session; worktree: string; failClosed: string[]; hookBinary: string; plant?: string | undefined; stops: number }
/**
 * The installed hub (`deep hub run`, HOME the test's home, the plant if any), `deep setup`, rules.json with your gate,
 * a forwarder at the address setting, and one Claude Code session in a worktree that has started and taken a prompt.
 * `ask`: the session's own deep_ask is open, so its stop is one the hub holds (README: the probes).
 */
export async function world(o: { plant?: string | undefined; ask?: boolean; seed?: (h: Home, s: Session) => Promise<void> } = {}): Promise<World> {
  const h = makeHome();
  const worktree = makeWorktree(h.tmp);
  const s = newSession(h.home, worktree);
  if (o.seed) await o.seed(h, s);
  const plantEnv = o.plant ? { DEEP_HUB_PLANT: o.plant } : {};
  const hub = await startHub(h.home, { plant: o.plant });
  const binary = await setup(h, plantEnv);
  const failClosed = installRules(h.home);
  const fwd = await forwarder(h.tmp, hub.socket);
  setAddress(h.home, fwd.path);
  const claude = Claude.start(h.home, plantEnv);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Tidy the release notes, then stop.');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Tidy the release notes, then stop.' }));
  const w: World = { h, hub, fwd, claude, s, worktree, failClosed, hookBinary: binary, plant: o.plant, stops: 0 };
  if (o.ask) {
    await claude.initialize();
    const question = `Which changelog heading for ${tag(3)}?`;
    // The agent asks and doesn't wait: deep_ask answers "still waiting" in time, and the ask stays open.
    void claude.deepTool(s, 'deep_ask', { kind: 'choice', question, options: [{ id: 'added', label: 'Added' }, { id: 'changed', label: 'Changed' }], recommended: 'added' }).catch(() => undefined);
    await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === question), 60_000, `the deep_ask "${question}" filed under ${s.id}`);
  }
  return w;
}

// ---- The probes: what the next hook reply is (README: Gated and watch-only).
export type Reading = 'gated' | 'watch-only';
export interface Probe { reading: Reading; started: number; text: string }
/**
 * The session's next Bash call, `make release`, which your gate blocks: its PreToolUse runs setup's entries. Gated is
 * the hub's denial; watch-only is the hub's acknowledgement with no deny. A call deep-hook decided without the hub's
 * acknowledgement (the hub late under load) proves nothing either way and is tried again, up to `tries` times.
 */
export async function gateProbe(w: World, tries = 8): Promise<Probe> {
  let last = '';
  for (let i = 0; i < tries; i++) {
    const id = callId();
    const started = Date.now();
    const fired = await w.claude.hook('PreToolUse', payload(w.s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: YOUR_GATE_COMMAND, description: 'Release' }, tool_use_id: id }));
    const runs = ours(fired);
    if (!runs.length) throw Error(`BLOCKED: no entry of DeepBuild's ran for the PreToolUse: ${firedShown(fired)}`);
    const acked = ackOf(w.fwd, (l) => l.payload?.tool_use_id === id);
    last = `${id}: ${firedShown(fired)}; hub ack ${JSON.stringify(acked?.ack)}`;
    if (!acked?.ack) continue;
    return { reading: runs.some(denied) ? 'gated' : 'watch-only', started, text: last };
  }
  throw Error(`INCONCLUSIVE: in ${tries} tries no PreToolUse reached the hub within deep-hook's 20 ms (the machine is too loaded to read a gate): ${last}`);
}
/** A gate probe that must read `want`, retried until `deadline` (ms since epoch) for a probe started by then. */
export async function gateBy(w: World, want: Reading, deadline: number): Promise<Probe> {
  let probe = await gateProbe(w);
  while (probe.reading !== want && Date.now() < deadline) {
    await sleep(50);
    probe = await gateProbe(w);
  }
  return probe;
}
/**
 * The session's next stop: a prompt, then its Stop through setup's entries. Gated is a hold, a number in the hub's
 * acknowledgement (#16's hook protocol); watch-only is `hold_until_ms: null`. The Stop isn't waited for.
 */
export async function stopProbe(w: World): Promise<Probe & { ack: Line }> {
  typedPrompt(w.s, 'One more pass, then stop.');
  await w.claude.hook('UserPromptSubmit', payload(w.s, 'UserPromptSubmit', { prompt: 'One more pass, then stop.' }));
  const nth = ++w.stops;
  const started = Date.now();
  void w.claude.hook('Stop', payload(w.s, 'Stop')).catch(() => undefined);
  const pick = () => {
    const stops = jsonLines(w.fwd.upText()).filter((l) => l.event === 'Stop' && l.payload?.session_id === w.s.id);
    const request = stops[nth - 1];
    return request ? jsonLines(w.fwd.downText()).find((l) => l.ack === request.id) : undefined;
  };
  const ack = await waitFor(pick, 30_000, `the hub's acknowledgement of ${w.s.id}'s Stop #${nth}`);
  return { reading: typeof ack.hold_until_ms === 'number' ? 'gated' : 'watch-only', started, text: JSON.stringify(ack), ack };
}

// ---- A process an agent double-forked, so launchd adopted it and the peer check finds no agent above it.
export interface Forked { code: number; stdout: string; stderr: string; ended: number; chain: string }
/**
 * `deep <args>` run from the agent's shell (the stand-in's Bash tool) through a double fork: `( sleep 1; sh run.sh ) &`.
 * The shell between exits at once, so the subshell is left to launchd (PID 1) and nothing of the agent's is above the
 * command. The command records its ancestors; a chain that still reaches the agent, or doesn't end at PID 1, is
 * BLOCKED, since the test would prove nothing. Resolves with its exit code, output and the time it ended.
 */
export async function doubleForked(claude: Claude, args: readonly string[], cwd: string, dir: string): Promise<Forked> {
  const out = mkdtempSync(join(dir, 'f-'));
  const command = [NODE, CLI, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  writeFileSync(join(out, 'run.sh'), [
    'chain=""; p=$$',
    'while [ -n "$p" ] && [ "$p" -gt 1 ]; do chain="$chain $p"; p=$(ps -o ppid= -p "$p" | tr -d " "); done',
    `echo "$chain -> $p" > '${out}/chain'`,
    `${command} >'${out}/out' 2>'${out}/err' </dev/null; echo $? >'${out}/code.tmp'`,
    `'${NODE}' -e 'process.stdout.write(String(Date.now()))' >'${out}/ended'`,
    `mv '${out}/code.tmp' '${out}/code'`,
    '',
  ].join('\n'));
  const forked = await claude.exec(`( sleep 1; /bin/sh '${out}/run.sh' ) </dev/null >/dev/null 2>&1 &`, cwd);
  if (forked.code !== 0) throw Error(`BLOCKED: the double fork failed: ${forked.stderr}`);
  const deadline = Date.now() + 180_000;
  while (!existsSync(join(out, 'code'))) {
    if (Date.now() > deadline) throw Error(`BLOCKED: deep ${args.join(' ')}, double-forked, didn't finish in 180 s`);
    await sleep(50);
  }
  const read = (name: string) => readFileSync(join(out, name), 'utf8');
  const chain = read('chain').trim();
  const pids = chain.split('->')[0]!.trim().split(/\s+/).map(Number);
  if (pids.includes(claude.pid) || chain.split('->')[1]?.trim() !== '1') {
    throw Error(`BLOCKED: the double-forked deep ${args.join(' ')} wasn't adopted by launchd away from the agent (its shell's ancestors ${chain}, the agent ${claude.pid})`);
  }
  return { code: Number(read('code').trim()), stdout: read('out'), stderr: read('err'), ended: Number(read('ended')), chain };
}
/** Whether this machine adopts orphans to launchd: the double fork the criteria name is macOS's. */
export const ON_MACOS = process.platform === 'darwin';

// ---- What setup put in place: every file under HOME a hub or a session doesn't write as it runs.
/**
 * A digest of every file under HOME but the hub's running state (~/.deepbuild, except rules.json, config.json and
 * claude-hooks.json) and the sessions' transcripts (~/.claude/projects): setup's hook entries, the login service's
 * definition, the MCP registration, the skill, the status line and your settings all show here.
 */
export function setupSnapshot(home: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const rel = relative(home, path);
      if (rel === '.claude/projects' || rel === '.deepbuild/spool' || rel === '.deepbuild/logs' || rel === '.deepbuild/evidence') continue;
      const st = statSync(path, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) walk(path);
      else if (!rel.startsWith('.deepbuild/') || ['.deepbuild/rules.json', '.deepbuild/config.json', '.deepbuild/claude-hooks.json'].includes(rel)) out[rel] = sha256(readFileSync(path));
    }
  };
  walk(home);
  return out;
}

// ---- The record, seeded before the hub starts, through the real record and asks core (as #24's suite seeds it).
const who = { actor: 'you', scope: 'you' };
const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = ULID_CHARS[t % 32] + time;
  let tail = '';
  for (let n = ++minted + Math.floor(Math.random() * 2 ** 40), i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = ULID_CHARS[n % 32] + tail;
  return time + tail;
}
const OPTIONS = [{ id: 'approve', label: 'Push it', decision: 'allow' }, { id: 'decline', label: 'Hold the push', decision: 'deny' }];
/**
 * An authority ask raised by DeepBuild's core for the session, open for a day, seeded into <home>/.deepbuild/ledger.db
 * with the hub stopped, after the session's start as its hook would record it. Returns its handle.
 */
export async function seedAuthorityAsk(home: string, s: Session, subject: string): Promise<string> {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  const now = Date.now();
  const record = await openRecord({ path: join(rootOf(home), 'ledger.db'), now: () => now });
  const asks = await openAsks({ record, now: () => now, deliver: () => undefined });
  try {
    await record.append({ writer: 'hook', ...who, session: s.id, project: 'shop', agent: 'claude-code' }, { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: s.cwd, branch: 'main', thread: s.id } });
    const core: Connection = { writer: 'core', ...who, session: s.id, project: 'shop' };
    const kind: AskKind = 'authority';
    const source = askSources().find((row) => row.kind === kind)!.source;
    return await asks.raise(core, source, {
      kind, question: `Push ${subject} to origin?`, options: structuredClone(OPTIONS), recommended: null, deadline: now + DAY,
      fallback: 'you', default: 'decline', provisional: false, owner: 'you', key: sha256(`${kind}:${subject}`),
      pinned_to: { kind: 'evidence', ref: sha256(subject) },
    });
  } finally {
    await record.close();
  }
}
/** The events that close an ask. */
const CLOSING = new Set(['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot']);
export function counted(all: readonly Ev[], handle: string): Ev[] {
  return all.filter((e) => (CLOSING.has(e.kind) && e.subject === handle)
    || ((e.kind === 'decision.created' || e.kind === 'decision.applied') && e.data?.ask === handle));
}
/** The ask is still open: nothing closed it, and no decision was saved from it or applied to it. */
export async function expectOpen(hub: Hub, handle: string, how: string): Promise<void> {
  await sleep(300); // anything the hub appends for the answer lands before this read
  const found = counted(await allEvents(hub), handle);
  expect(found.map((e) => `${e.kind} ${e.id}`), `ask ${handle} (${how}) counted: the ask must stay open and no decision be saved`).toEqual([]);
}
/** The answer counted once: one ask.answered from deep inbox answer, verified, and one decision saved from it. */
export async function expectCountedOnce(hub: Hub, handle: string, option: string, how: string): Promise<void> {
  const found = counted(await allEvents(hub), handle);
  expect(found.filter((e) => e.kind === 'ask.answered').map((e) => [e.data.answer, e.data.via, e.data.verified]), `ask ${handle} (${how}), once the OS confirmed you, is answered exactly once, with ${option}, from deep inbox answer`).toEqual([[option, 'inbox', true]]);
  expect(found.filter((e) => e.kind === 'decision.created').length, `ask ${handle} (${how}), once the OS confirmed you, saves exactly one decision`).toBe(1);
}
