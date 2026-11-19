import { MessageChannel, Worker } from 'node:worker_threads';
import type { DigestState } from './digest.ts';

export interface Continued { state: DigestState; sha256: string }
let worker: Worker | undefined;
let queue = Promise.resolve();
/** Continue a verified prefix while holding at most one incoming chunk and one worker's SHA state. */
export function continueDigest(state: DigestState | undefined, bytes: AsyncIterable<Uint8Array>): Promise<Continued> {
  const run = queue.then(async () => {
    const thread = worker ??= new Worker(new URL(import.meta.url.endsWith('.ts') ? './digest-worker.ts' : './digest-worker.js', import.meta.url), { execArgv: [], resourceLimits: { maxYoungGenerationSizeMb: 2 } });
    thread.ref();
    const { port1, port2 } = new MessageChannel();
    let pending: { resolve(v: Continued): void; reject(e: Error): void } | undefined;
    let failure: Error | undefined;
    const failed = (error: Error) => { failure = error; if (worker === thread) worker = undefined; pending?.reject(error); };
    const exited = (code: number) => failed(Error(`the digest worker exited ${code}`));
    const reply = () => new Promise<Continued>((resolve, reject) => { pending = { resolve, reject }; if (failure) reject(failure); });
    thread.once('error', failed); thread.once('exit', exited);
    port1.on('message', (m: Continued & { error?: string }) => { if (m.error) pending?.reject(Error(m.error)); else pending?.resolve(m); });
    try {
      const ready = reply();
      thread.postMessage({ state, port: port2 }, [port2]);
      await ready;
      for await (const chunk of bytes) {
        const accepted = reply();
        port1.postMessage(chunk);
        await accepted;
      }
      const result = reply(); port1.postMessage(null);
      return await result;
    } finally {
      port1.close(); thread.removeListener('error', failed); thread.removeListener('exit', exited); thread.unref();
    }
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
}
