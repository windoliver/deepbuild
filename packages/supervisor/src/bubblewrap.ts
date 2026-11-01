// The bubblewrap backend of the sandbox seam (Linux, #70): namespaces and a private /dev through bwrap, then,
// inside, the helper's `confine` puts the process under a Landlock ruleset and a seccomp filter made from the grant
// alone, so a caller can't weaken one; a planted backend adds one rule to the same confinement (suite.ts). The
// helper's `box` runs first: it starts the filter's server outside the sandbox, joins a cgroup of the run's own,
// which is its marker (every process it holds is listed there), and runs bwrap. Each refusal the server makes or
// foresees reaches the supervisor on the launch's status stream, as bwrap's report of the program's process does.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { BWRAP, cgroupBase, HELPER } from './procs.js';
import { markerOf, real } from './seatbelt.js';
import type { Grant, Launch, SandboxBackend } from './types.js';

/** The descriptor bwrap reports the program's process on, `{"child-pid": n}`: the supervisor gives it as the launch's fourth stream. */
export const STATUS_FD = 3;
/** What the system ships, readable and runnable by every sandboxed process; `/dev` is bwrap's own, small one. */
const SYSTEM = ['/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/etc', '/opt', '/proc', '/run/systemd/resolve'];
/** The files agents read their hooks and MCP servers from: those in a home or a run's folder are read-only mounts, and the filter's server refuses every name like them (linux.c, agent_file), whatever the grant. */
const AGENT_FILES = ['.claude', '.claude.json', '.mcp.json', '.codex'];

/** A guarded path the supervisor names: nothing writes under it, but for the folders `except` names. */
export type Guarded = string | { path: string; except: string[] };
/** What a planted backend adds: bwrap options before the program, and confine options before the grant's. */
export interface Extra { bwrap?: string[]; confine?: string[] }

/** "127.0.0.1:4100" → 4100: the filter names ports on this machine, as Seatbelt's does. */
function port(host: string, what: string): string {
  const m = /^(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/.exec(host);
  if (!m || Number(m[2]) > 65535) throw Error(`the bubblewrap ${what} filter can name only a port on this machine, not ${host}; an outside host is called by the hub (Access: hosts)`);
  return m[2]!;
}
/** The folders above `path`, nearest last, the root left out. */
const above = (path: string): string[] => (dirname(path) === path ? [] : [...above(dirname(path)), path]).filter((p) => p !== '/');

/** A run's cgroup: made by the helper's `box`, listed by `scan` (procs.ts). */
const cgroupOf = (marker: string): string => join(cgroupBase(), marker);

/** The bwrap and confine options that confine one process, and its children, to `grant`, with `cwd` readable. */
function options(cwd: string, grant: Grant, guarded: readonly Guarded[], extra: Extra): { bwrap: string[]; confine: string[] } {
  const home = real(homedir());
  // The system's tree, with a /dev of bwrap's own (no devices) and the cgroups read-only, so no process moves itself
  // out of the run's. No pid namespace: the run's processes are its own, stopped one by one as proven, as on macOS.
  // Where the launch gives STATUS_FD, bwrap names the program's process on it once it runs (the helper's `box`).
  const bwrap = ['--bind', '/', '/', '--dev', '/dev', '--ro-bind', '/sys', '/sys', '--unshare-user', '--disable-userns', '--unshare-ipc', '--unshare-uts'];
  // A guarded path is read-only however the grant reads, its exceptions writable again; the folders above it are
  // mount points, so a run that may write everything else can't move one aside and put its own in its place.
  for (const g of guarded) {
    const path = real(typeof g === 'string' ? g : g.path);
    if (!existsSync(path)) continue;
    for (const a of above(dirname(path))) bwrap.push('--bind', a, a);
    bwrap.push('--ro-bind', path, path);
    if (typeof g !== 'string') for (const e of g.except) bwrap.push('--bind-try', real(e), real(e));
  }
  for (const dir of new Set([home, cwd])) for (const name of AGENT_FILES) bwrap.push('--ro-bind-try', join(dir, name), join(dir, name));
  bwrap.push(...(extra.bwrap ?? []));
  const confine: string[] = [];
  const paths = (flag: string, list: readonly string[]) => { for (const p of list) confine.push(flag, real(p)); };
  paths('--read', [...SYSTEM, cwd, ...(grant.read ?? [])]);
  paths('--write', ['/dev', ...(grant.write ?? [])]);
  if (grant.run_as_you) paths('--write', ['/']);
  for (const h of grant.hosts ?? []) confine.push('--connect', port(h, 'egress'));
  for (const h of grant.listen ?? []) confine.push('--listen', port(h, 'listen'));
  paths('--unix', grant.sockets ?? []);
  confine.push(...(extra.confine ?? []));
  return { bwrap, confine };
}

/** A bubblewrap backend whose confinement carries `extra` after the grant's: bubblewrap itself, or a planted twin. */
export function bubblewrapWith(name: string, guarded: readonly Guarded[] = [], extra: Extra = {}): SandboxBackend {
  return {
    name,
    platform: 'linux',
    async confine(launch: Launch, grant: Grant, run = 'run:0'): Promise<Launch> {
      if (process.platform !== 'linux') throw Error(`${name} runs only on Linux`);
      if (!existsSync(BWRAP)) throw Error(`${name} needs bubblewrap at ${BWRAP}`);
      const cwd = real(launch.cwd);
      const o = options(cwd, grant, guarded, extra);
      return { argv: [HELPER, 'box', cgroupOf(markerOf(run)), ...o.confine, '--', BWRAP, ...o.bwrap, '--', ...launch.argv], cwd, env: launch.env };
    },
  };
}

export const bubblewrap: SandboxBackend = bubblewrapWith('bubblewrap');
