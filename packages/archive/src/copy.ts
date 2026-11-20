// A transcript of a part or more is read and scrubbed off the hub's event loop; a smaller one here, a quarter part
// at a time. One bounded part is in flight at a time.
import { MessageChannel, Worker } from 'node:worker_threads';
import { copyFile, PART, type CopyResult, type Part, type Prefix } from './copy-file.ts';

export { PART, sourceStamp, type CopyResult, type Part, type Prefix } from './copy-file.ts';
let queue = Promise.resolve();
// One worker serves the copies that follow each other and ends a second after the last, so a pass loads the scrub's
// rules in it once, not once a transcript. After a large transcript it ends at once: the evidence store hashes that
// copy in a worker of its own, and the two resident together added about 12 MB to a pass.
const REUSE = 8 * 1024 * 1024;
let worker: Worker | undefined;
let idle: NodeJS.Timeout | undefined;

export function copyTranscript(path: string, size: number, stamp: string, before: Prefix | undefined, stable: boolean, held: readonly string[], session: string, keep: (part: Part) => Promise<void>): Promise<CopyResult> {
  const job = { path, size, stamp, ...(before && { before }), stable, held, session };
  const run = queue.then(async () => {
    // Under a part there is less to scrub than a worker costs to start (about 0.26G instructions, which a pass over
    // small sessions paid for nothing). A quarter part of the issue's densest text scrubs in about 16 ms.
    if (size < PART) return copyFile(job, PART / 4, keep);
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
        thread.postMessage({ ...job, port: port2 }, [port2]);
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
