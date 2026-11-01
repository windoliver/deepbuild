// Shared test-side tools for #27's acceptance tests (README): temp homes with stubbed system tools, a git repo the
// sessions work in, `deep setup` through the built CLI, the hub as a process and its socket, the Claude Code stand-in
// (fixtures/claude.mjs), sessions that ask through their own `deep mcp`, your answer with `deep inbox answer`, the
// record's delivery outcomes, `deep inbox` as you read it, the process table, the machine rule and the merge base's
// build. Most of it is adapted from tests/acceptance/25/routes/helpers.ts and tests/acceptance/25/live/{helpers,measure}.ts
// (same repo, same license); this suite keeps its own copy so a redraft of theirs never moves these tests. Nothing here
// stands in for DeepBuild: every test reaches it through the CLI, deep-hook and the waiter as setup's entries run them,
// the hub's socket and the files under the temporary home.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
export const SECOND = 1000;
export const MINUTE = 60_000;

// The criteria (README: Criteria to tests): `#27.<first 8 hex of SHA-256 of the criterion's text>`, as
// scripts/proof-change.mjs computes it.
export const AC1 = 'AC1 #27.778c531d';
export const AC2 = 'AC2 #27.6e863673';
export const AC3 = 'AC3 #27.f8331d25';
export const AC4 = 'AC4 #27.e6116d56';
export const AC5 = 'AC5 #27.ffbe7d6f';

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
export const readLines = (file: string | undefined): Line[] => { try { return file ? jsonLines(readFileSync(file, 'utf8')) : []; } catch { return []; } };
export const tag = (n = 6) => randomBytes(n).toString('hex');
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
/** An event's ts as epoch ms. */
export const msOf = (ts: number) => (ts > 1e14 ? Math.round(ts / 1e6) : ts);
export const iso = (ms: number) => new Date(ms).toISOString();

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh27-'));
  made.push(dir);
  return dir;
}
/** Which built CLI each temporary home runs: this checkout's, or the merge base's (budgets.test.ts). */
const clis = new Map<string, string>();
export const cliOf = (home: string): string => clis.get(home) ?? CLI;
/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts. `<tmp>/bin` comes first on PATH with stand-ins for
 * launchctl, systemctl and claude (each logs its call and exits 0) and a `deep` that runs the built CLI.
 */
export interface Home { tmp: string; home: string; bin: string }
export function makeHome(cli = CLI): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin);
  clis.set(home, cli);
  for (const name of ['launchctl', 'systemctl', 'claude']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${cli}' "$@"\n`);
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
/** A process and everything under it, by parent. */
export function treeOf(table: Proc[], root: number): Proc[] {
  const out: Proc[] = [];
  const walk = (pid: number) => { for (const p of table) if (p.ppid === pid && !out.includes(p)) { out.push(p); walk(p.pid); } };
  const self = table.find((p) => p.pid === root);
  if (self) out.push(self);
  walk(root);
  return out;
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
/** Process groups the stand-ins started for hook entries (each entry runs in its own group, as the stand-in's pid). */
const startedGroups = new Set<number>();
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
  for (const dir of made.splice(0)) {
    // A transcript a test made unreadable (timed_out) is made readable again so it can be removed.
    spawnSync('chmod', ['-R', 'u+rwX', dir]);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, no DEEP_, CLAUDE*, CODEX*, GIT_ or OTEL_ setting or billing key of this process's. */
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

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; started: number; ended: number }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number; onStart?: (child: ChildProcess) => void } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const started = Date.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    o.onStart?.(child);
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
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/** `deep <args>` from the home's built CLI, HOME the test's home. */
export function deep(home: string, args: readonly string[], o: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [cliOf(home), ...args], { env: childEnv(home, o.env), timeoutMs: o.timeoutMs ?? 180_000 });
}

