// Tools for #1828's AC3, written blind (README.md): a real hub (`deep hub run`) in a temp home with the OS confirmation
// stubbed (DEEP_HUB_TEST_CONFIRM), packages installed and answered through `deep` commands as you run them, and the
// record read through the hub's socket (`events.read` on a cli connection, as `deep` reads it). No hub or CLI module is
// imported; the two package helpers the fixtures are stamped with (packageDigest, d1Digest) come through their packages'
// public entries. Processes are stopped by PID only, never by name or port.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { d1Digest } from '../../../../packages/contracts/src/index.ts';
import { packageDigest } from '../../../../packages/extension-host/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export type Line = { [key: string]: any };
const parse = (text: string): Line | undefined => { try { return JSON.parse(text) as Line; } catch { return undefined; } };
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Processes and folders this file made: stopped by PID and removed after the file.
const owned = new Set<number>();
const made: string[] = [];
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 30_000);
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh1828-${tag}-`));
  made.push(dir);
  return dir;
}

if (!existsSync(CLI)) throw Error(`BLOCKED: ${CLI} isn't built; run npm run build --workspaces first`);

/** This environment with HOME moved to the test's home and none of the hub's own settings, plus `extra`. */
function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('TMUX') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:/usr/bin:/bin`, LC_ALL: 'C', NO_COLOR: '1', ...extra };
}

// ---- `deep <args>`, as you run it from your own terminal: a child of this test, never of an agent.
export interface Ran { code: number | null; stdout: string; stderr: string }
export interface Running { pid: number; ended: Ran | undefined; done: Promise<Ran>; output(): string }
export function deepStart(home: string, args: readonly string[], timeoutMs = 300_000): Running {
  const child = spawn(NODE, [CLI, ...args], { cwd: home, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
  if (child.pid) owned.add(child.pid);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  const running: Running = {
    pid: child.pid!, ended: undefined, output: () => `exit ${running.ended?.code ?? 'none yet'}\nstdout: ${stdout}\nstderr: ${stderr}`,
    done: new Promise((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.on('close', (code) => { clearTimeout(timer); running.ended = { code, stdout, stderr }; resolve(running.ended); });
    }),
  };
  return running;
}
export const deep = (home: string, args: readonly string[], timeoutMs?: number): Promise<Ran> => deepStart(home, args, timeoutMs).done;

// ---- The hub: `deep hub run` with HOME at the test's home, so its root is <home>/.deepbuild.
export interface Hub { pid: number; home: string; root: string; output(): string }
export async function startHub(): Promise<Hub> {
  const tmp = tempDir('hub');
  const home = join(tmp, 'h');
  mkdirSync(home);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: home, env: childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 180_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parse(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, root: join(home, '.deepbuild'), output: () => out };
}

/** Every event in the hub's record, read on one cli connection holding the control token, as `deep` reads it. */
export async function events(hub: Hub): Promise<Line[]> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  const sock = net.connect(join(hub.root, 'hub.sock'));
  const lines: Line[] = [];
  const wakers = new Set<() => void>();
  let buffer = '';
  sock.setEncoding('utf8').on('data', (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      lines.push(parse(buffer.slice(0, i)) ?? {});
      buffer = buffer.slice(i + 1);
    }
    for (const w of [...wakers]) w();
  });
  sock.on('error', () => { for (const w of [...wakers]) w(); });
  const wait = (pred: () => boolean, ms = 30_000): Promise<void> => new Promise((resolve, reject) => {
    const check = () => { if (pred()) { clearTimeout(timer); wakers.delete(check); resolve(); } };
    const timer = setTimeout(() => { wakers.delete(check); reject(Error('BLOCKED: the hub gave no answer on its socket')); }, ms);
    wakers.add(check);
    check();
  });
  try {
    await wait(() => lines.length >= 1);
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    await wait(() => lines.length >= 2);
    if (lines[1]!.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(lines[1])}`);
    const all: Line[] = [];
    for (let after = 0, n = 0; ; n++) {
      const id = `t1828#${n}`;
      sock.write(`${JSON.stringify({ v: 1, id, method: 'events.read', params: { after, limit: 1000 } })}\n`);
      await wait(() => lines.some((l) => l.id === id));
      const reply = lines.find((l) => l.id === id)!;
      if (reply.error) throw Error(`BLOCKED: events.read refused: ${JSON.stringify(reply.error)}`);
      const raw = reply.result.events as Line[] | string;
      const page = typeof raw === 'string' ? JSON.parse(raw) as Line[] : raw;
      if (!page.length) return all;
      all.push(...page);
      after = Math.max(after + 1, Number(reply.result.log_pos ?? page[page.length - 1]!.log_pos));
    }
  } finally {
    sock.destroy();
  }
}

/** The versions of `id` the hub's extension host has installed, from its installed.json under the hub's root. */
export function installedVersions(hub: Hub, id: string): string[] {
  const file = join(hub.root, 'extensions', 'installed.json');
  if (!existsSync(file)) return [];
  const entries = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { version?: string }>;
  return Object.entries(entries).filter(([key]) => key === id).map(([, e]) => String(e.version));
}

// ---- Packages: a folder with deepbuild.json and index.ts, its envelope digest stamped as the installer checks it.
export interface Shape { [key: string]: unknown }
export const digestOf = (schema: Shape): string => d1Digest(schema as Parameters<typeof d1Digest>[0]);
export function makePackage(o: { id: string; version: string; manifest: Record<string, unknown>; index: string }): string {
  const dir = tempDir(`pkg-${o.id.replace('/', '-')}-${o.version}`);
  writeFileSync(join(dir, 'index.ts'), o.index);
  const manifest: Line = { id: o.id, version: o.version, digest: `d1:${'0'.repeat(64)}`, ...o.manifest };
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  manifest.digest = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (packageDigest(dir) !== manifest.digest) throw Error(`BLOCKED: stamping ${o.id}@${o.version}'s digest changed its digest`);
  return dir;
}

/** Polls `probe` until it gives a value, or until `ms`; undefined then. */
export async function until<T>(probe: () => Promise<T | undefined> | T | undefined, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined || Date.now() > end) return v;
    await sleep(250);
  }
}
