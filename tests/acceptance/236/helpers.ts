// Test-side tools for the #236 acceptance tests: temp folders, the compiled probes (fixtures/*.c, *.m), local
// listeners that stand for a host, the hub's socket and an agent's inbox socket, the process table as `ps`
// shows it, the hub as a process with a small client for its line protocol, and the reference-Mac timing
// judge. Nothing here stands in for the supervisor or the sandbox: library tests reach them through
// `@deepbuild/supervisor` (world.ts), hub tests through `deep hub run` and its socket (README, The surface).
//
// Safety: every process the tests start is stopped by PID only, never by name or port; every folder is under
// /tmp/dh236-*; HOME is a temp folder for this process and every child; and the agent's own CLAUDE_* and
// DEEP_* variables are removed first, so no sandbox failure can ever reach a real inbox socket or hub.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, type TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const DAY = 86_400_000;
export const COMMIT = '33eaad3b33eaad3b33eaad3b33eaad3b33eaad3b';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_')) delete process.env[key];
let HOME: string | undefined;
/** This process's HOME and every child's: a temp folder, made before the first thing a test starts. */
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh236-home-'));
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
export const runId = (): string => `run:${ulid()}`;

// ---- Temp folders: short real paths (a Unix socket path fits in 104 bytes; Seatbelt matches real paths).
const made: string[] = [];
export function tempDir(): string {
  home();
  const dir = realpathSync(mkdtempSync('/tmp/dh236-'));
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
/** A folder a tree fixture writes <role>.<pid> files into; every PID there is ours to stop at cleanup. */
export function ownPidDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
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
export interface Proc { pid: number; ppid: number; pgid: number; start: string; command: string }
/** The process as `ps` shows it (LC_ALL=C), or undefined once it's gone. `start` is `ps -o lstart=`. */
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
  return p !== undefined && (p.command.includes('/tmp/dh236-') || p.command === 'sleep 600' || p.command === '/bin/sleep 600');
};
/** Stops every process this suite started or its fixtures recorded (SIGTERM, then SIGKILL), and removes the folders. */
export async function cleanup(): Promise<void> {
  const pids = new Set(owned);
  for (const dir of pidDirs) for (const list of Object.values(pidsIn(dir))) for (const pid of list) if (ours(pid)) pids.add(pid);
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...pids].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  pidDirs.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- The compiled probes (fixtures/probe.c, tree.c, devices.m), built once per test process with `cc`.
export interface Bins { dir: string; probe: string; tree: string; devices: string }
let built: Bins | undefined;
export function bins(): Bins {
  if (built) return built;
  const dir = realpathSync(mkdtempSync('/tmp/dh236-bin-'));
  const cc = (out: string, args: string[]) => {
    try {
      execFileSync('cc', ['-O1', '-o', join(dir, out), ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      throw Error(`BLOCKED: cc couldn't build fixtures/${out}: ${String((error as { stderr?: Buffer }).stderr ?? error)}`);
    }
  };
  cc('probe', [join(FIXTURES, 'probe.c')]);
  cc('tree', [join(FIXTURES, 'tree.c')]);
  cc('devices', ['-fobjc-arc', join(FIXTURES, 'devices.m'), '-framework', 'Foundation', '-framework', 'AVFoundation', '-framework', 'AudioToolbox', '-framework', 'CoreGraphics']);
  built = { dir, probe: join(dir, 'probe'), tree: join(dir, 'tree'), devices: join(dir, 'devices') };
  return built;
}
/** Copies the probes into a run's own folder (for a run whose grant names only that folder). */
export function binsIn(dir: string): Bins {
  const b = bins();
  const to = sub(dir, 'bin');
  for (const name of ['probe', 'tree', 'devices'] as const) {
    copyFileSync(b[name], join(to, name));
    chmodSync(join(to, name), 0o755);
  }
  return { dir: to, probe: join(to, 'probe'), tree: join(to, 'tree'), devices: join(to, 'devices') };
}

// ---- What a probe wrote: one JSON line per try.
export interface Try { op: string; target: string; ok: boolean; errno?: string }
export function tries(file: string): Try[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Try);
}
export function tried(file: string, op: string, target: string): Try {
  const found = tries(file).find((t) => t.op === op && t.target === target);
  if (!found) throw Error(`BLOCKED: the probe never reported ${op} ${target} (did it run? ${file}: ${JSON.stringify(tries(file))})`);
  return found;
}
/** A try the sandbox refused: not ok, with EPERM or EACCES (a refused connection or a missing file is no denial). */
export function expectDenied(t: Try, what: string): void {
  expect(t.ok, `${what}: the sandbox let ${t.op} ${t.target} through`).toBe(false);
  expect(['EPERM', 'EACCES'], `${what}: ${t.op} ${t.target} failed with ${t.errno}, not a sandbox denial`).toContain(t.errno);
}
export interface Device { device: 'camera' | 'microphone' | 'audio-output' | 'screen-capture'; sandbox: 'deny' | 'allow'; authorized: boolean; open: string }
export const DEVICES = ['camera', 'microphone', 'audio-output', 'screen-capture'] as const;
export function devicesIn(file: string): Device[] {
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Device) : [];
}

