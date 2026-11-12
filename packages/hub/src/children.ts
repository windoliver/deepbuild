// The child processes the core starts beside a session's hooks (`ps`, `git`), started from a thread of their own
// (design: Numbers version 0 has to hold, Hot path). Starting a process holds the thread that starts it until the
// exec, 25 to 40 ms on a loaded Mac whose endpoint scanner checks each exec; on the core's thread every hook reply
// queued behind it would wait that long.
import type { ChildProcess, SpawnSyncReturns } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { subscribe } from 'node:diagnostics_channel';
import { Worker } from 'node:worker_threads';
import { YOUNG } from './settle.js';

/** What execFile's callback gets, as plain data: its error's code and message, and the output as text. */
interface Ran { error: { code?: number | string; message: string } | null; stdout: string; stderr: string; threw?: true }
interface RunOptions { env?: NodeJS.ProcessEnv; cwd?: string; timeout?: number; maxBuffer?: number }
export interface ChildJob { file: string; args: string[]; options: RunOptions }

// Node announces the actual ChildProcess before spawn returns, including children started indirectly by packages.
// Keep the object, not a reusable PID, through every exit listener; no signal or new lifetime policy is imposed.
const children = new Set<ChildProcess>();
subscribe('child_process', (message: unknown) => {
  const child = (message as { process: ChildProcess }).process;
  children.add(child);
  const gone = () => queueMicrotask(() => {
    children.delete(child);
    child.removeListener('exit', gone);
    child.removeListener('close', gone);
  });
  child.once('exit', gone);
  child.once('close', gone); // A failed spawn has no exit event.
  // The constructor is announced before spawn: an E2BIG throw creates no process and emits neither event.
  queueMicrotask(() => { if (child.pid === undefined) gone(); });
});

/** The actual asynchronous children this thread still owns, including during their exit notification. */
export const trackedChildren = (): readonly ChildProcess[] => [...children];

// Synchronous child APIs do not publish diagnostics. Their boundary stays synchronous: register each invocation
// before entering Node, retain its identity through return/throw, and retire it once the caller yields.
interface SyncChild { pid?: number }
const synchronous = new Set<SyncChild>();
// execFileSync/execSync return only stdout. The pinned Node binding is the one boundary common to all three;
// retain its actual PID without changing the public function's result, errors, encoding or stdio behavior.
const binding = (process as unknown as { binding(name: string): { spawn(options: unknown): { pid?: number; status?: number | null } } }).binding('spawn_sync');
const nativeSpawn = binding.spawn;
let current: SyncChild | undefined;
binding.spawn = function (options) {
  const result = nativeSpawn.call(this, options);
  if (current && result.pid && result.pid > 0) current.pid = result.pid;
  return result;
};
const processes = createRequire(import.meta.url)('node:child_process') as typeof import('node:child_process');
for (const name of ['spawnSync', 'execFileSync', 'execSync'] as const) {
  const original = processes[name];
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const child: SyncChild = {};
    synchronous.add(child);
    const previous = current;
    current = child;
    try {
      const result: unknown = Reflect.apply(original, this, args);
      if (name === 'spawnSync' && (result as SpawnSyncReturns<Buffer>).pid > 0) child.pid = (result as SpawnSyncReturns<Buffer>).pid;
      return result;
    } catch (error) {
      const pid = (error as { pid?: number } | null)?.pid;
      if (pid && pid > 0) child.pid = pid;
      throw error;
    } finally {
      current = previous;
      queueMicrotask(() => synchronous.delete(child));
    }
  };
  Object.defineProperty(processes, name, { ...Object.getOwnPropertyDescriptor(processes, name), value: wrapped });
}
syncBuiltinESMExports();
/** The synchronous invocations owned through their completion turn. */
export const trackedSyncChildren = (): readonly SyncChild[] => [...synchronous];

