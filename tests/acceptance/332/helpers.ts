// Test-side tools for the #332 acceptance tests: temp folders and a temp HOME, test repos with worktrees and a
// done.yaml environment block (README, The surface under test), plain checkouts for check runs, the hub as a
// process (`deep hub run --root`) with a small client for its line protocol, `deep env up`/`down` as a person runs
// them, the stack's own report of what it was given (fixtures/server.mjs, GET /env), and a ledger world (the
// core's budgets, #86) on a real record. Nothing here stands in for the hub, env-local, the lease table or the
// ledger: the tests reach them through `deep env up`, `deep env down`, the hub's socket, hooks and the public
// package entries the README names. Adapted from tests/acceptance/331/helpers.ts (same repo, same license); this
// suite keeps its own copy so a redraft of that suite never moves it.
//
// Safety: every process the tests start is stopped by PID only, after checking the PID still runs one of this
// suite's programs, never by name or port; every folder is under /tmp/dh332-*; HOME is a temp folder for this
// process and every child; the agent's own CLAUDE_* and DEEP_* variables are removed first, so nothing here can
// reach a real hub, a real keychain or ~/.deepbuild. Every credential value is a fake made up for the test.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const SERVER = join(FIXTURES, 'server.mjs');
export const SEED = join(FIXTURES, 'seed.mjs');
export const JOURNEY = join(FIXTURES, 'journey.mjs');
export const NODE = process.execPath;
export const COMMIT = '0000000000000000000000000000000000000332';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_')) delete process.env[key];
let HOME: string | undefined;
/** This process's HOME and every child's: a temp folder, made before the first thing a test starts. */
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh332-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
afterAll(() => {
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export function ulid(ms = Date.now()): string {
  return base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
}

// ---- Temp folders: short real paths (a Unix socket path fits in 104 bytes; Seatbelt matches real paths).
const made: string[] = [];
export function tempDir(): string {
  home();
  const dir = realpathSync(mkdtempSync('/tmp/dh332-'));
  made.push(dir);
  return dir;
}
export function sub(dir: string, ...names: string[]): string {
  const path = join(dir, ...names);
  mkdirSync(path, { recursive: true });
  return path;
}

// ---- Processes this suite started, and the PID files its fixtures write. Stopped by PID only.
const owned = new Set<number>();
const pidDirs = new Set<string>();
export function own(pid: number | undefined): void {
  if (pid) owned.add(pid);
}
export function ownPidDir(dir: string): string {
  pidDirs.add(dir);
  return dir;
}
export function pidsIn(dir: string): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const m = /^([a-z]+)\.(\d+)$/.exec(name);
    if (m) (out[m[1]!] ??= []).push(Number(m[2]));
  }
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
function command(pid: number): string | undefined {
  try {
    return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
  } catch {
    return undefined;
  }
}
const ours = (pid: number): boolean => {
  const c = command(pid);
  return c !== undefined && (c.includes('/tmp/dh332-') || c.includes(FIXTURES) || c.includes(CLI));
};
/** Stops every process this suite started or its fixtures recorded (SIGTERM, then SIGKILL), and removes the folders. */
export async function cleanup(): Promise<void> {
  const pids = new Set<number>();
  for (const pid of owned) if (ours(pid)) pids.add(pid);
  for (const dir of pidDirs) for (const list of Object.values(pidsIn(dir))) for (const pid of list) if (ours(pid)) pids.add(pid);
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...pids].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid) && ours(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  pidDirs.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- The repo's environment block (README, The surface under test).
/** A lease the environment names: the variable the stack reads its key from, the lease.kind@1 name, the keys. */
export interface LeaseSpec { kind: string; keys: string[] }
export interface EnvBlock {
  up: string;
  ports: string[];
  ready: string;
  within?: number;
  /** The variable each stack process reads its worktree's own host name from. */
  host?: string;
  /** Variable -> { kind, keys }: a key of that kind leased to the session, handed to the stack in the variable. */
  leases?: Record<string, LeaseSpec>;
  /** Variable -> its source: a dotfile (read as NAME=value lines, the variable's own line), named from HOME. */
  credentials?: Record<string, { dotfile: string }>;
  /** The seed step, and the variable that hands the seed its template and each run its own clone. */
  seed?: { run: string; database: string };
}
const q = (s: string) => JSON.stringify(s);
export function doneYaml(env: EnvBlock): string {
  const lines = [
    'environment:',
    `  up: ${q(env.up)}`,
    `  ports: [${env.ports.join(', ')}]`,
    `  ready: { http: ${q(env.ready)}${env.within !== undefined ? `, within: ${env.within}` : ''} }`,
  ];
  if (env.host) lines.push(`  host: ${env.host}`);
  if (env.leases) {
    lines.push('  leases:');
    for (const [variable, l] of Object.entries(env.leases)) lines.push(`    ${variable}: { kind: ${l.kind}, keys: [${l.keys.join(', ')}] }`);
  }
  if (env.credentials) {
    lines.push('  credentials:');
    for (const [variable, c] of Object.entries(env.credentials)) lines.push(`    ${variable}: { dotfile: ${q(c.dotfile)} }`);
  }
  if (env.seed) lines.push(`  seed: { run: ${q(env.seed.run)}, database: ${env.seed.database} }`);
  return `${lines.join('\n')}\n`;
}
/** Shell words, single-quoted. */
export const sh = (...words: string[]): string => words.map((w) => (/^[\w./=-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`)).join(' ');
/** The dev server fixture as a done.yaml `up` line: run in the folder the stack starts from, PID files in `.pids` there. */
export const serverUp = (): string => `${sh(NODE, SERVER)} --pid-dir .pids`;
/** The seed fixture as the seed step's command line. */
export const seedRun = (...flags: string[]): string => `${sh(NODE, SEED)}${flags.length ? ` ${flags.join(' ')}` : ''}`;
export const READY = 'http://127.0.0.1:${web}/health';

const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, HOME: home(), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
export function git(dir: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', ['-C', dir, '-c', 'user.name=dh332', '-c', 'user.email=dh332@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
}
export interface TestRepo { repo: string; worktree(name: string): string }
/** A git repo (branch main) with .deepbuild/done.yaml, committed; worktrees are siblings of it. */
export function makeRepo(env: EnvBlock): TestRepo {
  const dir = tempDir();
  const repo = sub(dir, 'repo');
  for (const [path, text] of Object.entries({ '.deepbuild/done.yaml': doneYaml(env), '.gitignore': '.pids/\n' })) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'test repo');
  ownPidDir(join(repo, '.pids'));
  return {
    repo,
    worktree(name: string): string {
      const path = join(dir, name);
      git(repo, 'worktree', 'add', '-q', '-b', name, path);
      ownPidDir(join(path, '.pids'));
      return realpathSync(path);
    },
  };
}
/** A plain folder holding the repo's files at its commit: a check's temporary checkout (not a worktree). */
export function makeCheckout(env: EnvBlock): string {
  const dir = sub(tempDir(), 'checkout');
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild/done.yaml'), doneYaml(env));
  ownPidDir(join(dir, '.pids'));
  return dir;
}

// ---- Waiting.
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(25);
  }
}

// ---- The stack's own report: GET <path> on 127.0.0.1:<port>, its status and JSON body.
export function get(port: number, path: string): Promise<{ status: number | null; body: Line | null; error: string | null }> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 2000 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => (text += d));
      res.on('end', () => {
        let body: Line | null = null;
        try { body = JSON.parse(text) as Line; } catch { body = null; }
        resolve({ status: res.statusCode ?? null, body, error: null });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: null, body: null, error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: null, body: null, error: (e as NodeJS.ErrnoException).code ?? e.message }));
  });
}
/** What the stack's server was given (fixtures/server.mjs, GET /env): the leased keys, its host name, and a digest of each credential. */
export async function given(port: number, what: string): Promise<Line> {
  const r = await get(port, '/env');
  expect(r.status, `${what}: GET /env on the stack's port ${port} answers 200 (${r.error ?? r.status})`).toBe(200);
  return r.body!;
}

// ---- The hub as a process: `deep hub run --root <folder>` (#16).
export function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home(), LC_ALL: 'C' };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
export interface Hub { pid: number; root: string; socket: string; child: ChildProcess; exit: Promise<unknown>; stderr(): string }
/** A hub on the folder (the home's own root when the agents' `deep mcp` must find it); `env` carries test-only variables. */
export async function startHub(root: string, env: Record<string, string | undefined> = {}): Promise<Hub> {
  mkdirSync(root, { recursive: true });
  const child = spawn(NODE, [CLI, 'hub', 'run', '--root', root], { cwd: root, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise((resolve) => child.on('exit', resolve));
  const ready = new Promise<Line | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) {
        try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); }
      }
    });
    void exit.then(() => resolve(undefined));
  });
  const line = await Promise.race([ready, sleep(20_000).then(() => undefined)]);
  if (!line?.ready) throw Error(`BLOCKED: the hub didn't start (deep hub run --root ${root}): ${err.slice(0, 2000)}`);
  return { pid: child.pid!, root, socket: line.socket as string, child, exit, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  if (!alive(hub.pid)) return;
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  await Promise.race([hub.exit, sleep(10_000)]);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
}

