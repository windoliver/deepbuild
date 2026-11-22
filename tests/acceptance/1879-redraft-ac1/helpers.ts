// Test-side tools for #1879 AC1's blind redraft: a real hub (`deep hub run`, with or without `--safe`) in a temp home,
// the one test package (fixtures/probe, test/safe1879) installed with `deep install <folder>` as you (the OS
// confirmation stubbed by DEEP_HUB_TEST_CONFIRM, as #1922's and #363's suites do), and `deep mcp actions` (the
// deep-actions server) spoken to as an agent's MCP client does, for find_actions: the actions loaded packages offer.
// No hub or CLI module is imported; the extension host's public entry is, for `packageDigest` only.
//
// Safety: every folder is under /tmp/dh1879r1-* and removed after the file; every child gets a temp HOME and none of
// the caller's DEEP_*, CLAUDE*, CODEX*, NODE_OPTIONS; nothing leaves the machine; every process is one this file
// started, stopped by its PID (a hub's own process group, which it leads, after the hub itself has ended).
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** The one installed package and the action it registers when it loads. */
export const PACKAGE = 'test/safe1879';
export const ACTION = 'ext.safe1879.ping';
/** The extension host's safe-mode refusal, as the issue quotes it. */
export const SAFE_REASON = 'safe mode: the hub loads no extension';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };

// ---- Temp folders and processes, all gone after the file.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1879r1-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const groups = new Set<number>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Signals a process group this file started (each hub leads its own): kill(-pgid) for that group only, never kill(-1). */
function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pgid) || pgid <= 1) return;
  try { process.kill(-pgid, signal); } catch { /* gone */ }
}
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  for (const pgid of groups) signalGroup(pgid, 'SIGKILL');
  owned.clear();
  groups.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 30_000);

function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|TMUX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
export interface Ran { code: number | null; stdout: string; stderr: string }
/** What a command said, both streams. */
export const said = (r: Ran) => `${r.stdout}\n${r.stderr}`;
export const shown = (r: Ran) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;

// ---- The world: a temp home, the stubbed OS confirmation, and a project folder the deep commands run in.
export interface World { tmp: string; home: string; project: string; confirm: string }
export function openWorld(): World {
  const tmp = tempDir();
  const w = { tmp, home: join(tmp, 'h'), project: join(tmp, 'proj'), confirm: join(tmp, 'confirm') };
  mkdirSync(w.home);
  mkdirSync(w.project);
  writeFileSync(w.confirm, 'confirmed\n');
  return w;
}

/** `deep <args>` as you, in the world's project folder. */
export function deep(w: World, args: readonly string[]): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd: w.project, env: childEnv(w.home), stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); if (child.pid) owned.delete(child.pid); resolve({ code, stdout, stderr }); });
  });
}

