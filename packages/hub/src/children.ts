// The child processes the core starts beside a session's hooks (`ps`, `git`), started from a thread of their own
// (design: Numbers version 0 has to hold, Hot path). Starting a process holds the thread that starts it until the
// exec, 25 to 40 ms on a loaded Mac whose endpoint scanner checks each exec; on the core's thread every hook reply
// queued behind it would wait that long.
import { Worker } from 'node:worker_threads';

/** What execFile's callback gets, as plain data: its error's code and message, and the output as text. */
interface Ran { error: { code?: number | string; message: string } | null; stdout: string; stderr: string }
interface RunOptions { env?: NodeJS.ProcessEnv; cwd?: string; timeout?: number; maxBuffer?: number }
export interface ChildJob { file: string; args: string[]; options: RunOptions }

let worker: Worker | undefined;
let n = 0;
const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
function ask(job: ChildJob): Promise<unknown> {
  if (!worker) {
    const started = worker = new Worker(new URL('./children-worker.js', import.meta.url));
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
/** A process's arguments, or nothing once it is gone. */
export const argsOf = async (pid: number): Promise<string> => {
  const r = await run('ps', ['-o', 'args=', '-p', String(pid)], { env: C() });
  return r.error ? '' : r.stdout.trim();
};