// ---- deep-hook: setup names the path its entries run; one that is missing is built once, or the test is BLOCKED.
const builds = new Map<string, Promise<void>>();
function cargoBuild(release: boolean): Promise<void> {
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

// ---- Claude Code's user settings and DeepBuild's entries in it.
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

/** `deep setup` with HOME the test's home, a hub already answering; BLOCKED with the command's output unless it exits 0. */
export async function setup(home: string, env: Record<string, string | undefined> = {}): Promise<Ran> {
  const r = await deep(home, ['setup'], { env });
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  if (!existsSync(settingsFile(home))) throw Error(`BLOCKED: deep setup exited 0 but wrote no ${settingsFile(home)}: ${shown(r)}`);
  if (cliOf(home) === CLI) await ensureBinaries(readSettings(home));
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

// ---- The repo the sessions work in: a git repo with one commit, its git user in its own config (README: The repo).
export interface Repo { dir: string; commit: string }
export function makeRepo(home: string, files: Record<string, string> = {}): Repo {
  const dir = join(dirname(home), `repo${tag(2)}`);
  mkdirSync(dir, { recursive: true });
  const env = childEnv(home);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Acceptance 27');
  git('config', 'user.email', 'acceptance-27@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), '# A header colour\n\nThe page whose header colour the sessions ask about.\n');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'Start the page');
  return { dir, commit: git('rev-parse', 'HEAD') };
}

// ---- The hub as a process: `deep hub run`, HOME the test's home (#16).
export interface Hub { pid: number; home: string; socket: string; root: string; child: ChildProcess; output(): string }
/**
 * Two waits a test sits through only when it answers inside neither (#964): `noAskWait` gives the hub a 30 s MCP tool
 * timeout, so the deep_ask relation reads broken and deep_ask says "still waiting" at once, not after 40 s; `shortHold`
 * ends a stop's hold with nothing answered after SHORT_HOLD_MS, not 60 s (DEEP_HUB_TEST_STOP_HOLD_MS).
 */
export interface HubOptions { plant?: string | undefined; clock?: number | undefined; noAskWait?: boolean; shortHold?: boolean }
export const SHORT_HOLD_MS = 5000;
export async function startHub(home: string, o: HubOptions = {}): Promise<Hub> {
  const env = childEnv(home, { ...(o.plant ? { DEEP_HUB_PLANT: o.plant } : {}), DEEP_HUB_TEST_CLOCK: o.clock === undefined ? undefined : String(Math.round(o.clock)),
    MCP_TOOL_TIMEOUT: o.noAskWait ? '30000' : undefined, DEEP_HUB_TEST_STOP_HOLD_MS: o.shortHold ? String(SHORT_HOLD_MS) : undefined });
  const child = spawn(NODE, [cliOf(home), 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
export interface Ev { id: string; kind: string; log_pos: number; writer: string; ts: number; seq?: string; subject?: string; session?: string; project?: string; data: Line }
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
/** The inbox projection as the hub serves it (`inbox.read`): every ask's row, open or closed. */
export const inboxRows = (hub: Hub): Promise<Line[]> => control(hub, async (conn) => (await conn.call('inbox.read', {})).asks as Line[]);
/** The sessions table as the hub serves it (`sessions.read`). */
export const sessionRows = (hub: Hub): Promise<Line[]> => control(hub, async (conn) => (await conn.call('sessions.read', {})).sessions as Line[]);
/**
 * The state the record shows for a session (design: States people see): its newest `session.attention`, or `none`
 * when it has none yet. Its sessions row keeps `status` (running or ended), never these states.
 */
export async function stateOf(hub: Hub, session: string): Promise<string> {
  const attention = (await allEvents(hub)).filter((e) => e.kind === 'session.attention' && (e.session === session || e.subject === `session:${session.replace(/[^0-9A-Za-z]/g, '')}`)).at(-1);
  return String(attention?.data?.state ?? 'none');
}
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
/** Whether an event is about a session: its session, or its text names the session's ID. */
export const about = (e: Ev, session: string) => e.session === session || JSON.stringify(e).includes(session);
/** The kinds a hook itself writes: never an outcome DeepBuild recorded about a wait. */
export const HOOK_KINDS = new Set(['session.start', 'user.ask', 'tool.before', 'tool.after', 'tool.span', 'permission.request', 'agent.stop', 'session.end', 'task.completed', 'turn.usage', 'mcp.tools_listed', 'session.child_started']);

// ---- Sessions, their hook payloads and their transcripts, shaped like the corpus's (adapters/corpus/claude-code).
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
export function newSession(home: string, cwd?: string): Session {
  const id = randomUUID();
  const folder = cwd ?? join(dirname(home), `w${tag(3)}`);
  mkdirSync(folder, { recursive: true });
  const transcript = join(home, '.claude/projects', folder.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd: folder, transcript };
}
export const callId = () => `toolu_${randomBytes(12).toString('hex')}`;
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt) base.prompt_id = s.prompt;
  switch (event) {
    case 'SessionStart': Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); delete base.prompt_id; break;
    case 'Stop': Object.assign(base, { stop_hook_active: false, last_assistant_message: 'Done.' }); break;
    case 'SessionEnd': Object.assign(base, { reason: 'other' }); break;
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
export const transcriptEntries = (s: Session): Line[] => readLines(s.transcript);

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
  get pid(): number { return this.child.pid!; }
  /** Claude Code for one session, HOME the test's home; `env` is added to what its hooks and its deep mcp get. */
  static start(home: string, env: Record<string, string | undefined> = {}): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), cliOf(home), FACTS], { cwd: dirname(home), env: childEnv(home, env), stdio: ['pipe', 'pipe', 'inherit'] });
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
  async configure(o: { wake: boolean }): Promise<void> { await this.send({ op: 'configure', ...o }); }
  /** A command as the Bash tool runs it, a child of this Claude Code. */
  async exec(command: string, cwd: string): Promise<Line> { return this.send({ op: 'exec', command, cwd }); }
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
  private initialized = false;
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-27', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.notify('notifications/initialized');
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
  /** The live asyncRewake runs of DeepBuild's waiter for a session: started by a hook, not yet exited, with a live process in their group. */
  async liveWaiters(session: string): Promise<(HookRun & { event: string })[]> {
    const table = processes();
    return (await this.background()).filter((r) => r.asyncRewake && isDeepBuild(r.command) && r.session === session && r.ended === null && groupOf(r.pid, table).length > 0);
  }
  /** Stops the stand-in and what it started (the suite's own teardown of one measurement). */
  quit(): void { try { this.child.stdin!.write(`${JSON.stringify({ n: ++this.n, op: 'exit' })}\n`); } catch { /* gone */ } }
}
/** A tool's value as #26 reads it: its result's structuredContent, else the JSON in its first text block. */
export function toolValue(reply: Line): Line {
  if (reply.result?.structuredContent) return reply.result.structuredContent as Line;
  return parseObject(String(reply.result?.content?.[0]?.text ?? '')) ?? {};
}
/** The runs of DeepBuild's entries among a hook's. */
export const ours = (f: Fired): HookRun[] => [...f.ran, ...f.background].filter((r) => isDeepBuild(r.command));
export const firedShown = (f: Fired) => JSON.stringify({ blocked: f.blocked, runs: [...f.ran, ...f.background].map((r) => ({ command: r.command.slice(0, 160), code: r.code, signal: r.signal, timedOut: r.timedOut, stdout: r.stdout.slice(0, 600), stderr: r.stderr.slice(0, 600) })) });
/** What DeepBuild's synchronous entries replied to a hook: their stdout and stderr together. */
export const replied = (f: Fired): string => f.ran.filter((r) => isDeepBuild(r.command)).map((r) => `${r.stdout}\n${r.stderr}`).join('\n');

// ---- A session that asks you something through deep_ask (README: An asking session).
export interface Option { id: string; label: string }
export interface Question { question: string; options: Option[]; recommended: string; subject?: Line }
export interface Asking { s: Session; claude: Claude; handle: string; id: string; q: Question; blue: Option; green: Option; reply: Line }
/** A fresh choice between two header colours, blue recommended; with `subject`, pinned to a requirement. */
export function question(subject?: Line): Question {
  const t = tag(4);
  return { question: `Which header colour for the checkout page (${t})?`, options: [{ id: 'blue', label: `Blue header ${t}` }, { id: 'green', label: `Green header ${t}` }], recommended: 'blue', ...(subject ? { subject } : {}) };
}
/** deep_ask's arguments for a question, every nullable field given as the tool's schema lists it. */
export const askArgs = (q: Question): Line => ({ kind: 'choice', question: q.question, options: q.options, recommended: q.recommended, steps: null, where: null, why: null, check: null, subject: q.subject ?? null });
/**
 * A session of its own Claude Code: it starts, you type a prompt, the agent calls `deep_ask` and Claude Code waits for
 * the call as for any tool call; then its PostToolUse and the agent's last words. The session hasn't stopped yet.
 * `begin` resolves once the hub has filed the ask, with `finish` to wait for the call's reply.
 */
export async function beginAsk(hub: Hub, home: string, o: { env?: Record<string, string | undefined>; cwd?: string; q?: Question; claude?: Claude; s?: Session } = {}): Promise<{ s: Session; claude: Claude; finish: () => Promise<Asking> }> {
  const s = o.s ?? newSession(home, o.cwd);
  const claude = o.claude ?? Claude.start(home, o.env ?? {});
  if (!o.s) {
    await claude.hook('SessionStart', payload(s, 'SessionStart'));
    typedPrompt(s, 'Pick a header colour for the checkout page, then stop.');
    await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Pick a header colour for the checkout page, then stop.' }));
  }
  const q = o.q ?? question();
  let replied: Line | undefined;
  const replying = claude.tool(s, 'deep_ask', askArgs(q), 120_000).then((r) => (replied = r));
  const created = await waitFor(async () => replied?.error ? replied : (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === q.question), 60_000, `the deep_ask "${q.question}" filed under ${s.id}`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}; deep_ask replied ${JSON.stringify(replied ?? 'nothing yet').slice(0, 1500)}`); });
  if ('error' in created && !('kind' in created)) throw Error(`BLOCKED: deep_ask failed for ${s.id}: ${JSON.stringify(created).slice(0, 1500)}`);
  return {
    s, claude,
    finish: async () => {
      const reply = await replying;
      assistantSays(s, 'I asked which header colour you want; I will wait for your answer.');
      return { s, claude, handle: `ask:${(created as Ev).id}`, id: (created as Ev).id, q, blue: q.options[0]!, green: q.options[1]!, reply };
    },
  };
}
export async function askingSession(hub: Hub, home: string, o: Parameters<typeof beginAsk>[2] = {}): Promise<Asking> {
  return (await beginAsk(hub, home, o)).finish();
}
/** The session's Stop after it asked. */
export const stopAfterAsking = (a: Asking, extra: Line = {}): Promise<Fired> => a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.', ...extra }));
/** Your answer, given with `deep inbox answer` (#24, the OS confirmation stubbed); BLOCKED unless the command exits 0. */
export async function answer(home: string, handle: string, option: string, plant?: string): Promise<Ran> {
  const r = await deep(home, ['inbox', 'answer', handle, option], { env: plant ? { DEEP_HUB_PLANT: plant } : {} });
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ${handle} ${option} must exit 0: ${shown(r)}`);
  return r;
}
/** The record's delivery outcomes for an ask (delivery.outcome@1), in log order. */
export async function outcomes(hub: Hub, id: string): Promise<Ev[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'delivery.outcome' && (e.subject === `ask:${id}` || String(e.data?.delivery ?? '').replace(/^ask:/, '') === id));
}
export const outcomeList = (evs: Ev[]) => evs.map((e) => `${e.data?.outcome} via ${e.data?.via}`).join(', ') || 'none';
/** Whether a text carries a given option of an ask, by its label or its ID. */
export const carries = (text: string, o: Option): boolean => text.includes(o.label) || text.includes(o.id);

