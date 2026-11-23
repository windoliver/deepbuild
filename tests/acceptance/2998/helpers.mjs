// #2998 acceptance helpers: the process table as `ps` shows it, and the canary probes a supervisor starts.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = fileURLToPath(new URL('../../../packages/cli/dist/main.js', import.meta.url));
export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

/** The processes `ps` lists among `pids`: pid, parent, state and command line (a zombie's included). */
export function table(pids) {
  if (!pids.length) return [];
  const out = spawnSync('/bin/ps', ['-o', 'pid=,ppid=,stat=,command=', '-p', pids.join(',')], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).stdout ?? '';
  return out.split('\n').filter((line) => line.trim()).map((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\s\S]*)$/.exec(line);
    return m ? { pid: Number(m[1]), ppid: Number(m[2]), stat: m[3], command: m[4] } : null;
  }).filter(Boolean);
}

/** The children of `parent`, by pgrep: a probe lives about 50 ms, and listing every process with `ps -A` takes longer. */
export function childrenOf(parent) {
  return (spawnSync('/usr/bin/pgrep', ['-P', String(parent)], { encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean).map(Number);
}

/**
 * The canary probes whose parent is `parent`: `/usr/bin/sandbox-exec -p <profile> <helper> probe /dev/null write
 * /tmp/deep-canary-…` until it execs the helper, which keeps the same arguments after it. `ps` mostly can't read a
 * sandboxed process's arguments and shows it as `(sandbox-exec)`; when it can, both forms name a `/tmp/deep-canary-`
 * target. A probe that exited unreaped shows as a zombie whose command `ps` no longer gives, so `known` pids (probes
 * seen before) are looked up and matched by pid as well.
 */
export function probesOf(parent, known = new Set()) {
  const rows = table([...new Set([...childrenOf(parent), ...known])]);
  return rows.filter((p) => p.ppid === parent && (known.has(p.pid) || isProbe(p.command)));
}
const isProbe = (command) => command === '(sandbox-exec)' || command.startsWith(`${SANDBOX_EXEC} `)
  || (command.includes('/tmp/deep-canary-') && / probe \/dev\/null write /.test(command));

/** A running probe: not a zombie. */
export const running = (p) => !p.stat.startsWith('Z');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const turn = () => new Promise((resolve) => setImmediate(resolve));
