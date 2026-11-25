// Test-side tools for #2315's acceptance tests (README): temp folders and a temp HOME, a test repo whose worktree's
// stack is fixtures/server.mjs, the replacement environment@1 package (fixtures/recorder) sealed with the host's own
// packageDigest and listed as DeepBuild's release, a dev hub (`deep hub run --root`) with a client for its socket,
// and `deep env up` / `deep env down` as a person runs them. Nothing here stands in for the hub, the extension host
// or env-local: the tests reach them through the CLI, the hub's socket and the public entries the README names.
//
// Every wait here waits for the event it needs (a line on a pipe or a socket, a process's exit, a write to the
// replacement's log), each bounded by a deadline that only turns a hang into a failure.
//
// Safety: every folder is under /tmp/dh2315-*; HOME is a temp folder for this process and every child; the caller's
// CLAUDE_* and DEEP_* variables are removed first, so nothing reaches a real hub or ~/.deepbuild. Every process
// stopped is one this suite started, or one its server fixture wrote a PID file for, by PID, after checking the PID
// still runs one of this suite's programs; never by name or port. Nothing needs the network.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, watch, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { packageDigest, type ReleaseEntry } from '../../../packages/extension-host/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SERVER = join(FIXTURES, 'server.mjs');
const NODE = process.execPath;
/** The replacement provider's package ID, which a refusal must name (README, Choices). */
export const PROVIDER = 'tests/env-recorder';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_')) delete process.env[key];
let HOME: string | undefined;
function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh2315-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}

// ---- Temp folders: short real paths (a socket path fits in 104 bytes).
const made: string[] = [];
export function tempDir(): string {
  home();
  const dir = realpathSync(mkdtempSync('/tmp/dh2315-'));
  made.push(dir);
  return dir;
}
const sub = (dir: string, ...names: string[]): string => {
  const path = join(dir, ...names);
  mkdirSync(path, { recursive: true });
  return path;
};

// ---- Processes: this suite's children, and the servers its fixture recorded in a worktree's .pids folder.
const children = new Map<number, ChildProcess>();
const pidDirs = new Set<string>();
/** The server PIDs fixtures/server.mjs recorded in the folder, as `server.<pid>` files. */
export function serverPids(dir: string): number[] {
  const at = join(dir, '.pids');
  return existsSync(at) ? readdirSync(at).flatMap((n) => (/^server\.(\d+)$/.test(n) ? [Number(n.slice('server.'.length))] : [])) : [];
}
const command = (pid: number): string | undefined => {
  try {
    const out = execFileSync('/bin/ps', ['-ww', '-o', 'stat=,command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
    return /^Z/.test(out) ? undefined : out;
  } catch {
    return undefined;
  }
};
/** Whether the PID runs a live (not zombie) process. */
export const alive = (pid: number): boolean => command(pid) !== undefined;
const ours = (pid: number): boolean => {
  const c = command(pid);
  return c !== undefined && (c.includes(SERVER) || c.includes(CLI));
};
afterAll(async () => {
  for (const dir of pidDirs) for (const pid of serverPids(dir)) if (ours(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  await Promise.all([...children.values()].map((child) => stopChild(child)));
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
}, 60_000);
/** SIGTERM to a child of ours, then SIGKILL if it hasn't exited within 10 s. */
async function stopChild(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null || !ours(pid)) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  let timer: NodeJS.Timeout | undefined;
  // deadline: a hub that ignores SIGTERM is killed by its PID after 10 s, so cleanup never hangs.
  const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), 10_000); });
  if ((await Promise.race([exited, late])) === 'late' && ours(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  clearTimeout(timer);
}

/** The promise, or a failure naming what it waited for once `ms` pass. */
export async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  // deadline: only bounds a wait for an event, so a hang fails naming what never came.
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`timed out after ${ms} ms waiting for ${what}`)), ms); });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

