// #2570, blind redraft 3: `deep hub start --root <folder>` (the dev hub) asked for while a stopped hub's process is
// still exiting, and the two cases that must stay as today. Real `deep` CLI (packages/cli/dist/main.js), real
// `deep hub run`. The only instrument is linger.cjs, preloaded into the old hub through NODE_OPTIONS (see REDRAFT.md).
//
// Safety: every folder is under /tmp/d2570r3-*, removed after the file; HOME is a temp folder; DEEP_*, XDG_*,
// CLAUDE*, CODEX* and NODE_OPTIONS are dropped from the children's environment; every hub a test starts is stopped
// by its PID (read from the scene's trace or the hub's own ready line in hub.log), never by name or port.
//
// A step the machine was too slow for fails with a message starting INCONCLUSIVE, never passes.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const PRELOAD = fileURLToPath(new URL('./linger.cjs', import.meta.url));
const NODE = process.execPath;
/** How long the stopped hub stays alive after its socket closed: well past a loaded machine's spawn of the next hub. */
const LINGER_MS = 8_000;
/** `deep hub start`'s own wait, as the issue states it. */
const WAIT_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let dir = '';
let home = '';
const roots: string[] = [];
const waiting = new Set<Promise<unknown>>();

beforeAll(() => {
  if (!existsSync(CLI)) throw Error(`BLOCKED: ${CLI} is not built; run npm run build --workspaces`);
  dir = mkdtempSync('/tmp/d2570r3-');
  home = join(dir, 'home');
  mkdirSync(home);
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();
  console.log(JSON.stringify({ suite: '#2570 redraft 3', sha, date: new Date().toISOString(), node: process.version, platform: process.platform, cores: availableParallelism(), load: loadavg() }));
});

afterEach(async () => {
  for (const root of roots.splice(0)) await stopEvery(root);
  await Promise.all(waiting);
  waiting.clear();
}, 180_000);
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

/** The environment every child gets: this one without DeepBuild's, agents' or Node's own settings, HOME a temp one. */
function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ACC2570_)/.test(key) || key === 'NODE_OPTIONS') continue;
    out[key] = value;
  }
  return { ...out, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}

/** A new dev root with its trace file and the preload settings that shape its hub. */
function scene(name: string) {
  const root = join(dir, name);
  mkdirSync(root);
  const trace = join(dir, `${name}.trace.jsonl`);
  writeFileSync(trace, '');
  roots.push(root);
  const socket = join(root, 'hub.sock');
  const shaped = (extra: Record<string, string>) => env({ NODE_OPTIONS: `--require ${PRELOAD}`, ACC2570_TRACE: trace, ACC2570_SOCKET: socket, ...extra });
  return { root, trace, socket, logs: join(root, 'logs'), shaped };
}

interface Run { code: number | null; stdout: string; stderr: string; ms: number; asked: number; ended: number; timedOut: boolean }
/** One `deep` command, to its end or `timeoutMs` (then killed by its PID). */
function deep(args: string[], childEnv: NodeJS.ProcessEnv, timeoutMs = 90_000): { done: Promise<Run>; pid: number } {
  const asked = Date.now();
  const t0 = performance.now();
  const child = spawn(NODE, [CLI, ...args], { cwd: dir, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; try { process.kill(child.pid!, 'SIGKILL'); } catch { /* gone */ } }, timeoutMs);
  const done = new Promise<Run>((resolve) => child.on('close', (code) => {
    clearTimeout(timer);
    resolve({ code, stdout, stderr, ms: performance.now() - t0, asked, ended: Date.now(), timedOut });
  }));
  waiting.add(done);
  return { done, pid: child.pid! };
}

interface Note { event: string; pid: number; t: number; code?: number }
const notes = (trace: string): Note[] => readFileSync(trace, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Note]; } catch { return []; } });
const noted = (trace: string, pid: number, event: string) => notes(trace).find((n) => n.pid === pid && n.event === event);

