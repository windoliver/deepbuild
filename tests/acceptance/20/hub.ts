// The evidence retention as DeepBuild runs it: `deep hub run` on a home, on a test clock (DEEP_HUB_TEST_CLOCK), which
// runs its retention pass at start (#16). The tests never call the store's retain() themselves for AC9: what keeps
// or removes a copy is the hub's own pass, reading the record. Every hub started here is stopped by its PID, and
// cleanup() stops any left, by PID; nothing is stopped by name or port.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { NODE, REPO } from './helpers.ts';

export const CLI = join(REPO, 'packages/cli/dist/main.js');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const owned = new Set<number>();

function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
/** The environment the hub gets: this one, with HOME the test's home and nothing of DeepBuild's own settings. */
function hubEnv(home: string, clock: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', DEEP_HUB_TEST_CLOCK: String(clock) };
}
export interface Hub { pid: number; child: ChildProcess; stderr(): string; exit: Promise<unknown> }
/** Starts the installed hub of `home` (its root is <home>/.deepbuild) at `clock`, and waits for its ready line. */
export async function startHub(home: string, clock: number, timeoutMs = 30_000): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: hubEnv(home, clock), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  owned.add(child.pid!);
  let err = '';
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise((resolve) => child.on('exit', resolve));
  const ready = new Promise<boolean>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) {
        try { resolve((JSON.parse(out.split('\n')[0]!) as { ready?: boolean }).ready === true); } catch { resolve(false); }
      }
    });
    void exit.then(() => resolve(false));
  });
  const ok = await Promise.race([ready, sleep(timeoutMs).then(() => false)]);
  const hub: Hub = { pid: child.pid!, child, stderr: () => err, exit };
  if (!ok) {
    await stopHub(hub);
    throw Error(`BLOCKED: the hub didn't start on ${home} (deep hub run): ${err.slice(0, 2000)}`);
  }
  return hub;
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 10_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
  owned.delete(hub.pid);
}
/** Stops every hub this file started and didn't stop, by PID. */
export async function stopHubs(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  owned.clear();
}
/** Waits until `check` returns true, up to `ms`; resolves with whether it did. */
export async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await sleep(50);
  }
  return check();
}
