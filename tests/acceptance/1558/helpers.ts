// Shared test-side tools for #1558's acceptance tests (README): the criterion tags, the issue's command and expected
// values, and one `deep lease -- <the command>` run of the built CLI, watched from outside: when the command's leader
// printed its leftover sleep's PID (it exits 3 right after), when `deep lease` itself exited and with what code, and
// whether the sleep was still running then. Nothing here stands in for `deep lease` or the hub.
//
// Safety: every leftover sleep is SIGKILLed by the PID its command printed, and every `deep lease` this file started
// by its own PID, after the file; never by name or port.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { afterAll } from 'vitest';
import { alive, CLI, NODE, sleep } from '../18/mapping/helpers.ts';

export { alive, sleep };

// Criterion IDs: `#1558.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #1558.cd6049ae';
export const AC2 = 'AC2 #1558.0c58bda4';
export const AC3 = 'AC3 #1558.da394100';

/** The issue's command: its leader starts a sleep in its own process group, prints the sleep's PID and exits 3. */
export const SCRIPT = 'sleep 300 & echo $!; exit 3';
export const COMMAND = ['/bin/sh', '-c', SCRIPT];
/** The issue's expected values. */
export const EXIT_CODE = 3;
export const RETURN_MS = 5000;
export const RELEASE_MS = 5000;
/** How long a run is watched for `deep lease` to return after its command exited, before it is judged still waiting. */
export const WATCH_MS = 15_000;

const made: string[] = [];
/** An empty folder under /tmp/dh1558-*, removed after the file. */
export function emptyDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1558-'));
  made.push(dir);
  return dir;
}

const sleeps = new Set<number>();
const leases = new Set<number>();
/** Every leftover sleep SIGKILLed by its PID, then every `deep lease` still running stopped by its PID; folders removed. */
export async function cleanup(): Promise<void> {
  for (const pid of sleeps) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...leases].some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of leases) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  sleeps.clear();
  leases.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
afterAll(cleanup, 30_000);

/** SIGKILL to a leftover sleep, by the PID its command printed. */
export function killSleep(pid: number): void {
  try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}

export interface Leased {
  /** `deep lease`'s own PID. */
  pid: number;
  /** The leftover sleep's PID as the command printed it, and when the line came (the leader exits right after). */
  echoed: Promise<{ sleep: number; at: number } | undefined>;
  /** When `deep lease` exited and how. */
  exited: Promise<{ code: number | null; signal: string | null; at: number }>;
  out(): string;
  err(): string;
}

/** `deep lease -- /bin/sh -c 'sleep 300 & echo $!; exit 3'` with the built CLI, in `cwd`, with `env`. */
export function leaseRun(env: NodeJS.ProcessEnv, cwd: string): Leased {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
  // stdout and stderr are pipes: the leftover sleep inherits them, so `deep lease`'s end is its process's exit, not
  // the pipes' close.
  const child = spawn(NODE, [CLI, 'lease', '--', ...COMMAND], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  leases.add(child.pid!);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exited = new Promise<{ code: number | null; signal: string | null; at: number }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal, at: Date.now() }));
    child.on('error', () => resolve({ code: null, signal: null, at: Date.now() }));
  });
  const echoed = new Promise<{ sleep: number; at: number } | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      const m = /^(\d+)\n/.exec(out);
      if (m) {
        sleeps.add(Number(m[1]));
        resolve({ sleep: Number(m[1]), at: Date.now() });
      }
    });
    void exited.then(async () => { await sleep(200); resolve(undefined); });
  });
  return { pid: child.pid!, echoed, exited, out: () => out, err: () => err };
}

/** `p`'s value, or undefined once `deadline` (ms since the epoch) passes first. */
export async function by<T>(p: Promise<T>, deadline: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), Math.max(0, deadline - Date.now())); });
  try { return await Promise.race([p, late]); } finally { clearTimeout(timer); }
}

/** What one run showed: the sleep's PID, `deep lease`'s code, how long after its command exited it returned, and whether the sleep still ran then. */
export interface Returned { sleep: number; code: number | null; signal: string | null; ms: number; sleepRan: boolean }

/**
 * Waits for the command to print its sleep's PID (up to `startMs`), then for `deep lease` to return, up to WATCH_MS
 * after that line. Undefined fields say what didn't happen; `why` names it in the issue's words.
 */
export async function watch(run: Leased, startMs = 180_000): Promise<{ returned?: Returned; why?: string }> {
  const echoed = await by(run.echoed, Date.now() + startMs);
  if (!echoed) {
    const ended = await by(run.exited, Date.now() + 100);
    return { why: `the command never printed its sleep's PID, so it never ran under \`deep lease\`${ended ? ` (deep lease exited ${ended.code ?? ended.signal})` : ''}: stdout ${JSON.stringify(run.out().slice(0, 600))}, stderr ${JSON.stringify(run.err().slice(0, 1500))}` };
  }
  const ended = await by(run.exited, echoed.at + WATCH_MS);
  if (!ended) {
    return { why: `\`deep lease\` (PID ${run.pid}) was still running ${WATCH_MS} ms after its command's leader printed the leftover sleep's PID ${echoed.sleep} and exited ${EXIT_CODE}, with that sleep ${alive(echoed.sleep) ? 'still running' : 'gone'}: it waits for the leftover child, not for the command it ran; stderr ${JSON.stringify(run.err().slice(0, 600))}` };
  }
  return { returned: { sleep: echoed.sleep, code: ended.code, signal: ended.signal, ms: ended.at - echoed.at, sleepRan: alive(echoed.sleep) } };
}
