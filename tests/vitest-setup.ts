// Runs before every vitest file (vitest.config.ts), so a test file leaves nothing running or gigabytes on disk.
//
// A process a file started ends with the file. A child still running at the file's end, such as #29's planted heavy
// command that waits for a `go` file its test never writes, ran on under launchd for days. So every process descending
// from this worker is held at the file's end and killed when the worker ends: by PID, never by name, port or process
// group, since the group is the shell's that started vitest.
//
// A fake HOME gets no Rust toolchain of its own. rustup installs the pinned toolchain into $HOME/.rustup, 1 to 3 GB
// a run in #139's suites, so RUSTUP_HOME and CARGO_HOME are the user's own, as scripts/preflight.mjs gives its lanes,
// unless the run set them.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { afterAll } from 'vitest';

process.env.RUSTUP_HOME ??= join(homedir(), '.rustup');
process.env.CARGO_HOME ??= join(homedir(), '.cargo');

interface Proc { pid: number; ppid: number; command: string }
/**
 * Every process as `ps` shows it now, `ps` itself and zombies left out: a zombie has no children, and once reaped its
 * PID may be another process's.
 */
function table(): Proc[] {
  const ps = spawnSync('ps', ['-axww', '-o', 'pid=,ppid=,stat=,command='], { encoding: 'utf8' });
  return (ps.stdout ?? '').split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    return m && Number(m[1]) !== ps.pid && !m[3]!.startsWith('Z') ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[4]! }] : [];
  });
}
const signal = (procs: Proc[], sig: NodeJS.Signals): void => {
  for (const p of procs) try { process.kill(p.pid, sig); } catch { /* gone */ }
};
/**
 * Every process descending from this one, each sent `sig` as it is found: SIGSTOP, so none starts another or ends and
 * leaves its children to launchd while the rest are taken, or SIGKILL.
 */
function tree(sig: NodeJS.Signals): Proc[] {
  const found = new Map<number, Proc>();
  for (;;) {
    const procs = table();
    const fresh: Proc[] = [];
    const walk = (pid: number): void => { for (const p of procs) if (p.ppid === pid) { if (!found.has(p.pid)) fresh.push(p); walk(p.pid); } };
    walk(process.pid);
    if (!fresh.length) return [...found.values()];
    signal(fresh, sig);
    for (const p of fresh) found.set(p.pid, p);
  }
}

// In a threads pool this process is vitest's own, and its descendants are every file's: nothing is stopped there.
if (isMainThread) {
  // At the file's end they are only held: one that ended while the file's code still ran would wake what waits on it,
  // such as #29's twins' pending command, on a lease table the file had closed, an unhandled error that fails the file.
  let held: Proc[] = [];
  afterAll(() => {
    held = tree('SIGSTOP');
    if (held.length) console.warn(`vitest-setup: stopping ${held.length} process(es) this file left running:\n${held.map((p) => `  ${p.pid} ${p.command.slice(0, 200)}`).join('\n')}`);
  });
  // They end with the worker, once no code of the file can run: when it exits, and when vitest stops it with SIGTERM,
  // as it does a worker whose children keep it from exiting. Vitest sends SIGKILL 500 ms later, too soon for `ps` under
  // load, so SIGTERM ends those held, which can't have started others; with none held, as when the file's tests all
  // skipped, it looks, killing as it finds, so a look SIGKILL cuts short leaves nothing held. An exit always looks.
  process.once('exit', () => { signal(held, 'SIGKILL'); tree('SIGKILL'); });
  process.once('SIGTERM', () => {
    if (held.length) signal(held, 'SIGKILL');
    else tree('SIGKILL');
    process.kill(process.pid, 'SIGTERM');
  });
}
