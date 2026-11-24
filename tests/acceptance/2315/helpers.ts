// Test-side tools for the #2315 acceptance tests: temp folders, a test repo whose done.yaml starts env-local's stack
// (fixtures/local-server.mjs, which leaves a marker), the replacement environment@1 package (fixtures/swap) and its
// call log, its install and conformance into a hub's home through the extension host's public entry with no hub
// running (as #2648's suite does), the dev hub as a process (`deep hub run --root`) with DeepBuild's release handed to
// it in DEEP_HUB_TEST_RELEASE, a client of its line protocol as the cli role, and `deep env up` / `deep env down` as a
// person runs them. Nothing here stands in for the hub, the extension host or env-local.
//
// Safety: every process the tests start, or that the log or markers name, is stopped by PID only, after checking the
// PID still runs one of this suite's programs; never by name or port. Every folder is under /tmp/dh2315-*; HOME is a
// temp folder for this process and every child; the agent's own CLAUDE_* and DEEP_* variables are removed first, so
// nothing here can reach a real hub or ~/.deepbuild. Nothing needs the network.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openExtensionHost, openTrust, packageDigest, type Installed, type ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { openSupervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
/** The replacement package: its ID and the environment name it registers. */
export const SWAP_ID = 'test/env-swap';
export const SWAP = 'swap';
/** "Naming the missing provider": its environment name or its package ID. */
export const NAMES_SWAP = /\bswap\b|test\/env-swap/;
const CONFORMANCE = join(REPO, 'packages/conformance/dist/index.js');
const REFERENCE_SERVER = join(REPO, 'packages/conformance/runtime/environment/');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_')) delete process.env[key];
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh2315-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}

const made: string[] = [];
export function tempDir(): string {
  home();
  const dir = realpathSync(mkdtempSync('/tmp/dh2315-'));
  made.push(dir);
  return dir;
}
export function sub(dir: string, ...names: string[]): string {
  const path = join(dir, ...names);
  mkdirSync(path, { recursive: true });
  return path;
}

export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(50);
  }
}

// ---- Processes. Stopped by PID only, and only while they still run one of this suite's programs.
const owned = new Set<number>();
export const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
function command(pid: number): string | undefined {
  try { return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(); } catch { return undefined; }
}
const ours = (pid: number): boolean => {
  const c = command(pid);
  return c !== undefined && (c.includes('/tmp/dh2315-') || c.includes(CLI) || c.includes(REFERENCE_SERVER));
};
const logs = new Set<string>();
const repos = new Set<string>();
/** Every PID this suite started, or that a provider's log or env-local's markers name. */
function pidsToStop(): Set<number> {
  const pids = new Set<number>(owned);
  for (const log of logs) for (const l of readLog(log)) if (Number.isInteger(l.handle?.pid)) pids.add(l.handle.pid as number);
  for (const dir of repos) for (const pid of envLocalRan(dir)) pids.add(pid);
  return pids;
}
export async function cleanup(): Promise<void> {
  const pids = [...pidsToStop()].filter(ours);
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while (pids.some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid) && ours(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  logs.clear();
  repos.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export function removeHome(): void {
  if (HOME) rmSync(HOME, { recursive: true, force: true });
}

// ---- A test repo: .deepbuild/done.yaml whose environment block starts env-local's stack, and its worktrees.
const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, HOME: home(), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
function git(dir: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', ['-C', dir, '-c', 'user.name=dh2315', '-c', 'user.email=dh2315@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
}
export interface TestRepo { repo: string; worktree(name: string): string }
/**
 * A git repo (branch main) whose done.yaml block is env-local's shape (#331's README): `up` runs the repo's own dev
 * server, a copy of fixtures/local-server.mjs committed in the repo, on the leased port `web`, ready once
 * GET /health on it answers 200. Only env-local reads `up`, so the marker it leaves means env-local ran.
 */
export function makeRepo(): TestRepo {
  const dir = tempDir();
  const repo = sub(dir, 'repo');
  mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  copyFileSync(join(FIXTURES, 'local-server.mjs'), join(repo, 'local-server.mjs'));
  writeFileSync(join(repo, '.deepbuild/done.yaml'), [
    'environment:',
    `  up: ${JSON.stringify(`'${NODE}' local-server.mjs`)}`,
    '  ports: [web]',
    `  ready: { http: ${JSON.stringify('http://127.0.0.1:${web}/health')}, within: 20 }`,
    '',
  ].join('\n'));
  writeFileSync(join(repo, '.gitignore'), '.envlocal/\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'test repo');
  repos.add(repo);
  return {
    repo,
    worktree(name: string): string {
      const path = join(dir, name);
      git(repo, 'worktree', 'add', '-q', '-b', name, path);
      repos.add(path);
      return realpathSync(path);
    },
  };
}
/** The PIDs of env-local's stack that ran in the folder: each left .envlocal/ran.<pid> there. */
export function envLocalRan(folder: string): number[] {
  const dir = join(folder, '.envlocal');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => { const m = /^ran\.(\d+)$/.exec(name); return m ? [Number(m[1])] : []; });
}

// ---- The replacement package and its log.
/** The package folder: fixtures/swap copied, index.ts.fixture renamed, swap.json written, its digest the host's own. */
export function swapPackage(log: string): { folder: string; entry: ReleaseEntry } {
  const folder = sub(tempDir(), 'swap');
  cpSync(join(FIXTURES, 'swap'), folder, { recursive: true });
  for (const name of readdirSync(folder)) if (name.endsWith('.fixture')) renameSync(join(folder, name), join(folder, name.slice(0, -'.fixture'.length)));
  writeFileSync(join(folder, 'swap.json'), `${JSON.stringify({ conformance: CONFORMANCE, log })}\n`);
  const manifestPath = join(folder, 'deepbuild.json');
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  m.digest = packageDigest(folder);
  writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`);
  logs.add(log);
  return { folder, entry: { id: String(m.id), version: String(m.version), digest: packageDigest(folder) } };
}
/** Each call the replacement provider was asked, in order: `up` (spec, lease, checkout), `ready` (handle), `down` (handle). */
export function readLog(log: string): Line[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line);
}

/**
 * Installs the package into the hub home `root` with no hub running, through the extension host's public entry, with
 * DeepBuild's release listing it so it is hub-bound and environment@1's kit runs at install, then its conformance.
 * BLOCKED unless the install passed the kit: the criterion is about a *kitted* replacement.
 */
export async function installSwap(root: string, pkg: { folder: string; entry: ReleaseEntry }): Promise<Installed> {
  const pre = tempDir();
  const record = await openRecord({ path: join(pre, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await openTrust({ record, now: Date.now });
  const host = await openExtensionHost({ record, asks, supervisor, trust, home: root, release: [pkg.entry], now: Date.now });
  try {
    await host.ready();
    const installed = await host.install({ from: pkg.folder, builtBy: null });
    if (!(installed.kits ?? []).some((k) => k.slot === 'environment@1' && k.fill === SWAP && k.verdict === 'PASS')) {
      blocked(`the replacement must install with environment@1's kit passed: kits ${JSON.stringify(installed.kits)}`);
    }
    const checked = await host.check(installed);
    if (!checked.passed) blocked(`the replacement must pass its conformance: ${checked.reasons.join('; ')}`);
    return installed;
  } finally {
    await host.close().catch(() => undefined);
    await supervisor.close().catch(() => undefined);
    await record.close().catch(() => undefined);
  }
}
/** DeepBuild's release as the hub is handed it (DEEP_HUB_TEST_RELEASE). */
export function releaseFile(entries: ReleaseEntry[]): string {
  const file = join(tempDir(), 'release.json');
  writeFileSync(file, `${JSON.stringify(entries)}\n`);
  return file;
}

