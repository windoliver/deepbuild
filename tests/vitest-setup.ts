// Runs before every vitest file (vitest.config.ts), so a test file leaves nothing running or gigabytes on disk.
//
// A process a file started ends with the file. A child still running at the file's end, such as #29's planted heavy
// command that waits for a `go` file its test never writes, ran on under launchd for days. So at the file's end, and
// when the worker exits early, every process descending from this worker is stopped: by PID, never by name, port or
// process group, since the group is the shell's that started vitest.
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

interface Proc { pid: number; ppid: number; start: string; command: string }
/** Every process as `ps` shows it now, `ps` itself left out. */
function table(): Proc[] {
  const ps = spawnSync('ps', ['-axww', '-o', 'pid=,ppid=,lstart=,command='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  return (ps.stdout ?? '').split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})\s+(.*)$/.exec(line);
    return m && Number(m[1]) !== ps.pid ? [{ pid: Number(m[1]), ppid: Number(m[2]), start: m[3]!, command: m[4]! }] : [];
  });
}
const signal = (procs: Proc[], sig: NodeJS.Signals): void => {
  for (const p of procs) try { process.kill(p.pid, sig); } catch { /* gone */ }
};
/**
 * Every process descending from this one, each stopped (SIGSTOP) as it is found, so none starts another or ends and
 * leaves its children to launchd while the rest are taken.
 */
function stopTree(): Proc[] {
  const found = new Map<number, Proc>();
  for (;;) {
    const procs = table();
    const fresh: Proc[] = [];
    const walk = (pid: number): void => { for (const p of procs) if (p.ppid === pid) { if (!found.has(p.pid)) fresh.push(p); walk(p.pid); } };
    walk(process.pid);
    if (!fresh.length) return [...found.values()];
    signal(fresh, 'SIGSTOP');
    for (const p of fresh) found.set(p.pid, p);
  }
}

// In a threads pool this process is vitest's own, and its descendants are every file's: nothing is stopped there.
if (isMainThread) {
  afterAll(async () => {
    const left = stopTree();
    if (!left.length) return;
    console.warn(`vitest-setup: stopping ${left.length} process(es) this file left running:\n${left.map((p) => `  ${p.pid} ${p.command.slice(0, 200)}`).join('\n')}`);
    signal(left, 'SIGTERM');
    signal(left, 'SIGCONT');
    // One that outlives SIGTERM by 2 s gets SIGKILL, while its PID is still the process first seen (same start time),
    // wherever it was reparented when its parent ended.
    const running = (): Proc[] => { const now = new Map(table().map((p) => [p.pid, p.start])); return left.filter((p) => now.get(p.pid) === p.start); };
    for (const end = Date.now() + 2000; running().length && Date.now() < end;) await new Promise((resolve) => setTimeout(resolve, 50));
    signal(running(), 'SIGKILL');
  });
  process.once('exit', () => signal(stopTree(), 'SIGKILL'));
}