// ---- Listeners: a host on 127.0.0.1, the hub's socket, an agent session's inbox socket.
export interface Listener { port: number; path: string; connections: number; text(): string; close(): Promise<void> }
function listen(server: net.Server, at: { port?: number; path?: string }): Promise<Listener> {
  let connections = 0;
  let text = '';
  server.on('connection', (sock) => {
    connections++;
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => (text += d));
    sock.on('error', () => undefined);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    const done = () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : 0,
        path: at.path ?? '',
        get connections() { return connections; },
        text: () => text,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    };
    if (at.path) server.listen(at.path, done);
    else server.listen(0, '127.0.0.1', done);
  });
}
const listeners: Listener[] = [];
export async function tcpListener(): Promise<Listener> {
  const l = await listen(net.createServer(), {});
  listeners.push(l);
  return l;
}
export async function unixListener(path: string): Promise<Listener> {
  const l = await listen(net.createServer(), { path });
  listeners.push(l);
  return l;
}
export async function closeListeners(): Promise<void> {
  await Promise.all(listeners.splice(0).map((l) => l.close()));
}

// ---- Waiting.
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(20);
  }
}
/** Resolves with the promise's value, or with `pending` if it hasn't settled within ms. */
export async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'pending'> {
  return Promise.race([promise, sleep(ms).then(() => 'pending' as const)]);
}

// ---- The hub as a process: `deep hub run --root <folder>` (#16), as tests/acceptance/16 drives it.
export function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home(), LC_ALL: 'C' };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
export interface Hub { pid: number; root: string; socket: string; child: ChildProcess; exit: Promise<unknown>; stderr(): string }
export async function startHub(root: string, env: Record<string, string | undefined> = {}): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run', '--root', root], { cwd: REPO, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
/** kill -9, as a crash. */
export async function crashHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
}
export async function stopHub(hub: Hub): Promise<void> {
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
  async call(method: string, params: unknown = {}, timeoutMs = 15_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await waitFor(() => this.lines.find((l) => l.id === id), timeoutMs, `the reply to ${method}`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  async events(): Promise<Line[]> {
    const out: Line[] = [];
    for (let after = 0; ;) {
      const page = await this.call('events.read', { after, limit: 1000 });
      const events = page.events as Line[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos as number;
    }
  }
  close(): void { this.sock.destroy(); }
}
export async function runFinished(client: Client, run: string, timeoutMs = 20_000): Promise<Line> {
  return waitFor(async () => (await client.events()).find((e) => e.kind === 'run.finished' && e.data?.run === run), timeoutMs, `run.finished for ${run}`);
}

// ---- Timing on the reference Mac (tests/acceptance/14 and 16's rule).
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