let worker: Worker | undefined;
let n = 0;
const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
function ask(job: ChildJob): Promise<unknown> {
  if (!worker) {
    const started = worker = new Worker(new URL('./children-worker.js', import.meta.url), { resourceLimits: YOUNG });
    started.on('message', (m: { n: number; result: unknown }) => {
      const w = waiting.get(m.n);
      waiting.delete(m.n);
      if (!waiting.size) started.unref();
      w?.resolve(m.result);
    });
    // A thread that died fails what it held; the next job starts another.
    const gone = (error: Error) => {
      if (worker === started) worker = undefined;
      for (const w of waiting.values()) w.reject(error);
      waiting.clear();
    };
    started.on('error', gone);
    started.on('exit', (code) => gone(Error(`the child-process thread exited ${code}`)));
  }
  const id = ++n;
  // The thread keeps the process alive only while it runs a child: the child is its own, not the process's.
  worker.ref();
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker!.postMessage({ n: id, ...job });
  });
}

/** execFile, run from the children's thread; a thread that can't run it reads as a failed run. */
export const run = (file: string, args: string[], options: RunOptions = {}): Promise<Ran> =>
  (ask({ file, args, options }) as Promise<Ran>).catch((error: Error) => ({ error: { message: error.message }, stdout: '', stderr: '' }));

/** execFile's synchronous argument errors still reject; ordinary child failures keep their output result. */
export const exec = async (file: string, args: string[], options: RunOptions = {}): Promise<Ran> => {
  const result = await run(file, args, options);
  if (result.threw) throw Object.assign(new TypeError(result.error!.message), { code: result.error!.code });
  return result;
};

const C = (): NodeJS.ProcessEnv => ({ ...process.env, LC_ALL: 'C' });
/** A process's start time, as wire.ts's startOf reads it (`ps -o lstart=`), or undefined when it can't be read. */
export const startOf = async (pid: number): Promise<string | undefined> => {
  const r = await run('ps', ['-o', 'lstart=', '-p', String(pid)], { env: C() });
  return r.error ? undefined : r.stdout.trim() || undefined;
};
/** Every process's parent, from one `ps`: how the peer check walks up from a deep command to the agent above it. */
export const parents = async (): Promise<Map<number, number>> => {
  const r = await run('ps', ['-A', '-o', 'pid=,ppid='], { env: C(), maxBuffer: 16 << 20 });
  const map = new Map<number, number>();
  if (!r.error) for (const row of r.stdout.split('\n')) { const [pid, ppid] = row.trim().split(/\s+/).map(Number); if (pid && ppid) map.set(pid, ppid); }
  return map;
};
/**
 * The process group of the newest process under `ancestor` whose arguments hold `text`, apart from the ancestor's own
 * group, or undefined: where a background command an agent started runs (#907).
 */
export const groupUnder = async (ancestor: number, text: string): Promise<number | undefined> => {
  const r = await run('ps', ['-A', '-o', 'pid=,pgid=,ppid=,args='], { env: C(), maxBuffer: 16 << 20 });
  if (r.error || !text) return undefined;
  const rows = r.stdout.split('\n').map((row) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s(.*)$/.exec(row)).filter((m) => m !== null).map((m) => ({ pid: Number(m[1]), pgid: Number(m[2]), ppid: Number(m[3]), args: m[4]! }));
  const byPid = new Map(rows.map((p) => [p.pid, p]));
  const own = byPid.get(ancestor)?.pgid;
  const under = (pid: number): boolean => {
    for (let at = byPid.get(pid), n = 0; at && n < 64; at = byPid.get(at.ppid), n++) if (at.ppid === ancestor) return true;
    return false;
  };
  return rows.filter((p) => p.pgid !== own && p.args.includes(text) && under(p.pid)).sort((a, b) => b.pid - a.pid)[0]?.pgid;
};
/** A process's arguments, or nothing once it is gone. */
export const argsOf = async (pid: number): Promise<string> => {
  const r = await run('ps', ['-o', 'args=', '-p', String(pid)], { env: C() });
  return r.error ? '' : r.stdout.trim();
};
