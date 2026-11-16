// Transcript IO and scrubbing run off the hub's event loop. One bounded part is in flight at a time.
import type { BigIntStats } from 'node:fs';
import { MessageChannel, Worker } from 'node:worker_threads';

export interface Prefix { size: number; sha256: string; ended?: boolean; continuable?: boolean }
export interface Part { bytes: Uint8Array; complete: boolean; cwd?: string; keys: { key: string; uuid?: string }[] }
export const sourceStamp = (s: BigIntStats): string => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
export interface CopyResult extends Prefix { grew: boolean; ended: boolean; continuable: boolean }
let queue = Promise.resolve();

export function copyTranscript(path: string, size: number, stamp: string, before: Prefix | undefined, stable: boolean, held: readonly string[], session: string, keep: (part: Part) => Promise<void>): Promise<CopyResult> {
  const run = queue.then(async () => {
    const thread = new Worker(new URL(import.meta.url.endsWith('.ts') ? './copy-worker.ts' : './copy-worker.js', import.meta.url), { execArgv: [], resourceLimits: { maxYoungGenerationSizeMb: 2 } });
    const { port1, port2 } = new MessageChannel();
    try {
      return await new Promise<CopyResult>((resolve, reject) => {
        const failed = (error: Error) => reject(error);
        const exited = (code: number) => failed(Error(`the transcript worker exited ${code}`));
        thread.once('error', failed);
        thread.once('exit', exited);
        port1.once('close', () => { thread.removeListener('error', failed); thread.removeListener('exit', exited); });
        port1.on('message', (message: { part?: Part; result?: CopyResult; error?: string }) => {
          if (message.error) reject(Error(message.error));
          else if (message.result) resolve(message.result);
          else if (message.part) void keep(message.part).then(() => port1.postMessage({ ok: true }), (error: unknown) => {
            // Wait for the worker's error reply and finally/close before the next job uses this thread.
            port1.postMessage({ error: error instanceof Error ? error.message : String(error) });
          });
        });
        thread.postMessage({ path, size, stamp, before, stable, held, session, port: port2 }, [port2]);
      });
    } finally {
      port1.close();
      // The continuation is computed next in the evidence worker. Release this isolate first: keeping both
      // resident added about 80 MB even for a 1 MB append. Awaiting termination also closes its file handles.
      await thread.terminate();
    }
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
}
