// Only this worker sees a large transcript's raw text. No raw key crosses to the record or the calling thread.
import { once } from 'node:events';
import { isMarkedAsUntransferable, parentPort, type MessagePort } from 'node:worker_threads';
import { copyFile, PART, type Job } from './copy-file.ts';

parentPort!.on('message', async ({ port, ...job }: Job & { port: MessagePort }) => {
  try {
    const result = await copyFile(job, PART, async (part) => {
      // A small part's bytes come from a shared pool, which can't be transferred, so they are copied out of it.
      if (isMarkedAsUntransferable(part.bytes.buffer)) part.bytes = Uint8Array.from(part.bytes);
      port.postMessage({ part }, [part.bytes.buffer as ArrayBuffer]);
      const [reply] = await once(port, 'message') as [{ error?: string }];
      if (reply.error) throw Error(reply.error);
    });
    port.postMessage({ result });
  } catch (error) { port.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
  finally { port.close(); }
});
