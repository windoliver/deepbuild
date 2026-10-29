// `deep undo staged:<id>` (#347): a destructive command's run undone from the copy-on-write copy staged before it
// ran, through the hub's socket as the cli role, until the copy is let go at its set time.
import { readFileSync } from 'node:fs';
import { call, type Reply } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';

const USAGE = 'Usage: deep undo staged:<id>';

/** `deep undo <handle>`: exit 0 undone, 1 refused (as once the copy is let go), 2 a usage error, 3 the hub couldn't be reached. */
export async function undoCommand(args: readonly string[]): Promise<number> {
  if (args.length !== 1 || args[0]!.startsWith('-')) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  let reply: Reply;
  try {
    const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
    reply = await call(hubAddress().path, token, 'staged.undo', { staged: args[0] });
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}; nothing was undone\n`);
    return 3;
  }
  if ('error' in reply) {
    process.stderr.write(`${reply.error.remediation}\n`);
    return reply.error.code === 'handle_syntax' ? 2 : 1;
  }
  process.stdout.write(`${String(reply.result.staged)} undone: ${(reply.result.folders as string[]).join(', ')} hold again what they held before the run\n`);
  return 0;
}
