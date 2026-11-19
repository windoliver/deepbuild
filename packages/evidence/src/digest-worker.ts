// The evidence store's continuation work, never on the hub's event loop.
import { parentPort, type MessagePort } from 'node:worker_threads';
import { Digest, type DigestState } from './digest.ts';

parentPort!.on('message', ({ state, port }: { state?: DigestState; port: MessagePort }) => {
  try {
    const hash = new Digest(state);
    port.on('message', (bytes: Uint8Array | null) => {
      try {
        if (bytes) { hash.update(bytes); port.postMessage({ ready: true }); }
        else { port.postMessage({ state: hash.state(), sha256: hash.hex() }); port.close(); }
      } catch (error) { port.postMessage({ error: error instanceof Error ? error.message : String(error) }); port.close(); }
    });
    port.postMessage({ ready: true });
  } catch (error) { port.postMessage({ error: error instanceof Error ? error.message : String(error) }); port.close(); }
});
