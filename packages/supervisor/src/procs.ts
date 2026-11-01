// The process table as the supervisor reads it: `ps` under LC_ALL=C (start times as `ps -o lstart=` prints
// them, as the hub does), a process's run token read back from its environment, and the native helper's scan.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, readFileSync } from 'node:fs';
import { readdir, readFile, readlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** bubblewrap, the Linux sandbox (bubblewrap.ts). */
export const BWRAP = '/usr/bin/bwrap';

/**
 * Linux: whether a process in a run's cgroup is the sandbox's own rather than the run's: bwrap, which leads the launch
 * and ends once the program has, or the helper serving the program's filter, which ends once nothing is left under it.
 * Neither is tracked or stopped as the run's; what either wraps is.
 */
async function machinery(pid: number): Promise<boolean> {
  const exe = await readlink(`/proc/${pid}/exe`).catch(() => '');
  if (exe === BWRAP) return true;
  if (exe !== HELPER) return false;
  const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).split('\0');
  // Only bwrap's own child is confine on its way to becoming the program; one a run starts is the run's.
  const ppid = Number((await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')).split(') ').pop()?.split(' ')[1]);
  return argv[1] === 'confine' && (await readlink(`/proc/${ppid}/exe`).catch(() => '')) === BWRAP;
}
let base: string | undefined;
/**
 * Linux: where each run's cgroup is made (bubblewrap.ts): under this process's own, where the service manager delegated
 * it (a user service, an app's scope), else under the user's own service, which it always delegates.
 */
export function cgroupBase(): string {
  if (base) return base;
  const line = readFileSync('/proc/self/cgroup', 'utf8').split('\n').find((l) => l.startsWith('0::'));
  if (!line) throw Error('the supervisor needs the unified cgroup hierarchy (cgroup v2) to mark its runs, and /proc/self/cgroup shows none');
  const uid = process.getuid?.() ?? 0;
  for (const dir of [join('/sys/fs/cgroup', line.slice(3).trim()), `/sys/fs/cgroup/user.slice/user-${uid}.slice/user@${uid}.service`]) {
    try { accessSync(dir, constants.W_OK); return (base = dir); } catch { /* not delegated to this user */ }
  }
  throw Error('the supervisor needs a cgroup it may write to mark its runs: neither its own nor the user\'s service cgroup is delegated to this user');
}

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

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let bootAt: number | undefined;
/** Linux: a process's start, from its ticks since boot in /proc, written as `ps -o lstart=` writes it under LC_ALL=C. */
function lstart(ticks: number): string {
  bootAt ??= Number(/^btime (\d+)/m.exec(readFileSync('/proc/stat', 'utf8'))?.[1] ?? 0);
  const d = new Date((bootAt + Math.floor(ticks / 100)) * 1000);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} ${d.getFullYear()}`;
}
/** Linux: the table read from /proc, with no process to spawn, so a process that lives a moment is still seen. */
async function procTable(pids?: readonly number[]): Promise<Map<number, Proc>> {
  const procs = new Map<number, Proc>();
  const ids = pids ?? (await readdir('/proc')).filter((n) => /^\d+$/.test(n)).map(Number);
  for (const pid of ids) {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
    // The name sits in parentheses and may hold spaces; the fields after it are plain.
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (after.length < 20) continue;
    procs.set(pid, { pid, ppid: Number(after[1]), pgid: Number(after[2]), start: lstart(Number(after[19])) });
  }
  return procs;
}

/** Every process on the machine, or only those given. */
export async function table(pids?: readonly number[]): Promise<Map<number, Proc>> {
  if (pids && !pids.length) return new Map();
  if (process.platform === 'linux') return procTable(pids);
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
      const token = (await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0').find((v) => v.startsWith('DEEP_RUN_TOKEN='));
      return token ? sha256(token.slice('DEEP_RUN_TOKEN='.length)) : null;
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
 * The processes each marker's sandbox holds, by marker: on macOS from the helper's scan of Seatbelt profiles, on
 * Linux from each run's cgroup (bubblewrap.ts), whose empty ones no marker names any more are removed on the way.
 */
export async function scan(markers: readonly string[]): Promise<Map<string, number[]>> {
  const found = new Map<string, number[]>();
  if (!markers.length) return found;
  if (process.platform === 'linux') {
    const base = cgroupBase();
    for (const name of await readdir(base).catch(() => [] as string[])) {
      if (!name.startsWith('dev.deepbuild.run.')) continue;
      const pids = (await readFile(join(base, name, 'cgroup.procs'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(Number);
      if (markers.includes(name)) found.set(name, (await Promise.all(pids.map(async (pid) => ((await machinery(pid)) ? [] : [pid])))).flat());
      else if (!pids.length) await rmdir(join(base, name)).catch(() => undefined);
    }
    return found;
  }
  for (const line of (await run(HELPER, ['scan', ...markers])).split('\n')) {
    const [marker, pid] = line.split(' ');
    if (marker && pid) (found.get(marker) ?? found.set(marker, []).get(marker)!).push(Number(pid));
  }
  return found;
}
