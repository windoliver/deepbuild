// Transcript IO and scrubbing run off the hub's event loop. One bounded part is in flight at a time.
import type { BigIntStats } from 'node:fs';
import { MessageChannel, Worker } from 'node:worker_threads';

export interface Prefix { size: number; sha256: string; ended?: boolean; continuable?: boolean }
export interface Part { bytes: Uint8Array; complete: boolean; cwd?: string; keys: { key: string; uuid?: string }[] }
/** A part's target size. A megabyte: each cut scans its 64 KiB of lookahead again, a quarter of a 256 KiB part. */
export const PART = 1024 * 1024;
export const sourceStamp = (s: BigIntStats): string => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
export interface CopyResult extends Prefix { grew: boolean; ended: boolean; continuable: boolean }
let queue = Promise.resolve();
// One worker serves the small copies that follow each other and ends a second after the last, so a pass loads the
// scrub's rules once, not once a transcript. After a large transcript it ends at once: the evidence store hashes that
// copy in a worker of its own, and the two resident together added about 12 MB to a pass.
const REUSE = 8 * 1024 * 1024;
let worker: Worker | undefined;
let idle: NodeJS.Timeout | undefined;

export function copyTranscript(path: string, size: number, stamp: string, before: Prefix | undefined, stable: boolean, held: readonly string[], session: string, keep: (part: Part) => Promise<void>): Promise<CopyResult> {
  const run = queue.then(async () => {
    clearTimeout(idle);
    const thread = worker ??= new Worker(new URL(import.meta.url.endsWith('.ts') ? './copy-worker.ts' : './copy-worker.js', import.meta.url), { execArgv: [], resourceLimits: { maxYoungGenerationSizeMb: 2 } });
    thread.ref();
    const { port1, port2 } = new MessageChannel();
    try {
      return await new Promise<CopyResult>((resolve, reject) => {
        const failed = (error: Error) => { if (worker === thread) worker = undefined; reject(error); };
        const exited = (code: number) => failed(Error(`the transcript worker exited ${code}`));
        thread.once('error', failed);
        thread.once('exit', exited);
        port1.once('close', () => { thread.removeListener('error', failed); thread.removeListener('exit', exited); });
        port1.on('message', (message: { part?: Part; result?: CopyResult; error?: string }) => {
          if (message.error) reject(Error(message.error));
          else if (message.result) resolve(message.result);
          else if (message.part) void keep(message.part).then(() => port1.postMessage({ ok: true }), (error: unknown) => {
            // The worker answers with its own error once it has closed the transcript.
            port1.postMessage({ error: error instanceof Error ? error.message : String(error) });
          });
        });
        thread.postMessage({ path, size, stamp, before, stable, held, session, port: port2 }, [port2]);
      });
    } finally {
      port1.close();
      thread.unref();
      const end = () => { if (worker === thread) worker = undefined; return thread.terminate(); };
      if (size < REUSE) idle = setTimeout(() => void end(), 1000).unref();
      else await end();
    }
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
}