// ---- A test repo: .deepbuild/done.yaml whose stack is the server fixture on the leased port `web`, and a worktree.
const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, HOME: home(), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
const git = (dir: string, ...args: string[]): string =>
  execFileSync('/usr/bin/git', ['-C', dir, '-c', 'user.name=dh2315', '-c', 'user.email=dh2315@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
export interface TestRepo { repo: string; worktree: string }
export function makeRepo(): TestRepo {
  const dir = tempDir();
  const repo = sub(dir, 'repo');
  const done = ['environment:', `  up: ${JSON.stringify(`'${NODE}' '${SERVER}'`)}`, '  ports: [web]', `  ready: { http: ${JSON.stringify('http://127.0.0.1:${web}/health')} }`, ''].join('\n');
  mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  writeFileSync(join(repo, '.deepbuild/done.yaml'), done);
  writeFileSync(join(repo, '.gitignore'), '.pids/\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'test repo');
  const worktree = join(dir, 'work');
  git(repo, 'worktree', 'add', '-q', '-b', 'work', worktree);
  pidDirs.add(realpathSync(worktree));
  pidDirs.add(realpathSync(repo));
  return { repo: realpathSync(repo), worktree: realpathSync(worktree) };
}

// ---- The replacement environment@1 package: fixtures/recorder, its settings written in, sealed by packageDigest.
const DIST = (name: string): string => join(REPO, 'packages', name, 'dist/index.js');
export interface Package { folder: string; log: string; entry: ReleaseEntry }
export function recorderPackage(dir: string): Package {
  const folder = sub(dir, 'recorder');
  cpSync(join(FIXTURES, 'recorder'), folder, { recursive: true });
  for (const name of readdirSync(folder)) if (name.endsWith('.fixture')) cpSync(join(folder, name), join(folder, name.slice(0, -'.fixture'.length)));
  for (const name of readdirSync(folder)) if (name.endsWith('.fixture')) rmSync(join(folder, name));
  const log = join(dir, 'recorder.log');
  writeFileSync(join(folder, 'recorder.json'), JSON.stringify({ record: DIST('record'), asks: DIST('asks'), supervisor: DIST('supervisor'), envLocal: DIST('env-local'), log }));
  const manifest = { id: PROVIDER, version: '1.0.0', digest: `d1:${'0'.repeat(64)}`, environments: ['local'], replaces: ['deepbuild/env-local'], requires: { preview: ['deep.registerEnvironment'] } };
  writeFileSync(join(folder, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { folder, log, entry: { id: PROVIDER, version: '1.0.0', digest: manifest.digest } };
}
/** The replacement's own record of each call the host made of it, a JSON line each (fixtures/recorder). */
export function calls(log: string): Line[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line);
}
/** The replacement's calls once one matches, waited for as writes to its log, within `ms`. */
export function callsOnce(log: string, match: (lines: Line[]) => boolean, ms: number, what: string): Promise<Line[]> {
  const dir = dirname(log);
  return within(new Promise<Line[]>((resolve) => {
    const look = (): boolean => {
      const lines = calls(log);
      if (!match(lines)) return false;
      watcher.close();
      resolve(lines);
      return true;
    };
    const watcher = watch(dir, () => void look());
    look();
  }), ms, what).catch((error: Error) => { throw Error(`${error.message}; the replacement's log holds ${JSON.stringify(calls(log))}`); });
}

// ---- The dev hub: `deep hub run --root <folder>`, ready at its first stdout line.
export interface Hub { pid: number; root: string; socket: string; child: ChildProcess; stderr(): string }
const childEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...process.env, HOME: home(), LC_ALL: 'C', ...extra });
/** A dev hub on `root`, with the OS confirmation stood in for (DEEP_HUB_TEST_CONFIRM) and `release` as DeepBuild's signed release (DEEP_HUB_TEST_RELEASE). */
export async function startHub(root: string, release: ReleaseEntry[]): Promise<Hub> {
  mkdirSync(root, { recursive: true });
  const confirm = join(dirname(root), 'confirm');
  writeFileSync(confirm, 'confirmed');
  const releaseFile = join(dirname(root), 'release.json');
  writeFileSync(releaseFile, JSON.stringify(release));
  const child = spawn(NODE, [CLI, 'hub', 'run', '--root', root], { cwd: root, env: childEnv({ DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_RELEASE: releaseFile }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.set(child.pid!, child);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const first = new Promise<Line | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (!out.includes('\n')) return;
      try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); }
    });
    child.once('exit', () => resolve(undefined));
  });
  const line = await within(first, 120_000, `the hub's ready line (deep hub run --root ${root})`).catch(() => undefined);
  if (!line?.ready) throw Error(`BLOCKED: the dev hub didn't start (deep hub run --root ${root}): ${err.slice(0, 2000)}`);
  return { pid: child.pid!, root, socket: String(line.socket), child, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  await stopChild(hub.child);
}