/**
 * `n` sessions, each of its own Claude Code, asking through deep_ask and stopping: each stop's hold ends with no answer,
 * so each session is idle, its waiter waiting. Sessions begin one at a time, so their hooks don't all start at once.
 */
export async function idleSessions(hub: Hub, home: string, n: number, o: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<Asking[]> {
  const begun = [];
  for (let i = 0; i < n; i++) begun.push(await beginAsk(hub, home, o));
  const sessions = await Promise.all(begun.map((b) => b.finish()));
  const stops = await Promise.all(sessions.map((a) => stopAfterAsking(a)));
  stops.forEach((fired, i) => { if (fired.blocked) throw Error(`BLOCKED: nothing is answered yet, so ${sessions[i]!.s.id}'s stop goes through: ${firedShown(fired)}`); });
  for (const a of sessions) await waitFor(async () => (await a.claude.liveWaiters(a.s.id)).length > 0 || undefined, 30_000, `the waiter of ${a.s.id}, waiting once its stop went through`)
    .catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
  return sessions;
}

// ---- `deep inbox` as you read it (README: Readings, AC2).
/** The lines of `deep inbox`, run as you run it; BLOCKED unless it exits 0. */
export async function inboxText(home: string, env: Record<string, string | undefined> = {}): Promise<string> {
  const r = await deep(home, ['inbox'], { env });
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox must exit 0: ${shown(r)}`);
  return r.stdout;
}
/**
 * Whether `deep inbox` shows an ask under "decided for you": a line naming its handle, where that line, or the nearest
 * line above it that names no ask (a heading), says "decided for you".
 */
export function decidedLine(text: string, handle: string): string | undefined {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.includes(handle));
  if (at < 0) return undefined;
  if (/decided for you/i.test(lines[at]!)) return lines[at];
  for (let i = at - 1; i >= 0; i--) {
    if (/\bask:[0-9A-Za-z]+/.test(lines[i]!)) continue;
    return /decided for you/i.test(lines[i]!) ? lines[at] : undefined;
  }
  return undefined;
}

// ---- Timing (README: AC5).
export function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
export const load = (): { one: number; cores: number } => ({ one: loadavg()[0]!, cores: availableParallelism() });

// ---- The machine (design: Numbers version 0 has to hold; the owner's rules for budgets).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
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

// ---- The merge base's side (AC5; adapted from tests/acceptance/25/live/measure.ts).
export interface Checkout { label: string; root: string; cli: string }
export const CURRENT: Checkout = { label: 'this checkout', root: REPO, cli: CLI };
const git = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
/** Whether the working tree's `paths` are the merge base's, uncommitted and untracked files included. */
const sameAs = (sha: string, paths: string[]) => spawnSync('git', ['diff', '--quiet', sha, '--', ...paths], { cwd: REPO }).status === 0
  && git('ls-files', '--others', '--exclude-standard', '--', ...paths) === '';
/**
 * The merge base with origin/main, built: this checkout when its code is the base's, else a copy from `git archive` at
 * /tmp/dh27-base-<sha12>, kept between runs, with its workspaces built (its node_modules linked to this checkout's when
 * the lockfiles match, else `npm ci`) and its deep-hook (copied when crates/ is the base's, else built).
 */
export async function mergeBase(): Promise<Checkout> {
  let sha: string;
  try { sha = git('merge-base', 'HEAD', 'origin/main'); } catch (e) { throw Error(`BLOCKED: no merge base with origin/main to compare with: ${(e as Error).message.split('\n')[0]}`); }
  const label = `the merge base ${sha.slice(0, 12)}`;
  if (sameAs(sha, ['packages', 'crates', 'Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json'])) return { label: `${label} (this checkout's own code)`, root: REPO, cli: CLI };
  const dir = `/tmp/dh27-base-${sha.slice(0, 12)}`;
  const co = { label, root: dir, cli: join(dir, 'packages/cli/dist/main.js') };
  if (existsSync(join(dir, '.built'))) return co;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync('/bin/sh', ['-c', `git -C '${REPO}' archive ${sha} | tar -x -C '${dir}'`], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  const step = async (what: string, command: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
    const r = await run(command, args, { cwd: dir, env, timeoutMs: 1_800_000 });
    if (r.code !== 0) throw Error(`BLOCKED: building ${label} for the comparison: ${what} failed: ${r.stderr.slice(-2000)}`);
  };
  if (git('show', `${sha}:package-lock.json`) === readFileSync(join(REPO, 'package-lock.json'), 'utf8').trim()) {
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
  if (sameAs(sha, ['crates', 'Cargo.toml', 'Cargo.lock']) && existsSync(join(REPO, 'target/debug/deep-hook'))) {
    mkdirSync(join(dir, 'target/debug'), { recursive: true });
    copyFileSync(join(REPO, 'target/debug/deep-hook'), join(dir, 'target/debug/deep-hook'));
    chmodSync(join(dir, 'target/debug/deep-hook'), 0o755);
  } else {
    await step('cargo build -p deep-hook', 'cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { ...process.env, CARGO_TARGET_DIR: join(dir, 'target') });
  }
  writeFileSync(join(dir, '.built'), `${sha}\n`);
  return co;
}