// ---- The hub as a process: `deep hub run --root <folder>`.
function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home(), LC_ALL: 'C' };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
export interface Hub { pid: number; root: string; socket: string; child: ChildProcess; exit: Promise<unknown>; stderr(): string }
export async function startHub(root: string, release: string): Promise<Hub> {
  mkdirSync(root, { recursive: true });
  const child = spawn(NODE, [CLI, 'hub', 'run', '--root', root], { cwd: root, env: childEnv({ DEEP_HUB_TEST_RELEASE: release }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  const line = await Promise.race([ready, sleep(60_000).then(() => undefined)]);
  if (!line?.ready) blocked(`the hub didn't start (deep hub run --root ${root}): ${err.slice(0, 2000)}`);
  return { pid: child.pid!, root, socket: line!.socket as string, child, exit, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  if (!alive(hub.pid)) return;
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  await Promise.race([hub.exit, sleep(15_000)]);
  if (alive(hub.pid) && ours(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
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
  /** The reply's result, or its error as `{ error }`. */
  async call(method: string, params: unknown = {}, timeoutMs = 60_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await waitFor(() => this.lines.find((l) => l.id === id), timeoutMs, `the reply to ${method}`);
    return 'error' in reply ? { error: reply.error } : (reply.result as Line);
  }
  close(): void { this.sock.destroy(); }
}

// ---- `deep env up` and `deep env down`, as a person runs them in a worktree.
export interface Ran { code: number | null; stdout: string; stderr: string; out: Line | undefined }
function deep(args: string[], cwd: string, timeoutMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { if (child.pid && ours(child.pid)) child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      let out: Line | undefined;
      for (const line of stdout.trim().split('\n').reverse()) { try { out = JSON.parse(line) as Line; break; } catch { /* not JSON */ } }
      resolve({ code, stdout, stderr, out });
    });
  });
}
export const envUp = (hub: Hub, cwd: string): Promise<Ran> => deep(['env', 'up', '--root', hub.root, '--json'], cwd, 120_000);
export const envDown = (hub: Hub, cwd: string): Promise<Ran> => deep(['env', 'down', '--root', hub.root, '--json'], cwd, 60_000);
export const said = (r: Ran): string => `exit ${r.code}; stdout ${r.stdout.trim().slice(0, 600)}; stderr ${r.stderr.trim().slice(0, 600)}`;

/** One scene: a hub home with the replacement installed and kitted (its install-time calls dropped from its log), and a repo. */
export interface Scene { root: string; log: string; pkg: { folder: string; entry: ReleaseEntry }; installed: Installed; release: string; repo: TestRepo }
export async function scene(): Promise<Scene> {
  const dir = tempDir();
  const root = sub(dir, 'root');
  const log = join(dir, 'swap.log');
  const pkg = swapPackage(log);
  const installed = await installSwap(root, pkg);
  // The kit's own calls at install are not `deep env`'s.
  rmSync(log, { force: true });
  mkdirSync(dirname(log), { recursive: true });
  return { root, log, pkg, installed, release: releaseFile([pkg.entry]), repo: makeRepo() };
}