// ---- The package: fixtures/probe copied, index.ts.fixture renamed, its digest set by the host's packageDigest.
const { packageDigest } = await import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as typeof import('../../../packages/extension-host/src/index.ts');
export function probePackage(w: World): string {
  const dir = join(w.tmp, 'probe');
  cpSync(join(FIXTURES, 'probe'), dir, { recursive: true });
  renameSync(join(dir, 'index.ts.fixture'), join(dir, 'index.ts'));
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Line;
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

// ---- The hub, as a process of its own.
export interface Hub { pid: number; ready: Line; child: ChildProcess; output(): string }
/** `deep hub run` (with `--safe` when asked), up to its ready line: BLOCKED when it doesn't start. */
export async function startHub(w: World, o: { safe: boolean }): Promise<Hub> {
  const args = [CLI, 'hub', 'run', ...(o.safe ? ['--safe'] : [])];
  const child = spawn(NODE, args, { cwd: w.project, env: childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) { owned.add(child.pid); groups.add(child.pid); }
  let out = '';
  let err = '';
  child.stdout!.setEncoding('utf8').on('data', (d: string) => (out = (out + d).slice(-20_000)));
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-20_000)));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 180_000);
    child.stdout!.on('data', () => { if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); } });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  const command = `deep hub run${o.safe ? ' --safe' : ''}`;
  if (ready?.ready !== true || !child.pid) throw Error(`BLOCKED: the hub didn't start (${command}): ${out.slice(0, 500)} ${err.slice(-1500)}`);
  return { pid: child.pid, ready, child, output: () => `${out}\n${err}` };
}
/** Stops a hub this file started, by its PID, and waits for it to end; then whatever is left in its process group. */
export async function stopHub(hub: Hub): Promise<void> {
  if (hub.child.exitCode === null && hub.child.signalCode === null) {
    const ended = new Promise<void>((resolve) => hub.child.once('exit', () => resolve()));
    hub.child.kill('SIGTERM');
    await Promise.race([ended, sleep(20_000)]);
    if (hub.child.exitCode === null && hub.child.signalCode === null) { hub.child.kill('SIGKILL'); await ended; }
  }
  signalGroup(hub.pid, 'SIGTERM');
  await sleep(300);
  signalGroup(hub.pid, 'SIGKILL');
  owned.delete(hub.pid);
  groups.delete(hub.pid);
}

// ---- deep-actions (`deep mcp actions`), as an agent's MCP client talks to it: find_actions needs no session.
export class Actions {
  private lines: string[] = [];
  private wakers = new Set<() => void>();
  private n = 0;
  private constructor(readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { this.lines.push(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
      for (const wake of [...this.wakers]) wake();
    });
    child.stdin!.on('error', () => undefined);
  }
  static async start(w: World): Promise<Actions> {
    const child = spawn(NODE, [CLI, 'mcp', 'actions'], { cwd: w.project, env: childEnv(w.home), stdio: ['pipe', 'pipe', 'ignore'] });
    if (child.pid) owned.add(child.pid);
    const actions = new Actions(child);
    const init = await actions.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1879', version: '0' } });
    if (!init.result) throw Error(`BLOCKED: deep mcp actions refused initialize: ${JSON.stringify(init)}`);
    child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    return actions;
  }
  request(method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
    const id = ++this.n;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.wakers.delete(check); reject(Error(`BLOCKED: deep mcp actions gave no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        const found = this.lines.map((l) => parse(l)).find((l) => l?.id === id);
        if (found) { clearTimeout(timer); this.wakers.delete(check); resolve(found); }
        else if (this.child.exitCode !== null) { clearTimeout(timer); this.wakers.delete(check); reject(Error(`BLOCKED: deep mcp actions exited ${this.child.exitCode}`)); }
      };
      this.wakers.add(check);
      check();
    });
  }
  /** find_actions with no query: every action the loaded packages offer agents, `{action, extension}` each. BLOCKED when it gives no list. */
  async find(): Promise<Line[]> {
    const reply = await this.request('tools/call', { name: 'find_actions', arguments: { query: null } });
    const result = (reply.result ?? {}) as Line;
    const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
    const value = (result.structuredContent ?? parse(text)) as Line | undefined;
    if (reply.error || result.isError === true || !Array.isArray(value?.actions)) throw Error(`BLOCKED: find_actions gave no list of actions: ${JSON.stringify(reply).slice(0, 1500)}`);
    return value!.actions as Line[];
  }
  async stop(): Promise<void> {
    const pid = this.child.pid;
    if (this.child.exitCode !== null || !pid) return;
    const ended = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
    this.child.stdin!.end();
    this.child.kill('SIGTERM');
    await Promise.race([ended, sleep(5000)]);
    if (this.child.exitCode === null && this.child.signalCode === null) { this.child.kill('SIGKILL'); await ended; }
    owned.delete(pid);
  }
}
/** The listed actions that are the package's: by its action's name or its id. */
export const ofPackage = (actions: Line[]): Line[] => actions.filter((a) => a.action === ACTION || a.extension === PACKAGE);
