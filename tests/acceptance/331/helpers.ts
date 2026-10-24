// Test-side tools for the #331 acceptance tests: temp folders, test repos with worktrees, the compiled escape
// fixture, ports and listeners on 127.0.0.1, the process table as `ps` and `lsof` show it, the hub as a process
// (`deep hub run --root`) with a small client for its line protocol, the `deep env` commands as a person runs
// them, Docker's reachability, and the reference-Mac timing judge. Nothing here stands in for the hub, the
// supervisor or env-local: the tests reach them through `deep env up`, `deep env down`, the hub's socket and the
// public entries the README names.
//
// Safety: every process the tests start is stopped by PID only, after checking the PID still runs one of this
// suite's programs, never by name or port; every folder is under /tmp/dh331-*; HOME is a temp folder for this
// process and every child; the agent's own CLAUDE_* and DEEP_* variables are removed first, so nothing here can
// reach a real hub or ~/.deepbuild. Nothing needs the network.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, type TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const SERVER = join(FIXTURES, 'server.mjs');
export const CHECK = join(FIXTURES, 'check.mjs');
export const NODE = process.execPath;
export const COMMIT = '0000000000000000000000000000000000000331';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_')) delete process.env[key];
let HOME: string | undefined;
/** This process's HOME and every child's: a temp folder, made before the first thing a test starts. */
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh331-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
afterAll(() => {
  if (HOME) rmSync(HOME, { recursive: true, force: true });
  if (built) rmSync(built.dir, { recursive: true, force: true });
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
  const dir = realpathSync(mkdtempSync('/tmp/dh331-'));
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
/** A folder a fixture writes <role>.<pid> files into; every PID there that runs one of our programs is ours to stop. */
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
/** The one PID of a role a fixture wrote, waited for. */
export async function pidOf(dir: string, role: string, timeoutMs = 10_000): Promise<number> {
  return waitFor(() => pidsIn(dir)[role]?.[0], timeoutMs, `${role}'s PID file in ${dir}`);
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
export interface Proc { pid: number; ppid: number; pgid: number; start: string; command: string }
/** The process as `ps` shows it (LC_ALL=C), or undefined once it's gone. */
export function proc(pid: number): Proc | undefined {
  try {
    const env = { ...process.env, LC_ALL: 'C' };
    const ids = execFileSync('ps', ['-o', 'ppid=,pgid=', '-p', String(pid)], { encoding: 'utf8', env }).trim().split(/\s+/).map(Number);
    const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env }).trim();
    const command = execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env }).trim();
    return { pid, ppid: ids[0]!, pgid: ids[1]!, start, command };
  } catch {
    return undefined;
  }
}
/** Whether the process's environment holds DEEP_RUN_TOKEN (read with `ps -E`; the value is never printed). */
export function hasRunToken(pid: number): boolean {
  try {
    const shown = execFileSync('/bin/ps', ['-E', '-ww', '-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
    return / DEEP_RUN_TOKEN=/.test(shown);
  } catch {
    return false;
  }
}
const ours = (pid: number): boolean => {
  const p = proc(pid);
  return p !== undefined && (p.command.includes('/tmp/dh331-') || p.command.includes(FIXTURES) || p.command.includes(CLI));
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

// ---- The compiled escape fixture (fixtures/escape.c), built once per test process with `cc`.
let built: { dir: string; escape: string } | undefined;
export function escapeBin(): string {
  if (built) return built.escape;
  const dir = realpathSync(mkdtempSync('/tmp/dh331-bin-'));
  try {
    execFileSync('cc', ['-O1', '-o', join(dir, 'escape'), join(FIXTURES, 'escape.c')], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    blocked(`cc couldn't build fixtures/escape.c: ${String((error as { stderr?: Buffer }).stderr ?? error)}`);
  }
  built = { dir, escape: join(dir, 'escape') };
  return built.escape;
}

// ---- Test repos: a git repo whose .deepbuild/done.yaml has an environment block, and its worktrees.
const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, HOME: home(), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
/** One git command, as a single call (`/usr/bin/git -C <dir> ...`). */
export function git(dir: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', ['-C', dir, '-c', 'user.name=dh331', '-c', 'user.email=dh331@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
}
/** The environment block of done.yaml (README, The repo's environment block). */
export interface EnvBlock { up?: string; compose?: string; ports: string[]; ready: string; within?: number }
export function doneYaml(env: EnvBlock): string {
  const q = (s: string) => JSON.stringify(s);
  return [
    'environment:',
    ...(env.up !== undefined ? [`  up: ${q(env.up)}`] : []),
    ...(env.compose !== undefined ? [`  compose: ${q(env.compose)}`] : []),
    `  ports: [${env.ports.join(', ')}]`,
    `  ready: { http: ${q(env.ready)}${env.within !== undefined ? `, within: ${env.within}` : ''} }`,
    '',
  ].join('\n');
}
/** Shell words, single-quoted. */
export const sh = (...words: string[]): string => words.map((w) => (/^[\w./=-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`)).join(' ');
/** The dev server fixture as a done.yaml `up` line: run in the folder env.up is given, its PID files in `.pids` there. */
export const serverUp = (...flags: string[]): string => `${sh(NODE, SERVER)} --pid-dir .pids${flags.length ? ` ${flags.join(' ')}` : ''}`;
export const READY = 'http://127.0.0.1:${web}/health';

export interface TestRepo { repo: string; worktree(name: string): string }
/** A git repo (branch main) with .deepbuild/done.yaml and the files given, committed; worktrees are siblings of it. */
export function makeRepo(env: EnvBlock, files: Record<string, string> = {}): TestRepo {
  const dir = tempDir();
  const repo = sub(dir, 'repo');
  for (const [path, text] of Object.entries({ '.deepbuild/done.yaml': doneYaml(env), '.gitignore': '.pids/\n.decoy/\n', ...files })) {
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
/** A plain folder holding a copy of the repo's files at its commit: a check's temporary checkout (not a worktree). */
export function makeCheckout(env: EnvBlock): string {
  const dir = sub(tempDir(), 'checkout');
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild/done.yaml'), doneYaml(env));
  ownPidDir(join(dir, '.pids'));
  return dir;
}

// ---- Ports on this machine.
/** Whether the port can be bound on the host right now (bound once and released). */
export function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen({ port, host, exclusive: true }, () => s.close(() => resolve(true)));
  });
}
const HOSTS = ['127.0.0.1', '0.0.0.0', '::'];
export async function freeEverywhere(port: number): Promise<boolean> {
  for (const host of HOSTS) if (!(await portFree(port, host))) return false;
  return !(await connects(port));
}
/** The first port from `from` up that nothing on this machine listens on. */
export async function firstFreeFrom(from: number): Promise<number> {
  for (let p = from; p < from + 200; p++) if (await freeEverywhere(p)) return p;
  return blocked(`no free port from ${from} to ${from + 199}`);
}
export function connects(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(1000, () => done(false));
  });
}
export interface Held { port: number; host: string; close(): Promise<void> }
const held: Held[] = [];
/** A listener of the test's own: "another program" on the port. */
export async function holdPort(port: number, host: string): Promise<Held> {
  const s = net.createServer((sock) => sock.destroy());
  await new Promise<void>((resolve, reject) => { s.once('error', reject); s.listen({ port, host, exclusive: true }, resolve); });
  const h = { port, host, close: () => new Promise<void>((r) => s.close(() => r())) };
  held.push(h);
  return h;
}
export async function releasePorts(): Promise<void> {
  await Promise.all(held.splice(0).map((h) => h.close()));
}
/** The PIDs listening on the TCP port, as lsof shows them. */
export function listeners(port: number): number[] {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
    return [...new Set(out.split('\n').filter((l) => l.startsWith('p')).map((l) => Number(l.slice(1))))];
  } catch {
    return [];
  }
}
/** GET /health on 127.0.0.1:port: its status and JSON body, or the error. */
export function health(port: number, path = '/health'): Promise<{ status: number | null; body: Line | null; error: string | null }> {
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
/** A dev hub on the folder; `env` carries the test-only variables (README, The hub's test-only variables). */
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
  if (!line?.ready) blocked(`the hub didn't start (deep hub run --root ${root}${Object.keys(env).length ? ` with ${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}): ${err.slice(0, 2000)}`);
  return { pid: child.pid!, root, socket: line!.socket as string, child, exit, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  if (!alive(hub.pid)) return;
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  await Promise.race([hub.exit, sleep(10_000)]);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
}

/** A client of the hub's line protocol with the cli role (README of #16, The socket). */
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
/** The port leases the record holds events for: `lease.acquired@1` etc. whose resource is a port. */
export const portEvents = (events: Line[], kind: string, port?: number): Line[] =>
  events.filter((e) => e.kind === kind && e.data?.resource?.kind === 'port' && (port === undefined || e.data.resource.key === String(port)));

// ---- `deep env up` and `deep env down`, as a person runs them in a worktree.
export interface Ran { code: number | null; stdout: string; stderr: string; ms: number }
export function deep(args: string[], o: { cwd: string; env?: Record<string, string | undefined>; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(NODE, [CLI, ...args], { cwd: o.cwd, env: childEnv(o.env), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { if (child.pid && ours(child.pid)) child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: performance.now() - t0 }); });
  });
}
/** The last line of stdout that parses as JSON. */
export function jsonOut(ran: Ran): Line | undefined {
  for (const line of ran.stdout.trim().split('\n').reverse()) {
    try { return JSON.parse(line) as Line; } catch { /* not JSON */ }
  }
  return undefined;
}
/** The command #331 builds is missing: this test fails (it is no other issue's surface, so not BLOCKED). */
const notBuilt = (what: string, ran: Ran): never => {
  throw Error(`${what} isn't built at this commit (exit ${ran.code}: ${(ran.stderr || ran.stdout).trim().slice(0, 300)})`);
};
export interface Up { ran: Ran; out: Line | undefined }
/** `deep env up --root <hub> --json` in the folder. Refuses a CLI that has no `env` command as not built. */
export async function envUp(hub: Hub, cwd: string, timeoutMs = 120_000): Promise<Up> {
  const ran = await deep(['env', 'up', '--root', hub.root, '--json'], { cwd, timeoutMs });
  const out = jsonOut(ran);
  if (ran.code === 2 && !out) notBuilt('deep env up', ran);
  return { ran, out };
}
/** `deep env up` that must come up: exit 0 and status ready, or the test fails naming what it printed. */
export async function upReady(hub: Hub, cwd: string, timeoutMs = 120_000): Promise<Line> {
  const { ran, out } = await envUp(hub, cwd, timeoutMs);
  expect(ran.code, `deep env up in ${cwd} exits 0 (stdout ${ran.stdout.trim().slice(0, 600)} stderr ${ran.stderr.trim().slice(0, 600)})`).toBe(0);
  expect(out?.status, `deep env up in ${cwd} reports ready: ${JSON.stringify(out)}`).toBe('ready');
  expect(typeof out?.run === 'string' && /^run:[0-9A-Za-z]+$/.test(out.run), `its run is a run: handle (${out?.run})`).toBe(true);
  expect(Number.isInteger(out?.ports?.web), `it names the port it leased for web (${JSON.stringify(out?.ports)})`).toBe(true);
  return out!;
}
export async function envDown(hub: Hub, cwd: string, timeoutMs = 60_000): Promise<Up> {
  const ran = await deep(['env', 'down', '--root', hub.root, '--json'], { cwd, timeoutMs });
  const out = jsonOut(ran);
  if (ran.code === 2 && !out) notBuilt('deep env down', ran);
  return { ran, out };
}

// ---- Docker, for the compose criterion. Nothing is pulled: a test that needs an image uses one already here.
export function docker(args: string[], timeoutMs = 60_000): { code: number | null; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('docker', args, { encoding: 'utf8', env: childEnv(), timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number | null; stdout?: string; stderr?: string; message: string };
    return { code: e.status ?? null, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message) };
  }
}
export const IMAGES = ['busybox:latest', 'busybox', 'alpine:latest'];
/** Why compose can't run here (BLOCKED, naming Docker), or the local image that serves the health file. */
export function dockerReady(): string {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], 15_000);
  if (info.code !== 0) blocked(`the Docker daemon is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] || `exit ${info.code}`}), so no compose stack can come up; this criterion needs Docker running`);
  const compose = docker(['compose', 'version'], 15_000);
  if (compose.code !== 0) blocked(`docker compose is not installed (docker compose version: ${compose.stderr.trim()})`);
  for (const image of IMAGES) if (docker(['image', 'inspect', image], 15_000).code === 0) return image;
  return blocked(`Docker has none of ${IMAGES.join(', ')} locally, and this test pulls nothing (no network); run docker pull busybox once`);
}

// ---- Timing on the reference Mac (tests/acceptance/14, 16 and 236's rule).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state. */
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
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
