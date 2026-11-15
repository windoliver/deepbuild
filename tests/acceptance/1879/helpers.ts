// Test-side tools for the #1879 acceptance tests: a real hub (`deep hub run`, with or without `--safe`) in a temp
// home, the one test package (fixtures/probe) installed with `deep install <folder>`, the hub's socket as the cli role
// (the OS confirmation stubbed by DEEP_HUB_TEST_CONFIRM) for events.read, and the hub's own stderr. Nothing of the
// hub, CLI or extension host is imported but the extension host's public entry, for `packageDigest` only.
//
// Safety: every folder is under /tmp/dh1879-* and removed after its file; HOME is a temp home for every child;
// DEEP_*, CLAUDE*, CODEX*, VITEST* and NODE_OPTIONS are left out of their environment; nothing leaves the machine;
// no model is called; every process is one this file started, stopped by its PID (a hub's group by
// process.kill(-pgid), the group this file made it lead).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** The test package, as fixtures/probe/deepbuild.json names it. */
export const ID = 'test/safe-probe';
export const VERSION = '1.0.0';
/** The safe-mode reason: the extension host's own words at the base (packages/extension-host/src/host.ts). */
export const SAFE_REASON = /safe mode/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };

// ---- Temp folders and processes, all gone after the file.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1879-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const groups = new Set<number>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  // A hub leads its own group (spawned detached): whatever it left in that group goes with it.
  for (const pgid of groups) try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  groups.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 30_000);

