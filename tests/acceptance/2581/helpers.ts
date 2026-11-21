// Test-side tools for issue #2581 (README). The home, the stand-ins for launchctl, systemctl and the launcher, their
// calls.log, the child-process runner and the suite's process and folder cleanup are #19's doctor helpers, imported
// unchanged. Added here: the launcher stand-in that refuses (as #2200's suite has it), an empty working folder for each
// command, a listing of everything under the temporary folder, and `deep hub run` watched so a server it wrongly
// starts can't hang a test.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alive, calls, childEnv, CLI, deep, makeHome, NODE, own, sleep, type Home, type Ran } from '../19/doctor/helpers.ts';

export { cleanup, shown } from '../19/doctor/helpers.ts';
export type { Ran };

/** How long one `deep` command may take on a loaded machine before it is stopped. */
export const RUN_MS = 300_000;
/** A test's own limit: the run, the listings and the stop of anything it started. */
export const TEST_MS = 480_000;

const LAUNCHER = fileURLToPath(new URL('./fixtures/refusing-launcher.sh', import.meta.url));

/** A fresh home (#19's: `<tmp>/h`, no `.deepbuild`) and `cwd`, an empty working folder `<tmp>/e` the command runs in. */
export interface Place extends Home { cwd: string }

/**
 * The issue's place: a fresh home with no `.deepbuild`, stand-ins for the service manager and a launcher stand-in that
 * refuses, and an empty working folder of its own.
 */
export function freshPlace(): Place {
  const h = makeHome();
  copyFileSync(LAUNCHER, join(h.bin, 'launcher'));
  chmodSync(join(h.bin, 'launcher'), 0o755);
  const cwd = join(h.tmp, 'e');
  mkdirSync(cwd);
  return { ...h, cwd };
}

/** A package folder named `-x` in the working folder, with a readable manifest, so a `-x` read as a folder finds one. */
export function manifestAtDashX(p: Place): void {
  mkdirSync(join(p.cwd, '-x'));
  writeFileSync(join(p.cwd, '-x', 'deepbuild.json'), `${JSON.stringify({ id: 'dash-x', version: '0.0.1' })}\n`);
}

/** Every file, folder and link under `dir` by its path from `dir`: a file by its bytes' digest, a folder as `dir`. */
function listing(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string, from: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const rel = from ? `${from}/${name}` : name;
      const st = lstatSync(path);
      if (st.isDirectory()) { out.set(rel, 'dir'); walk(path, rel); }
      else if (st.isFile()) out.set(rel, createHash('sha256').update(readFileSync(path)).digest('hex'));
      else out.set(rel, 'other');
    }
  };
  walk(dir, '');
  return out;
}

export interface Outcome {
  ran: Ran;
  /** The exit code; null when a signal or the timeout ended it. */
  exit: number | null;
  /** Paths from the temporary folder (`e/` the working folder, `h/` the home, `bin/` the stand-ins), new or changed. */
  written: string[];
  /** The stand-ins' calls.log, one line per call, the temporary folder written `<tmp>`. */
  called: string[];
}

/**
 * A dev hub a wrong `deep hub start --root --typo` left behind in the working folder: asked to stop through its own
 * socket with `deep hub stop --root <that folder>`, the folder by its absolute path. Nothing is stopped by name or port.
 */
async function stopLeftHub(p: Place): Promise<void> {
  const root = join(p.cwd, '--typo');
  if (!existsSync(join(root, 'logs')) && !existsSync(join(root, 'hub.sock'))) return;
  // A detached hub may still be coming up after start gave up on it: wait for its socket a while, then ask it to stop.
  for (let i = 0; i < 120 && !existsSync(join(root, 'hub.sock')); i++) await sleep(500);
  if (existsSync(join(root, 'hub.sock'))) await deep(p, ['hub', 'stop', '--root', root], { cwd: p.cwd, timeoutMs: 60_000 });
}

/** `deep <args>` from the built CLI as a child process in `p.cwd`, with what it left behind under the temporary folder. */
export async function outcome(p: Place, args: readonly string[]): Promise<Outcome> {
  const before = listing(p.tmp);
  const ran = await deep(p, args, { cwd: p.cwd, timeoutMs: RUN_MS });
  const written = [...listing(p.tmp)].filter(([path, what]) => before.get(path) !== what).map(([path]) => path);
  const called = calls(p.bin).map((call) => call.replaceAll(p.tmp, '<tmp>'));
  if (args[0] === 'hub') await stopLeftHub(p);
  return { ran, exit: ran.timedOut || ran.signal ? null : ran.code, written, called };
}

export interface Served {
  ran: Ran;
  /** The exit code; null when this test stopped it. */
  exit: number | null;
  /** Whether it started a server: its socket appeared in the working folder, or it was still running at the limit. */
  server: boolean;
}

/**
 * `deep hub run <args>` in `p.cwd`, watched: it either exits by itself, or it started a server, which shows as a
 * `hub.sock` under the working folder or as a process still running after RUN_MS. A server is stopped by the PID this
 * test spawned (SIGTERM, then SIGKILL after 10 s), and #19's cleanup stops it again if it is still alive.
 */
export async function served(p: Place, args: readonly string[]): Promise<Served> {
  const t0 = performance.now();
  const child = spawn(NODE, [CLI, 'hub', 'run', ...args], { cwd: p.cwd, env: childEnv(p), stdio: ['ignore', 'pipe', 'pipe'] });
  own(child.pid);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  let done: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  void closed.then((d) => (done = d));
  const socketUnder = (dir: string): boolean => {
    try {
      return [...listing(dir).keys()].some((path) => path === 'hub.sock' || path.endsWith('/hub.sock'));
    } catch {
      return false; // a file the hub removed mid-walk: read again on the next turn
    }
  };
  let server = false;
  let timedOut = false;
  while (!done) {
    if (socketUnder(p.cwd)) { server = true; break; }
    if (performance.now() - t0 > RUN_MS) { server = timedOut = true; break; }
    await sleep(250);
  }
  if (server && child.pid) {
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* gone */ }
    const deadline = Date.now() + 10_000;
    while (!done && alive(child.pid) && Date.now() < deadline) await sleep(100);
    if (!done && alive(child.pid)) try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
  }
  const { code, signal } = await closed;
  const ran: Ran = { code, signal, stdout, stderr, ms: performance.now() - t0, timedOut };
  return { ran, exit: server || signal ? null : code, server };
}
