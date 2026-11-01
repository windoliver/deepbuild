// Test-side tools for the #70 AC4 acceptance tests: the Linux gate (this must be Linux, with bubblewrap, on Ubuntu
// LTS or Fedora, named in the output), temp folders, the probe compiled from #236's fixtures/probe.c (only that one:
// #236's own `bins()` also builds an Objective-C helper against macOS frameworks, which can't build here), local
// listeners that stand for a host, the hub's socket and an agent's inbox socket, and what the probe wrote. Nothing
// here stands in for the sandbox: the tests reach it through `@deepbuild/supervisor` (README, The surface).
//
// Safety, as #236's helpers: every process the tests start is stopped by PID only, never by name or port; every
// folder is under /tmp/dh70-*; HOME is a temp folder for this process and every child; and the agent's own CLAUDE*
// and DEEP_* variables are removed first, so no sandbox failure can ever reach a real inbox socket or hub.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';

export const PROBE_SOURCE = fileURLToPath(new URL('../236/fixtures/probe.c', import.meta.url));
export const BWRAP = '/usr/bin/bwrap';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_')) delete process.env[key];
let HOME: string | undefined;
/** This process's HOME and every child's: a temp folder, made before the first thing a test starts. */
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh70-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
afterAll(() => {
  if (HOME) rmSync(HOME, { recursive: true, force: true });
  if (built) rmSync(built.dir, { recursive: true, force: true });
});

// ---- The Linux this runs on. The criterion names Ubuntu LTS and Fedora; a run elsewhere proves nothing of it.
export interface Distribution { id: string; like: string[]; pretty: string; version: string }
/** /etc/os-release, as the test names the distribution it ran on. */
export function distribution(): Distribution {
  const fields = new Map<string, string>();
  for (const line of readFileSync('/etc/os-release', 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=("?)(.*)\2$/.exec(line.trim());
    if (m) fields.set(m[1]!, m[3]!);
  }
  return { id: fields.get('ID') ?? '', like: (fields.get('ID_LIKE') ?? '').split(/\s+/).filter(Boolean), pretty: fields.get('PRETTY_NAME') ?? '', version: fields.get('VERSION') ?? '' };
}
/**
 * BLOCKED (thrown, never a skip) unless this is Linux with bubblewrap at /usr/bin/bwrap on Ubuntu LTS or Fedora;
 * otherwise the distribution this run names, printed once.
 */
export function linux(): Distribution {
  if (process.platform !== 'linux') throw Error(`BLOCKED: #70 AC4 runs on Linux (Ubuntu LTS, Fedora); this is ${process.platform}`);
  if (!existsSync('/etc/os-release')) throw Error('BLOCKED: no /etc/os-release to name the distribution');
  const d = distribution();
  const ubuntu = d.id === 'ubuntu' || d.like.includes('ubuntu');
  const fedora = d.id === 'fedora' || d.like.includes('fedora');
  if (!ubuntu && !fedora) throw Error(`BLOCKED: the criterion names Ubuntu LTS and Fedora; this is ${d.pretty || d.id}`);
  if (d.id === 'ubuntu' && !/\bLTS\b/.test(d.version)) throw Error(`BLOCKED: the criterion names Ubuntu LTS; this is ${d.pretty}`);
  if (!existsSync(BWRAP)) throw Error(`BLOCKED: bubblewrap isn't installed at ${BWRAP} on ${d.pretty}`);
  if (!announced) {
    announced = true;
    let version = '';
    try { version = execFileSync(BWRAP, ['--version'], { encoding: 'utf8' }).trim(); } catch { version = 'version unknown'; }
    console.log(`#70 AC4 on ${d.pretty} (${process.arch}), ${version} at ${BWRAP}`);
  }
  return d;
}
let announced = false;

// ---- Temp folders: short real paths (a Unix socket path must fit in sun_path).
const made: string[] = [];
export function tempDir(): string {
  home();
  const dir = realpathSync(mkdtempSync('/tmp/dh70-'));
  made.push(dir);
  return dir;
}
export function sub(dir: string, ...names: string[]): string {
  const path = join(dir, ...names);
  mkdirSync(path, { recursive: true });
  return path;
}

// ---- Processes this suite started. Stopped by PID only.
const owned = new Set<number>();
export function own(pid: number | undefined): void {
  if (pid) owned.add(pid);
}
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
/** Stops every process this suite started (SIGTERM, then SIGKILL) and removes its folders. */
export async function cleanup(): Promise<void> {
  const pids = [...owned];
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while (pids.some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- The probe (#236's fixtures/probe.c), built once per test process with `cc`.
export interface Bins { dir: string; probe: string }
let built: Bins | undefined;
export function bins(): Bins {
  if (built) return built;
  const dir = realpathSync(mkdtempSync('/tmp/dh70-bin-'));
  try {
    execFileSync('cc', ['-O1', '-o', join(dir, 'probe'), PROBE_SOURCE], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    throw Error(`BLOCKED: cc couldn't build ${PROBE_SOURCE}: ${String((error as { stderr?: Buffer }).stderr ?? error)}`);
  }
  built = { dir, probe: join(dir, 'probe') };
  return built;
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

// ---- Listeners: a host on 127.0.0.1, the hub's socket, an agent session's inbox socket.
export interface Listener { port: number; path: string; connections: number; close(): Promise<void> }
function listen(server: net.Server, at: { path?: string }): Promise<Listener> {
  let connections = 0;
  server.on('connection', (sock) => {
    connections++;
    sock.on('error', () => undefined);
    sock.resume();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    const done = () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : 0,
        path: at.path ?? '',
        get connections() { return connections; },
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
