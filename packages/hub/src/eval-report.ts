// A finished configuration eval is evidence the learned layer can cite (#2495). The script keeps its preflight
// file and sends the same bytes to the hub; it never opens another writer on the evidence store.
import { createHash } from 'node:crypto';
import { call } from './client.js';
import { hubControl } from './paths.js';

export async function storeEvalReport(report: string): Promise<string> {
  let socket: string;
  let token: string;
  try { ({ path: socket, token } = hubControl()); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Error('the hub has no control token; start it with deep hub start');
    throw error;
  }
  const reply = await call(socket, token, 'eval.report', { report });
  if ('error' in reply) throw Error(reply.error.remediation);
  const handle = `ev:${createHash('sha256').update(report).digest('hex')}`;
  if (reply.result.handle !== handle) throw Error('the hub did not return the handle of the eval report it was sent');
  return handle;
}
