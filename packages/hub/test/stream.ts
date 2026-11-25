// A wait on the hub's event stream, for the hub's own tests.
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

type Obj = Record<string, any>;

/** The first event of `kind` on the hub's stream, from the log's start: one already there or the next to come within 30 s, or it throws `late`. */
export async function first(root: string, kind: string, late = `the hub streamed no ${kind} event in 30 s`): Promise<Obj> {
  const sock = net.connect(join(root, 'hub.sock'));
  const lines: Obj[] = [];
  let look = () => {};
  // deadline: an event the hub never streams fails here, saying which, not as the test's timeout
  const bound = setTimeout(() => sock.destroy(Error(late)), 30_000);
  createInterface({ input: sock }).on('line', (raw) => { lines.push(JSON.parse(raw) as Obj); look(); });
  const next = (f: (l: Obj) => boolean) => new Promise<Obj>((resolve, reject) => {
    look = () => { const l = lines.find(f); if (l) resolve(l); };
    sock.once('error', reject);
    sock.once('close', () => reject(Error(`the hub hung up before its ${kind} event`)));
    look();
  });
  try {
    await next(() => true);
    sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: readFileSync(join(root, 'control.token'), 'utf8').trim() })}\n`);
    await next((l) => 'role' in l);
    sock.write(`${JSON.stringify({ v: 1, id: 'all', method: 'stream.subscribe', params: { after: 0 } })}\n`);
    return (await next((l) => l.id === 'all' && l.event?.kind === kind)).event as Obj;
  } finally {
    clearTimeout(bound);
    sock.removeAllListeners('close');
    sock.destroy();
  }
}