/** A connection to the hub's socket with a role's credential (the cli's or the app's), one JSON line per message. */
export class Client {
  private buffer = '';
  private waiting = new Map<string, (line: Line) => void>();
  private ids = 0;
  private constructor(private readonly sock: net.Socket, private readonly first: Promise<void>) {}
  static async open(hub: Hub, role: 'cli' | 'app' = 'cli'): Promise<Client> {
    const sock = net.connect(hub.socket);
    let hello!: () => void;
    const c = new Client(sock, new Promise<void>((resolve) => { hello = resolve; }));
    let greeted: ((line: Line) => void) | undefined;
    const roled = new Promise<Line>((resolve) => { greeted = resolve; });
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      c.buffer += chunk;
      for (let i = c.buffer.indexOf('\n'); i >= 0; i = c.buffer.indexOf('\n')) {
        let line: Line | undefined;
        try { line = JSON.parse(c.buffer.slice(0, i)) as Line; } catch { line = undefined; }
        c.buffer = c.buffer.slice(i + 1);
        if (!line) continue;
        hello();
        if (typeof line.id === 'string' && c.waiting.has(line.id)) c.waiting.get(line.id)!(line);
        else if (line.role === role) greeted?.(line);
      }
    });
    sock.on('error', () => undefined);
    await within(c.first, 30_000, 'the hub\'s hello on its socket');
    sock.write(`${JSON.stringify({ v: 1, hello: role, token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() })}\n`);
    await within(roled, 30_000, `the ${role} role on the hub's socket`);
    return c;
  }
  /** One call, its whole reply line: `result` or `error`. */
  async call(method: string, params: unknown, ms = 600_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const reply = new Promise<Line>((resolve) => this.waiting.set(id, resolve));
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    return within(reply, ms, `the hub's reply to ${method}`);
  }
  close(): void { this.sock.destroy(); }
}

/** The replacement installed in the running hub through its own install path (`extension.install`, #351: install, conformance with each slot's kit, load). */
export async function install(hub: Hub, pkg: Package): Promise<Line> {
  const c = await Client.open(hub);
  try {
    const reply = await c.call('extension.install', { from: pkg.folder });
    if ('error' in reply || reply.result?.status !== 'installed' || reply.result?.not_loaded) {
      throw Error(`BLOCKED: the replacement environment@1 package didn't install and load through the hub's extension host: ${JSON.stringify(reply)}`);
    }
    return reply.result as Line;
  } finally {
    c.close();
  }
}

/** A dev hub on a folder of its own with the replacement in DeepBuild's release, installed and loaded through it. */
export async function hubWithReplacement(): Promise<{ hub: Hub; pkg: Package }> {
  const dir = tempDir();
  const pkg = recorderPackage(dir);
  const hub = await startHub(join(dir, 'hub'), [pkg.entry]);
  await install(hub, pkg);
  return { hub, pkg };
}

// ---- `deep env up` and `deep env down`, as a person runs them in the worktree.
export interface Ran { code: number | null; stdout: string; stderr: string; out: Line | undefined }
function deep(args: string[], cwd: string, ms: number): Promise<Ran> {
  const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  children.set(child.pid!, child);
  let stdout = '';
  let stderr = '';
  child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  const closed = new Promise<Ran>((resolve) => child.once('close', (code) => {
    children.delete(child.pid!);
    let out: Line | undefined;
    for (const line of stdout.trim().split('\n').reverse()) {
      try { out = JSON.parse(line) as Line; break; } catch { /* not JSON */ }
    }
    resolve({ code, stdout, stderr, out });
  }));
  return within(closed, ms, `deep ${args.join(' ')} in ${cwd} to exit`);
}
export const envUp = (hub: Hub, worktree: string): Promise<Ran> => deep(['env', 'up', '--root', hub.root, '--json'], worktree, 300_000);
export const envDown = (hub: Hub, worktree: string): Promise<Ran> => deep(['env', 'down', '--root', hub.root, '--json'], worktree, 300_000);
/** What a run printed, for a failure's message. */
export const shown = (ran: Ran): string => `exit ${ran.code}, stdout ${ran.stdout.trim().slice(0, 800)}, stderr ${ran.stderr.trim().slice(0, 800)}`;