function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\s*Z/.test(spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout); } catch { return true; }
}
/** Whether `pid` runs `deep hub run` on `root`: never signal a PID that was reused by another process. */
function hubOf(pid: number, root: string): boolean {
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').includes(root) && alive(pid); } catch {
    const ps = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout;
    return ps.includes(root) && alive(pid);
  }
}
const log = (root: string) => { try { return readFileSync(join(root, 'logs', 'hub.log'), 'utf8'); } catch { return ''; } };
/** Every hub pid the scene knows of for `root`: its ready lines in hub.log and the trace's. */
function knownPids(root: string): number[] {
  const pids = new Set<number>();
  for (const r of ready(root)) pids.add(r.pid);
  const trace = `${root}.trace.jsonl`;
  if (existsSync(trace)) for (const n of notes(trace)) pids.add(n.pid);
  return [...pids];
}
async function stopEvery(root: string): Promise<void> {
  for (const pid of knownPids(root)) {
    if (!hubOf(pid, root)) continue;
    try { process.kill(pid, 'SIGTERM'); } catch { continue; }
    for (const end = Date.now() + 30_000; alive(pid) && Date.now() < end;) await sleep(100);
    if (hubOf(pid, root)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
}

/** The hub's hello at `socket`, as the CLI reads it (service.ts `answers`), with a loaded machine's 10 s. */
function hello(socket: string, ms = 10_000): Promise<{ hello?: string; start?: string } | undefined> {
  return new Promise((resolve) => {
    const sock = net.connect(socket);
    let buffer = '';
    const done = (value: { hello?: string; start?: string } | undefined) => { clearTimeout(timer); sock.destroy(); resolve(value); };
    const timer = setTimeout(() => done(undefined), ms);
    sock.setEncoding('utf8');
    sock.on('error', () => done(undefined));
    sock.on('close', () => done(undefined));
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      const i = buffer.indexOf('\n');
      if (i < 0) return;
      try { const o = JSON.parse(buffer.slice(0, i)) as { hello?: string; start?: string }; done(o.hello === 'deep-hub' ? o : undefined); } catch { done(undefined); }
    });
  });
}
/** The hubs that reported ready on `root` (each `deep hub run` prints one line with its pid and start ID to hub.log). */
function ready(root: string): { pid: number; start: string }[] {
  return log(root).split('\n').flatMap((l) => { try { const o = JSON.parse(l) as { ready?: boolean; pid?: number; start?: string }; return o.ready && typeof o.pid === 'number' ? [{ pid: o.pid, start: String(o.start) }] : []; } catch { return []; } });
}
/** The hub answering at the root now, with its pid from its own ready line; undefined when none answers. */
async function answering(root: string): Promise<{ pid: number; start: string } | undefined> {
  const h = await hello(join(root, 'hub.sock'));
  if (!h) return undefined;
  for (const end = Date.now() + 60_000; Date.now() < end; await sleep(100)) {
    const found = ready(root).find((r) => r.start === h.start);
    if (found) return found;
  }
  throw Error(`INCONCLUSIVE: a hub answered with start ${h.start} but printed no ready line to hub.log within 60 s (load ${loadavg()[0]})`);
}
const tail = (s: string, n = 1500) => (s.length > n ? `…${s.slice(-n)}` : s);
const slow = () => loadavg()[0]! > availableParallelism();

test('#2570.0ed54a91 deep hub start asked for while a stopped hub\'s process is still exiting ends with a hub answering, exit 0', async () => {
  const s = scene('exiting');
  // The old hub: a real dev hub that, once told to stop, closes its socket and exits LINGER_MS later.
  const first = await deep(['hub', 'start', '--root', s.root], s.shaped({ ACC2570_LINGER_MS: String(LINGER_MS) })).done;
  expect(first.code, `the old hub didn't start: ${first.stderr}`).toBe(0);
  const before = await answering(s.root);
  expect(before, 'no old hub answered after its deep hub start exited 0').toBeDefined();
  const old = before!.pid;
  if (!noted(s.trace, old, 'hub-process')) throw Error(`BLOCKED: the old hub (pid ${old}) didn't load linger.cjs, so the scene can't hold it exiting`);

  // Told to stop the way any client does; its stop isn't awaited, as the #1334 scene's hub.stop() isn't.
  const stop = deep(['hub', 'stop', '--root', s.root], env());
  for (const end = Date.now() + 60_000; !noted(s.trace, old, 'socket-closed') && Date.now() < end;) await sleep(10);
  if (!noted(s.trace, old, 'socket-closed')) throw Error(`INCONCLUSIVE: the old hub didn't close its socket within 60 s of deep hub stop (load ${loadavg()[0]})`);

  // The scene holds only if the old process still runs when the start is asked for.
  if (!alive(old) || noted(s.trace, old, 'exit')) throw Error(`INCONCLUSIVE: the old hub (pid ${old}) had exited before deep hub start was asked for (load ${loadavg()[0]})`);
  const start = await deep(['hub', 'start', '--root', s.root], env()).done;
  const exited = noted(s.trace, old, 'exit');
  if (exited && exited.t <= start.asked) throw Error(`INCONCLUSIVE: the old hub's exit (${exited.t}) came before the start was asked for (${start.asked})`);
  if (start.timedOut) throw Error(`INCONCLUSIVE or FAIL: deep hub start hadn't returned after 90 s (load ${loadavg()[0]})`);

  expect(start.code, `deep hub start asked for ${start.asked - noted(s.trace, old, 'socket-closed')!.t} ms after the old hub (pid ${old}) closed its socket, while it was still exiting, returned after ${Math.round(start.ms)} ms: exit ${start.code}\nstderr: ${start.stderr}\nhub.log: ${tail(log(s.root))}`).toBe(0);
  const after = await answering(s.root);
  expect(after, `no hub answered after deep hub start exited 0\nhub.log: ${tail(log(s.root))}`).toBeDefined();
  expect(after!.pid, 'the hub answering is the old one').not.toBe(old);
  expect(alive(old), `the old hub (pid ${old}) still runs`).toBe(false);
  expect((await stop.done).code, 'deep hub stop of the old hub').toBe(0);
}, 240_000);

