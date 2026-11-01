// The bubblewrap backend of the sandbox seam (Linux, #70): a launch through bwrap, whose namespaces give the run its
// own user, mount, IPC and UTS space, a device-free /dev and a marker directory the process scan finds, then through the
// native helper's `confine`, which puts Landlock's file rules and a seccomp filter from the grant alone on the
// program and stays as its parent to answer the filter: sockets by path and port, renames and metadata changes,
// and the write refusals the supervisor records. A planted backend is the same launch with one grant wider, or
// one device bound in (suite.ts).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { HELPER } from './procs.js';
import { markerOf, real } from './seatbelt.js';
import type { Grant, Launch, SandboxBackend } from './types.js';

const BWRAP = '/usr/bin/bwrap';
/** The Landlock ABI the helper's file rules need: TRUNCATE and REFER handled, so a truncate or a move obeys the grant too. */
const LANDLOCK_ABI = 4;
/** Top-level folders the sandbox gets its own of, not the machine's. */
const OWN = new Set(['dev', 'proc', 'run', 'sys']);

/** A path the supervisor keeps from every run's writes, with the folders under it left to the run's grant. */
export interface Guard { path: string; except: string[] }
/** What a planted backend adds to the real one (suite.ts): bwrap arguments, and helper flags that widen the grant. */
export interface Widening { bwrap?: string[]; helper?: string[] }

/** "127.0.0.1:4100" → 4100: the filter lets a process connect to, or listen on, a port on this machine only. */
function port(host: string): string {
  const m = /^(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/.exec(host);
  if (!m || Number(m[2]) > 65535) throw Error(`the Linux sandbox's filter can name only a port on this machine, not ${host}; an outside host is called by the hub (Access: hosts)`);
  return m[2]!;
}

let abi: number | undefined;
/** The kernel's Landlock ABI, read once; a kernel without the ABI the rules need runs nothing. */
function landlockAbi(): number {
  if (abi === undefined) {
    if (!existsSync(BWRAP)) throw Error(`the Linux sandbox needs bubblewrap at ${BWRAP}; nothing runs outside one (#70)`);
    if (!existsSync(HELPER)) throw Error(`the Linux sandbox needs the supervisor's helper at ${HELPER}, built by its build script; nothing runs outside one`);
    abi = Number(execFileSync(HELPER, ['landlock'], { encoding: 'utf8' }).trim()) || 0;
  }
  return abi;
}

/** The machine's root as the sandbox sees it: every top-level folder bound as it is (Landlock decides what is read or written), the system's symlinks kept. */
function rootBinds(): string[] {
  const args: string[] = [];
  for (const name of readdirSync('/').sort()) {
    if (OWN.has(name)) continue;
    const path = `/${name}`;
    let link: string | undefined;
    try { link = readlinkSync(path); } catch { /* not a symlink */ }
    if (link !== undefined) { args.push('--symlink', link, path); continue; }
    try { if (!statSync(path).isDirectory()) continue; } catch { continue; }
    args.push('--bind-try', path, path);
  }
  return args;
}

/**
 * The bwrap arguments that confine one process, and its children, to `grant`, with `cwd` readable, and the helper's
 * flags, which travel in the DEEP_CONFINE variable with the program's own arguments: neither bwrap's nor the helper's
 * command line then repeats the program's, which anything counting a program's processes by its command line would count.
 */
export function bwrapArgs(run: string, cwd: string, grant: Grant, guards: readonly Guard[], plant: Widening = {}): { bwrap: string[]; helper: string[] } {
  const flags: string[] = ['--log-fd', '3'];
  for (const p of [cwd, ...(grant.read ?? [])]) flags.push('--read', real(p));
  for (const p of grant.write ?? []) flags.push('--write', real(p));
  for (const s of grant.sockets ?? []) flags.push('--socket', real(s));
  for (const h of grant.hosts ?? []) flags.push('--connect', port(h));
  for (const h of grant.listen ?? []) flags.push('--listen', port(h));
  if (grant.run_as_you) flags.push('--as-you');
  const mounts: string[] = [];
  for (const g of guards) {
    // Kept whole and read-only by the mount, whatever the grant: a guarded path is never written, and its parent
    // folders can't be moved aside, since the helper refuses to move anything that carries a guard.
    if (!existsSync(g.path)) continue;
    mounts.push('--ro-bind', real(g.path), real(g.path));
    flags.push('--guard', real(g.path));
    for (const e of g.except) {
      if (!existsSync(e)) continue;
      mounts.push('--bind', real(e), real(e));
      flags.push('--except', real(e));
    }
  }
  // No PID namespace: a program's processes keep the IDs the machine knows them by, as on macOS, and the marker and
  // the helper, a subreaper, still account for every one of them.
  return {
    bwrap: [
      '--unshare-user', '--disable-userns', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup-try',
      ...rootBinds(),
      '--dev', '/dev', '--proc', '/proc', '--ro-bind-try', '/sys', '/sys', '--tmpfs', '/run', '--dir', `/run/deep/${markerOf(run)}`,
      ...mounts, ...(plant.bwrap ?? []),
      '--chdir', cwd, '--', HELPER, 'confine',
    ],
    helper: [...flags, ...(plant.helper ?? [])],
  };
}
/** The unit separator between the helper's arguments in DEEP_CONFINE; no path or argument of a program holds one. */
const UNIT = '\x1f';

/** A bubblewrap backend with the supervisor's guards, plus what a planted twin adds: bubblewrap itself, or a plant. */
export function bubblewrapWith(name: string, guards: readonly Guard[] = [], plant: Widening = {}): SandboxBackend {
  return {
    name,
    platform: 'linux',
    async confine(launch: Launch, grant: Grant, run = 'run:0'): Promise<Launch> {
      if (process.platform !== 'linux') throw Error(`${name} runs only on Linux`);
      const have = landlockAbi();
      if (have < LANDLOCK_ABI) throw Error(`this kernel's Landlock ABI is ${have}; the Linux sandbox needs ${LANDLOCK_ABI} or later (Linux 6.7), so nothing runs (#70)`);
      const cwd = real(launch.cwd);
      const args = bwrapArgs(run, cwd, grant, guards, plant);
      if ([...args.helper, ...launch.argv].some((a) => a.includes(UNIT))) throw Error('an argument holds the unit separator, which the Linux sandbox\'s grant can\'t carry');
      return { argv: [BWRAP, ...args.bwrap], cwd, env: { ...launch.env, DEEP_CONFINE: [...args.helper, '--', ...launch.argv].join(UNIT) } };
    },
  };
}

export const bubblewrap: SandboxBackend = bubblewrapWith('bubblewrap');

/** The planted backends on Linux, each one grant wider than bubblewrap, or with one device bound in (suite.ts). */
export function bubblewrapPlants(hubSocket: string): Record<'egress' | 'write-outside' | 'hub-socket' | 'camera', SandboxBackend> {
  return {
    egress: bubblewrapWith('planted-egress', [], { helper: ['--connect', 'any'] }),
    'write-outside': bubblewrapWith('planted-write-outside', [], { helper: ['--plant-writes'] }),
    'hub-socket': bubblewrapWith('planted-hub-socket', [], { helper: ['--socket', real(hubSocket)] }),
    camera: bubblewrapWith('planted-camera', [], { bwrap: ['--dev-bind', '/dev/null', '/dev/video0'] }),
  };
}