function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|VITEST)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
export interface Ran { code: number | null; stdout: string; stderr: string }
export const shown = (r: Ran) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
function run(args: readonly string[], home: string, cwd: string, extra: Record<string, string> = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(home, extra), stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// ---- The test package: fixtures/probe copied, `*.fixture` renamed, its digest set by the host's packageDigest.
const { packageDigest } = await import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as typeof import('../../../packages/extension-host/src/index.ts');
function unfixture(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) unfixture(path);
    else if (name.endsWith('.fixture')) renameSync(path, join(dir, name.slice(0, -'.fixture'.length)));
  }
}
export function probePackage(dir: string): string {
  cpSync(join(FIXTURES, 'probe'), dir, { recursive: true });
  unfixture(dir);
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Line;
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

// ---- The hub: `deep hub run [--safe]` in the world's home, its first stdout line the ready line.
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; ready: Line; stderr(): string }
export async function startHub(w: World, o: { safe: boolean }): Promise<Hub> {
  const args = [CLI, 'hub', 'run', ...(o.safe ? ['--safe'] : [])];
  const child = spawn(NODE, args, { cwd: REPO, env: childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) { owned.add(child.pid); groups.add(child.pid); }
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start (deep ${args.slice(1).join(' ')}): ${out.slice(0, 500)} ${err.slice(-1500)}`);
  const hub: Hub = { pid: child.pid!, socket: typeof ready.socket === 'string' ? ready.socket : join(w.home, '.deepbuild', 'hub.sock'), root: join(w.home, '.deepbuild'), child, ready, stderr: () => err };
  w.hub = hub;
  return hub;
}
/** Stops a hub this file started, by its PID, and waits for it to exit. */
export async function stopHub(hub: Hub): Promise<void> {
  if (hub.child.exitCode !== null || hub.child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => hub.child.once('exit', () => resolve()));
  try { process.kill(hub.pid, 'SIGTERM'); } catch { /* gone */ }
  const done = await Promise.race([exited.then(() => true), sleep(30_000).then(() => false)]);
  if (!done) {
    try { process.kill(-hub.pid, 'SIGKILL'); } catch { /* gone */ }
    await exited;
  }
  owned.delete(hub.pid);
  // What the hub started in its group is gone with it before the next hub opens the same home.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { process.kill(-hub.pid, 0); } catch { break; }
    await sleep(100);
  }
  try { process.kill(-hub.pid, 'SIGKILL'); } catch { /* gone */ }
  groups.delete(hub.pid);
}

/** One call on the hub's socket as the cli role, with the control token and this process for the peer check. */
async function control(hub: Hub, method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`BLOCKED: the hub gave no answer to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i)) ?? {};
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token, peer: { pid: process.pid, start } })}\n`); }
        else if (step === 1) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (line.id === 1) { clearTimeout(timer); sock.destroy(); resolve(line); }
      }
    });
  });
}
/** The hub's whole record, through events.read on the cli role. */
async function events(hub: Hub): Promise<Line[]> {
  const all: Line[] = [];
  for (let from = 0; ;) {
    const reply = await control(hub, 'events.read', { after: from, limit: 1000 });
    if (reply.error) throw Error(`BLOCKED: events.read was refused: ${JSON.stringify(reply.error)}`);
    const page = (reply.result as Line).events as Line[];
    all.push(...page);
    if (page.length < 1000) return all;
    from = page[page.length - 1]!.log_pos;
  }
}
const dataOf = (e: Line): Line => (typeof e.data === 'string' ? parse(e.data) ?? {} : e.data ?? {});
/**
 * How many times the package's code has started on this home, as the record shows: the process.starting events of
 * the sandboxed processes the extension host starts in a run folder of the hub's (`<root>/run-*`) to check or load a
 * package. The home has one package installed, so each is test/safe-probe's. After its install (its check and its
 * load), a start runs no check again, so a new one at a start is its load.
 */
export async function loads(hub: Hub): Promise<number> {
  const runs = `${join(hub.root, 'run-')}`;
  return (await events(hub)).filter((e) => e.kind === 'process.starting' && String(dataOf(e).cwd ?? '').startsWith(runs)).length;
}
/** Polls the record until the package's loads exceed `than`, or the time is up: the count last read. */
export async function loadsAbove(hub: Hub, than: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const n = await loads(hub);
    if (n > than || Date.now() > deadline) return n;
    await sleep(500);
  }
}
/** The hub's stderr lines that name the package as not loaded, `deep hub: extension <id>@<version> not loaded: <reason>`. */
export const notLoadedLines = (hub: Hub): string[] => hub.stderr().split('\n').filter((l) => l.includes(`${ID}@${VERSION}`) && l.includes('not loaded'));

// ---- A world: a temp home, a project folder, the stubbed OS confirmation, the package folder, and the hub of the moment.
export interface World { tmp: string; home: string; project: string; confirm: string; pkg: string; hub?: Hub }
export function world(): World {
  const tmp = tempDir();
  const w: World = { tmp, home: join(tmp, 'h'), project: join(tmp, 'proj'), confirm: join(tmp, 'confirm'), pkg: join(tmp, 'pkg') };
  mkdirSync(w.home);
  mkdirSync(w.project);
  writeFileSync(w.confirm, 'confirmed\n');
  probePackage(w.pkg);
  return w;
}
/** `deep install <the package folder>`, as you, confirmed by the stubbed OS, against the hub running now. */
export const install = (w: World): Promise<Ran> => run(['install', w.pkg], w.home, w.project, { DEEP_HUB_TEST_CONFIRM: w.confirm });

/**
 * The shared start: a hub without `--safe`, the package installed with `deep install` and seen loading (its own
 * process in the record), and that hub stopped. Anything short of that is BLOCKED: the setup, not the
 * criterion. Returns how many loads the record held when the hub stopped.
 */
export async function installed(w: World): Promise<number> {
  const hub = await startHub(w, { safe: false });
  const ran = await install(w);
  if (ran.code !== 0) throw Error(`BLOCKED: deep install of ${ID} on a hub without --safe didn't load it: ${shown(ran)}`);
  const n = await loadsAbove(hub, 0, 60_000);
  if (n < 1) throw Error(`BLOCKED: ${ID} installed and loaded, but the record shows no process of it, so a load can't be seen: hub stderr ${JSON.stringify(hub.stderr().slice(-1500))}`);
  await stopHub(hub);
  return n;
}
