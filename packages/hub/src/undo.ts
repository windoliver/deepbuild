// `deep undo staged:<id>` (#347): a run put back from the copy-on-write copy staged before it, through the hub's socket,
// until the copy is let go. `deep undo sync:<id>` (#148): an Agents page sync undone where you haven't edited a file
// since. An ask's or a decision's handle is undone as its other names undo it (#1814).
import { call, notAnswered, type Reply } from './client.js';
import { hubControl } from './paths.js';

const USAGE = 'Usage: deep undo staged:<id> | sync:<id> | ask:<id> | decision:<id>';

/** `deep undo <handle>`: exit 0 undone, 1 refused (as once the copy is let go), 2 a usage error, 3 the hub couldn't be reached. */
export async function undoCommand(args: readonly string[]): Promise<number> {
  if (args.length !== 1 || args[0]!.startsWith('-')) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (args[0]!.startsWith('ask:')) return (await import('./inbox.js')).inboxCommand(['undo', args[0]!]);
  if (args[0]!.startsWith('decision:')) return (await import('./memory.js')).memoryCommand(['overrule', args[0]!]);
  let reply: Reply;
  try {
    const { path: socket, token } = hubControl();
    const sync = args[0]!.startsWith('sync:');
    reply = await call(socket, token, sync ? 'agents.undo' : 'staged.undo', sync ? { sync: args[0] } : { staged: args[0] });
  } catch (error) {
    return notAnswered(error);
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
