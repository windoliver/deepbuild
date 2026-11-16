// A finished configuration eval is evidence the learned layer can cite (#2495). The script keeps its preflight
// file and sends the same bytes to the hub; it never opens another writer on the evidence store.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';

export async function storeEvalReport(report: string): Promise<string> {
  const socket = hubAddress().path;
  const tokenFile = [rootOf(dirname(socket)).token, rootOf(installedRoot()).token].find(existsSync);
  if (!tokenFile) throw Error('the hub has no control token; start it with deep hub start');
  const reply = await call(socket, readFileSync(tokenFile, 'utf8').trim(), 'eval.report', { report });
  if ('error' in reply) throw Error(reply.error.remediation);
  const handle = `ev:${createHash('sha256').update(report).digest('hex')}`;
  if (reply.result.handle !== handle) throw Error('the hub did not return the handle of the eval report it was sent');
  return handle;
}
