// The Seatbelt backend of the sandbox seam (macOS): a deny-default profile per launch, through sandbox-exec. Its
// rules come from the grant alone, so a caller can't weaken one; a planted backend adds one rule to the same
// profile (suite.ts).
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Grant, Launch, SandboxBackend } from './types.js';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
/** Programs the system ships, readable and runnable by every sandboxed process. */
const SYSTEM_PROGRAMS = ['/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/libexec', '/Library/Apple/usr'];
const QUIET = ['mach-lookup', 'mach-register', 'iokit-open', 'user-preference-read', 'user-preference-write', 'ipc-posix-shm*', 'device-camera', 'device-microphone', 'system-fsctl'];

/** The mach name a run's profile alone allows: how the supervisor finds the run's processes (helper scan). */
export const markerOf = (run: string): string => `dev.deepbuild.${run.replace(':', '.')}`;
/** The tag a run's denials carry in the system log: how the supervisor tells whose a denial is. */
const tagOf = (run: string): string => `dev.deepbuild.${run}`;

export const quote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
/** A path as the kernel sees it (Seatbelt matches real paths): the real path of what exists, or of its nearest existing parent. */
export function real(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(real(parent), basename(path));
}

/** "127.0.0.1:4100" → "localhost:4100": Seatbelt filters connections and binds by port on this machine only. */
function egress(host: string): string {
  const m = /^(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/.exec(host);
  if (!m || Number(m[2]) > 65535) {
    throw Error(`the Seatbelt egress filter can name only a port on this machine, not ${host}; an outside host is called by the hub (Access: hosts)`);
  }
  return `localhost:${m[2]}`;
}

/** The profile that confines one process, and its children, to `grant`, with `cwd` readable. */
export function profile(run: string, cwd: string, grant: Grant, extra: readonly string[] = []): string {
  const paths = (list: readonly string[] | undefined) => (list ?? []).map((p) => `(subpath ${quote(real(p))})`).join(' ');
  const read = [cwd, ...(grant.read ?? [])];
  const rules = [
    '(version 1)',
    `(deny default (with message ${quote(tagOf(run))}))`,
    // Denied unreported: frameworks probe these by the dozen, and macOS rate-limits sandbox reports, so they
    // would crowd out the file, network and exec denials that the supervisor records.
    `(deny ${QUIET.join(' ')} (with no-report))`,
    '(import "system.sb")',
    '(allow process-fork)',
    '(allow signal process-info* (target same-sandbox))',
    '(allow file-read-metadata)',
    `(allow file-read* process-exec file-map-executable ${SYSTEM_PROGRAMS.map((p) => `(subpath ${quote(p)})`).join(' ')})`,
    `(allow file-read* process-exec file-map-executable ${paths(read)})`,
    '(allow file-read* file-write-data (literal "/dev/tty") (literal "/dev/stdout") (literal "/dev/stderr") (regex #"^/dev/fd/"))',
    `(allow mach-lookup (global-name ${quote(markerOf(run))}))`,
  ];
  if (grant.write?.length) rules.push(`(allow file-read* file-write* process-exec file-map-executable ${paths(grant.write)})`);
  if (grant.hosts?.length) rules.push(`(allow network-outbound ${grant.hosts.map((h) => `(remote ip ${quote(egress(h))})`).join(' ')})`);
  if (grant.listen?.length) rules.push(`(allow network-bind network-inbound ${grant.listen.map((h) => `(local ip ${quote(egress(h))})`).join(' ')})`);
  if (grant.sockets?.length) rules.push(`(allow network-outbound ${grant.sockets.map((s) => `(remote unix-socket (path-literal ${quote(real(s))}))`).join(' ')})`);
  if (grant.run_as_you) {
    // Your files and programs, as you; still no device, no socket or host it doesn't name, and no system service
    // beyond the runtime's own, so nothing it asks launchd or LaunchServices to start runs outside its sandbox.
    // A pseudo-terminal's ioctls (#104): a hosted terminal's host process opens one, and its program sets its modes.
    rules.push('(allow file-read* file-write* process-exec file-map-executable)', '(allow ipc-posix* pseudo-tty sysctl-read)', '(allow file-ioctl (literal "/dev/ptmx") (regex #"^/dev/ttys[0-9]+$"))');
  }
  // Last, so no grant reaches them: the files agents read their hooks and MCP servers from, wherever they are.
  const agents = '(deny file-write* (regex #"/\\.claude(/|$)") (regex #"/\\.mcp\\.json$") (regex #"/\\.claude\\.json$") (regex #"/\\.codex(/|$)"))';
  return [...rules, ...extra, agents].join('\n');
}

/** A Seatbelt backend whose profiles carry `extra` rules after the grant's: Seatbelt itself, or a planted twin. */
export function seatbeltWith(name: string, extra: readonly string[] = []): SandboxBackend {
  return {
    name,
    platform: 'darwin',
    async confine(launch: Launch, grant: Grant, run = 'run:0'): Promise<Launch> {
      if (process.platform !== 'darwin') throw Error(`${name} runs only on macOS`);
      const cwd = real(launch.cwd);
      return { argv: [SANDBOX_EXEC, '-p', profile(run, cwd, grant, extra), ...launch.argv], cwd, env: launch.env };
    },
  };
}

export const seatbelt: SandboxBackend = seatbeltWith('seatbelt');
