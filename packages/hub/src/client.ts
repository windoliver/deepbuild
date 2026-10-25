// The deep commands' side of the hub's socket: one call as the cli role, presenting the control token and, for a
// call the peer check judges, naming this process as the peer, so the hub can tell whether an agent's process tree
// runs the command.
import net from 'node:net';
import type { Refusal } from './wire.js';

type Obj = Record<string, unknown>;
/** The hub's answer to one call: its result, or its refusal. */
export type Reply = { result: Obj } | { error: Refusal };

/** One call on the hub's socket with the cli role; rejects only when the hub can't be reached or doesn't answer. */
export async function call(socket: string, token: string, method: string, params: Obj, peer?: { pid: number; start: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let hello = false;
    sock.setEncoding('utf8');
    sock.on('error', (error) => reject(Error(`can't reach the hub at ${socket}: ${error.message}`)));
    sock.on('close', () => reject(Error('the hub closed the connection before it answered')));
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        let reply: Obj;
        try {
          reply = JSON.parse(buffer.slice(0, i)) as Obj;
        } catch {
          sock.destroy();
          return reject(Error(`the hub answered a line that isn't JSON: ${buffer.slice(0, i).slice(0, 200)}`));
        }
        buffer = buffer.slice(i + 1);
        if (!hello) {
          hello = true;
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token, ...(peer ? { peer } : {}) })}\n`);
        } else if (reply.role !== undefined) {
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (reply.id === 1) {
          sock.destroy();
          resolve(reply.error ? { error: reply.error as Refusal } : { result: reply.result as Obj });
        }
      }
    });
  });
}
