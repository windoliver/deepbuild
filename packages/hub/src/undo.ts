// `deep undo staged:<id>` (#347): a destructive command's run undone from the copy-on-write copy staged before it
// ran, through the hub's socket as the cli role, until the copy is let go at its set time. `deep undo sync:<id>`
// (#148): an Agents page sync undone, each file put back where you haven't edited it since.
import { readFileSync } from 'node:fs';
import { call, type Reply } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';

const USAGE = 'Usage: deep undo staged:<id> | sync:<id>';

/** `deep undo <handle>`: exit 0 undone, 1 refused (as once the copy is let go), 2 a usage error, 3 the hub couldn't be reached. */
export async function undoCommand(args: readonly string[]): Promise<number> {
  if (args.length !== 1 || args[0]!.startsWith('-')) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  let reply: Reply;
  try {
    const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
    const sync = args[0]!.startsWith('sync:');
    reply = await call(hubAddress().path, token, sync ? 'agents.undo' : 'staged.undo', sync ? { sync: args[0] } : { staged: args[0] });
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}; nothing was undone\n`);
    return 3;
  }
  if ('error' in reply) {
    process.stderr.write(`${reply.error.remediation}\n`);
    return reply.error.code === 'handle_syntax' ? 2 : 1;
  }
  if (typeof reply.result.sync === 'string') {
    for (const note of (reply.result.notes ?? []) as string[]) process.stderr.write(`${note}\n`);
    process.stdout.write(`${reply.result.sync} undone: ${((reply.result.undone ?? []) as string[]).join(', ') || 'nothing was left to put back'}\n`);
    return 0;
  }
  const put = [...reply.result.folders as string[], ...reply.result.files as string[]];
  process.stdout.write(`${String(reply.result.staged)} undone: ${put.join(', ')} hold again what they held before the run\n`);
  return 0;
}