/** A client of the hub's line protocol with the cli role. */
export class Client {
  private buffer = '';
  private lines: Line[] = [];
  private ids = 0;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        try { this.lines.push(JSON.parse(this.buffer.slice(0, i)) as Line); } catch { /* not a line of ours */ }
        this.buffer = this.buffer.slice(i + 1);
      }
    });
    sock.on('error', () => undefined);
  }
  static async open(hub: Hub): Promise<Client> {
    const sock = net.connect(hub.socket);
    await new Promise<void>((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject); });
    const c = new Client(sock);
    await waitFor(() => c.lines.length > 0, 5000, 'the hub\'s hello');
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() })}\n`);
    await waitFor(() => c.lines.some((l) => l.role === 'cli'), 5000, 'the cli role');
    return c;
  }
  async call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await waitFor(() => this.lines.find((l) => l.id === id), timeoutMs, `the reply to ${method}`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  async events(kind?: string): Promise<Line[]> {
    const out: Line[] = [];
    for (let after = 0; ;) {
      const page = await this.call('events.read', { after, limit: 1000 });
      const events = page.events as Line[];
      if (!events.length) break;
      out.push(...events);
      after = events[events.length - 1]!.log_pos as number;
    }
    return kind ? out.filter((e) => e.kind === kind) : out;
  }
  close(): void { this.sock.destroy(); }
}
/** The lease events the record holds for a resource of the kind (and key). */
export const leaseEvents = (events: Line[], kind: string, resourceKind: string, key?: string): Line[] =>
  events.filter((e) => e.kind === kind && e.data?.resource?.kind === resourceKind && (key === undefined || e.data.resource.key === key));
/** Whether a lease's holder names the session (Claude Code's IDs are UUIDs; a handle's ID may drop their dashes). */
export const holderIs = (holder: unknown, session: string): boolean =>
  typeof holder === 'string' && holder.replace(/-/g, '').toLowerCase().includes(session.replace(/-/g, '').toLowerCase());

// ---- `deep env up` and `deep env down`, as a person runs them in a worktree.
export interface Ran { code: number | null; stdout: string; stderr: string }
export function deep(args: string[], o: { cwd: string; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd: o.cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { if (child.pid && ours(child.pid)) child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
/** The last line of stdout that parses as JSON. */
export function jsonOut(ran: Ran): Line | undefined {
  for (const line of ran.stdout.trim().split('\n').reverse()) {
    try { return JSON.parse(line) as Line; } catch { /* not JSON */ }
  }
  return undefined;
}
/** `deep env up` that must come up: exit 0 and status ready, or the test fails naming what it printed. */
export function mustBeReady(ran: Ran, where: string): Line {
  const out = jsonOut(ran);
  expect(ran.code, `deep env up in ${where} exits 0 (stdout ${ran.stdout.trim().slice(0, 600)} stderr ${ran.stderr.trim().slice(0, 600)})`).toBe(0);
  expect(out?.status, `deep env up in ${where} reports ready: ${JSON.stringify(out)}`).toBe('ready');
  expect(Number.isInteger(out?.ports?.web), `it names the port it leased for web (${JSON.stringify(out?.ports)})`).toBe(true);
  return out!;
}

// ---- Files: every regular file under a folder, for a scan of what a value or a path reached.
export function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      let s;
      try { s = statSync(path); } catch { continue; }
      if (s.isDirectory()) walk(path);
      else if (s.isFile()) out.push(path);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}
/** The files under `dir` whose bytes hold `needle` as text, raw or base64. */
export function filesHolding(dir: string, needle: string): string[] {
  const forms = [Buffer.from(needle), Buffer.from(Buffer.from(needle).toString('base64').replace(/=+$/, ''))];
  return filesUnder(dir).filter((path) => {
    let bytes: Buffer;
    try { bytes = readFileSync(path); } catch { return false; }
    return forms.some((f) => bytes.includes(f));
  });
}

// ---- Hook replies (hook.reply@2): what deep-hook tells Claude Code about a tool call.
/** The reply line among the hub's lines for one hook request, or undefined. */
export function replyOf(lines: string[]): Line | undefined {
  for (const raw of lines) {
    let line: Line;
    try { line = JSON.parse(raw) as Line; } catch { continue; }
    if (typeof line.exit === 'number') return line;
  }
  return undefined;
}
/** Whether a hook reply denies the tool call: exit 2, or a deny/block decision in its stdout. */
export function denies(reply: Line | undefined): boolean {
  if (!reply) return false;
  if (reply.exit === 2) return true;
  let out: Line | undefined;
  try { out = JSON.parse(String(reply.stdout ?? '')) as Line; } catch { out = undefined; }
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  return said === 'deny' || said === 'block';
}
