// The process table as the supervisor reads it: `ps` under LC_ALL=C (start times as `ps -o lstart=` prints
// them, as the hub does), a process's run token read back from its environment, and the native helper's scan.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** The native helper (native/helper.c), built beside the package's JavaScript. */
export const HELPER = fileURLToPath(new URL('../dist/helper', import.meta.url));

export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      // ps exits 1 when none of the PIDs it was given runs; that is an answer, not a failure.
      if (error && !(file === '/bin/ps' && error.code === 1)) reject(error);
      else resolve(stdout);
    });
  });
}

export interface Proc { pid: number; ppid: number; pgid: number; start: string }
/** Every process on the machine, or only those given. */
export async function table(pids?: readonly number[]): Promise<Map<number, Proc>> {
  if (pids && !pids.length) return new Map();
  const which = pids ? ['-p', pids.join(',')] : ['-A'];
  const out = await run('/bin/ps', [...which, '-o', 'pid=,ppid=,pgid=,lstart=']);
  const procs = new Map<number, Proc>();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) procs.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), start: m[4]! });
  }
  return procs;
}

/** The SHA-256 of the run token in a process's environment: null when it has none, undefined when it can't be read. */
export async function tokenOf(pid: number): Promise<string | null | undefined> {
  try {
    const shown = await run('/bin/ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)]);
    if (!shown.trim()) return undefined;
    const m = / DEEP_RUN_TOKEN=(\S+)/.exec(shown);
    return m ? sha256(m[1]!) : null;
  } catch {
    return undefined;
  }
}

/** The processes each marker's sandbox holds, by marker. */
export async function scan(markers: readonly string[]): Promise<Map<string, number[]>> {
  const found = new Map<string, number[]>();
  if (!markers.length) return found;
  for (const line of (await run(HELPER, ['scan', ...markers])).split('\n')) {
    const [marker, pid] = line.split(' ');
    if (marker && pid) (found.get(marker) ?? found.set(marker, []).get(marker)!).push(Number(pid));
  }
  return found;
}