test('#2570.03ae960a with no hub and none exiting deep hub start starts one as today, also after a finished stop', async () => {
  const s = scene('fresh');
  expect(await hello(s.socket, 2_000), 'a hub answered on a new root').toBeUndefined();

  const start = await deep(['hub', 'start', '--root', s.root], env()).done;
  if (start.timedOut) throw Error(`INCONCLUSIVE: deep hub start hadn't returned after 90 s (load ${loadavg()[0]})`);
  expect(start.code, `deep hub start on a new root: exit ${start.code}\nstderr: ${start.stderr}\nhub.log: ${tail(log(s.root))}`).toBe(0);
  const up = (await answering(s.root))!;
  expect(up, `no hub answered after deep hub start\nhub.log: ${tail(log(s.root))}`).toBeDefined();
  expect(alive(up.pid)).toBe(true);
  console.log(JSON.stringify({ case: 'fresh start', ms: Math.round(start.ms), load: loadavg()[0] }));

  // A stop that has finished: the process is gone, and the lock file and socket path it used are what it left.
  const stopped = await deep(['hub', 'stop', '--root', s.root], env()).done;
  expect(stopped.code, `deep hub stop: ${stopped.stderr}`).toBe(0);
  for (const end = Date.now() + 30_000; alive(up.pid) && Date.now() < end;) await sleep(50);
  if (alive(up.pid)) throw Error(`INCONCLUSIVE: the stopped hub (pid ${up.pid}) still ran 30 s after deep hub stop returned (load ${loadavg()[0]})`);

  const again = await deep(['hub', 'start', '--root', s.root], env()).done;
  if (again.timedOut) throw Error(`INCONCLUSIVE: deep hub start hadn't returned after 90 s (load ${loadavg()[0]})`);
  expect(again.code, `deep hub start after a finished stop: exit ${again.code}\nstderr: ${again.stderr}\nhub.log: ${tail(log(s.root))}`).toBe(0);
  const back = await answering(s.root);
  expect(back, `no hub answered after the second deep hub start\nhub.log: ${tail(log(s.root))}`).toBeDefined();
  expect(back!.pid).not.toBe(up.pid);
  console.log(JSON.stringify({ case: 'start after a finished stop', ms: Math.round(again.ms), load: loadavg()[0] }));
}, 300_000);

test('#2570.03ae960a a hub that never answers still fails at 15 s with today\'s message and exit 3', async () => {
  const s = scene('never');
  // The hub `deep hub start` starts runs and holds the lock, but never listens: nothing ever answers.
  const start = await deep(['hub', 'start', '--root', s.root], s.shaped({ ACC2570_HANG: '1' })).done;
  if (start.timedOut) throw Error(`FAIL: deep hub start hadn't returned after 90 s with a hub that never answers`);
  expect(start.code, `stderr: ${start.stderr}`).toBe(3);
  expect(start.stderr).toBe(`deep hub start: no hub answered at unix:${s.socket} within 15 s; see ${join(s.logs, 'hub.log')}\n`);
  const hub = notes(s.trace).find((n) => n.event === 'hub-process');
  if (!hub) throw Error(`BLOCKED: the started hub didn't load linger.cjs (exit ${start.code}, stderr ${start.stderr})`);
  if (!noted(s.trace, hub.pid, 'listen-withheld')) throw Error(`BLOCKED: the hub (pid ${hub.pid}) never reached its listen, so it isn't the hung hub the case needs\nhub.log: ${tail(log(s.root))}`);

  // At 15 s: never sooner than the wait from the moment the start was asked for, and no later than the wait from
  // the hung hub's own start (which comes after start's spawn of it) plus 3 s for the command's exit.
  expect(start.ms, 'returned before its 15 s wait').toBeGreaterThanOrEqual(WAIT_MS);
  const late = start.ended - hub.t - WAIT_MS;
  if (late > 3_000) {
    if (slow()) throw Error(`INCONCLUSIVE: deep hub start returned ${late} ms past 15 s from the hung hub's start, at load ${loadavg()[0]} on ${availableParallelism()} cores`);
    throw Error(`FAIL: deep hub start returned ${late} ms past 15 s from the hung hub's start`);
  }
  console.log(JSON.stringify({ case: 'never answers', ms: Math.round(start.ms), pastWait: late, load: loadavg()[0] }));
}, 180_000);
