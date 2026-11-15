// The child processes the core starts beside a session's hooks (`ps`, `git`), started from a thread of their own
// (design: Numbers version 0 has to hold, Hot path). Starting a process holds the thread that starts it until the
// exec, 25 to 40 ms on a loaded Mac whose endpoint scanner checks each exec; on the core's thread every hook reply
// queued behind it would wait that long.
// Portions of exec normalization/result handling are derived from Node.js child_process.js.
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
// to permit persons to whom the Software is furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all copies or substantial portions
// of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
// THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
// CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.

import type { ChildProcess, SpawnSyncReturns } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { subscribe } from 'node:diagnostics_channel';
import { Worker } from 'node:worker_threads';
import { YOUNG } from './settle.js';

/** What execFile's callback gets, as plain data: its error's code and message, and the output as text. */
interface Ran { error: { code?: number | string; message: string } | null; stdout: string; stderr: string; threw?: true }
interface RunOptions { env?: NodeJS.ProcessEnv; cwd?: string; timeout?: number; maxBuffer?: number }
export interface ChildJob { file: string; args: string[]; options: RunOptions; stdin?: number }

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

// Synchronous APIs do not publish diagnostics. Keep each invocation through the caller's completion turn.
interface SyncChild { pid?: number }
const synchronous = new Set<SyncChild>();
const processes = createRequire(import.meta.url)('node:child_process') as typeof import('node:child_process');
const nativeSpawnSync = processes.spawnSync;

// The exec normalization and error/result handling below follow Node's child_process.js (MIT license above).
// Only public spawnSync is used: process.binding would add deprecation warnings and fail permission-mode imports.
const executeSync = (name: 'spawnSync' | 'execFileSync' | 'execSync', original: (...args: never[]) => unknown, receiver: unknown, args: unknown[], child: SyncChild): unknown => {
  const spawn = (...given: unknown[]): SpawnSyncReturns<Buffer> => {
    const result = Reflect.apply(nativeSpawnSync, receiver, given) as SpawnSyncReturns<Buffer>;
    if (result.pid > 0) child.pid = result.pid;
    return result;
  };
  if (name === 'spawnSync') return spawn(...args);
  let [file, argv, options] = args;
  let callback: unknown;
  if (name === 'execSync') {
    // Let Node produce its own argument error, before any child can start.
    if (typeof file !== 'string' || file.includes('\0')) return Reflect.apply(original, receiver, args);
    options = { __proto__: null, ...(typeof argv === 'function' ? undefined : argv as object) };
    (options as Record<string, unknown>).shell = typeof (options as Record<string, unknown>).shell === 'string' ? (options as Record<string, unknown>).shell : true;
    argv = [];
  } else {
    if (Array.isArray(argv)) argv = argv.slice();
    else if (argv != null && typeof argv === 'object') { callback = options; options = argv; argv = null; }
    else if (typeof argv === 'function') { callback = argv; options = null; argv = null; }
    argv ??= [];
    if (typeof options === 'function') callback = options;
    else if (options != null && (typeof options !== 'object' || Array.isArray(options))) return Reflect.apply(original, receiver, args);
    options ??= Object.freeze({ __proto__: null });
    const opts = options as Record<string, unknown>;
    if (callback != null && typeof callback !== 'function') return Reflect.apply(original, receiver, args);
    if (opts.argv0 != null) {
      if (typeof opts.argv0 !== 'string') return Reflect.apply(original, receiver, args);
      if ((opts.argv0 as string).includes('\0')) return Reflect.apply(original, receiver, args);
    }
  }
  const opts = options as Record<string, unknown>;
  const inheritStderr = !opts.stdio;
  const result = spawn(file, argv, options);
  if (inheritStderr && result.stderr) process.stderr.write(result.stderr);
  const commandArgs = name === 'execFileSync' ? [opts.argv0 || file, ...(argv as unknown[])] : undefined;
  if (result.error) throw Object.assign(result.error, result);
  if (result.status !== 0) {
    const command = name === 'execSync' ? String(file) : commandArgs!.join(' ');
    throw Object.assign(new Error('Command failed: ' + command + (result.stderr?.length ? '\n' + result.stderr.toString() : '')), result);
  }
  return result.stdout;
};
for (const name of ['spawnSync', 'execFileSync', 'execSync'] as const) {
  const original = processes[name];
  const invoke = (receiver: unknown, args: unknown[]) => {
    const child: SyncChild = {};
    synchronous.add(child);
    try { return executeSync(name, original as (...args: never[]) => unknown, receiver, args, child); }
    finally { queueMicrotask(() => synchronous.delete(child)); }
  };
  const wrapped = new Proxy(original, {
    apply: (_target, receiver, args: unknown[]) => invoke(receiver, args),
    construct: (target, args: unknown[]) => {
      const receiver = Object.create(target.prototype) as object;
      const result = invoke(receiver, args);
      return result !== null && typeof result === 'object' ? result : receiver;
    },
  });
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
/**
 * The PID of the process at the other end of the connection on this process's descriptor `fd`, as the OS reports it
 * to `deep-hook peer`, or undefined where it reports none (#2070).
 */
export const peerOf = async (hook: string, fd: number): Promise<number | undefined> => {
  const r = await (ask({ file: hook, args: ['peer'], options: { timeout: 5000 }, stdin: fd }) as Promise<Ran>).catch(() => undefined);
  const pid = Number(r?.stdout.trim());
  return r && !r.error && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
};
/** A process's parent, or undefined once it is gone. */
export const parentOf = async (pid: number): Promise<number | undefined> => {
  const r = await run('ps', ['-o', 'ppid=', '-p', String(pid)], { env: C() });
  const ppid = Number(r.stdout.trim());
  return !r.error && Number.isSafeInteger(ppid) && ppid > 0 ? ppid : undefined;
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
