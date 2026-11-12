// The process table as the supervisor reads it: `ps` under LC_ALL=C (start times as `ps -o lstart=` prints
// them, as the hub does), a process's run token read back from its environment, and the native helper's scan.
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

/** The PIDs that listen on the TCP port, as lsof shows them; a failed lsof rejects, since it proves nothing. */
export const listening = (port: number): Promise<{ pids: number[]; empty: boolean }> => new Promise((done, fail) => {
  // Where the system keeps it: Debian and Ubuntu have no /usr/sbin/lsof.
  execFile(process.platform === 'darwin' ? '/usr/sbin/lsof' : '/usr/bin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
    // lsof exits 1 with no output when nothing listens.
    if (error && !((error as { code?: unknown }).code === 1 && stdout.trim() === '' && stderr.trim() === '')) return fail(Error(`lsof can't list port ${port}'s listeners: ${stderr.trim() || error.message}`));
    done({ pids: [...new Set(String(stdout ?? '').split('\n').filter((l) => l.startsWith('p')).map((l) => Number(l.slice(1))))], empty: stdout.trim() === '' });
  });
});

export interface Proc { pid: number; ppid: number; pgid: number; start: string }

/** Whether a process (or, given a negative ID, a process group) still exists: a signal of 0 asks without sending one. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Only ESRCH proves absence. Permission and transient observation errors keep the process live.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
/** An unreadable process table is unknown, never evidence of an empty group or an idle run. */
const quietPs = (args: string[]): Promise<string | null> => run('/bin/ps', args).then((text) => text.trim() ? text : null, () => null);
/** The live members of a process group, zombies left out; none for a group that is gone. */
export async function groupMembers(pgid: number | undefined): Promise<number[] | null> {
  if (!pgid || !alive(-pgid)) return [];
  const text = await quietPs(['-A', '-o', 'pid=,pgid=,stat=']);
  if (text === null) return null;
  return text.split('\n').map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length === 3 && Number(f[1]) === pgid && !f[2]!.startsWith('Z')).map((f) => Number(f[0]));
}
/** The CPU time a process group has used so far, as `ps` reports it; it changes only while the group works. */
export async function groupCpu(pgid: number): Promise<string | null> {
  const text = await quietPs(['-A', '-o', 'pgid=,cputime=']);
  if (text === null) return null;
  return text.split('\n').map((l) => l.trim().split(/\s+/)).filter((f) => Number(f[0]) === pgid).map((f) => f[1]).join(',');
}
/**
 * A process's start time read before the event loop turns: a child that has already exited is still in the table,
 * since nothing has reaped it yet, where an asynchronous read would find it gone (a run of `true` through bubblewrap).
 */
export function startNow(pid: number): string {
  try {
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
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
    if (process.platform === 'linux') {
      // The environment as the kernel keeps it, NUL between variables; `ps` on Linux shows none of it.
      const m = /(?:^|\0)DEEP_RUN_TOKEN=([^\0]+)/.exec(await readFile(`/proc/${pid}/environ`, 'latin1'));
      return m ? sha256(m[1]!) : null;
    }
    const shown = await run('/bin/ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)]);
    if (!shown.trim()) return undefined;
    const m = / DEEP_RUN_TOKEN=(\S+)/.exec(shown);
    return m ? sha256(m[1]!) : null;
  } catch {
    return undefined;
  }
}

/**
 * The processes each marker's sandbox holds, by marker; `bytes` gets each one's memory (#1409): its physical footprint
 * on macOS, its resident set on Linux.
 */
export async function scan(markers: readonly string[], bytes?: Map<number, number>): Promise<Map<string, number[]>> {
  const found = new Map<string, number[]>();
  if (!markers.length) return found;
  for (const line of (await run(HELPER, ['scan', ...markers])).split('\n')) {
    const [marker, pid, , , memory] = line.split(' ');
    if (!marker || !pid) continue;
    (found.get(marker) ?? found.set(marker, []).get(marker)!).push(Number(pid));
    bytes?.set(Number(pid), Number(memory ?? 0));
  }
  return found;
}

/**
 * The processes with a file open under `dir` (#1017), its working folder or a file it maps counted too, read off
 * `lsof` for every process this user can see. A read that fails names no process, so the caller can't take it for none.
 */
export function openUnder(dir: string): Promise<{ pid: number; command: string }[]> {
  return new Promise((resolve, reject) => {
    execFile(process.platform === 'darwin' ? '/usr/sbin/lsof' : '/usr/bin/lsof', ['-n', '-P', '-w', '-F', 'pcn'], { env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 256 * 1024 * 1024, timeout: 30_000 }, (error, stdout) => {
      // lsof exits 1 when a process it could not read went by; what it read is still the answer, unless it read nothing.
      if (error && !stdout) return reject(error);
      const found = new Map<number, string>();
      let pid = 0;
      let command = '';
      for (const line of stdout.split('\n')) {
        if (line.startsWith('p')) { pid = Number(line.slice(1)); command = ''; }
        else if (line.startsWith('c')) command = line.slice(1);
        else if (line.startsWith('n') && (line.slice(1) === dir || line.slice(1).startsWith(`${dir}/`)) && pid !== process.pid) found.set(pid, command);
      }
      resolve([...found].map(([p, c]) => ({ pid: p, command: c })));
    });
  });
}
