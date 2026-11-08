// `deep fix <id>` (#66): starts work from a work item by its ID at any source you switched on, over the running hub.
// It prints one line of JSON, the task and the item's link, and asks no question.
import { readFileSync } from 'node:fs';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';

export async function fixCommand(args: readonly string[]): Promise<number> {
  const [id] = args;
  if (args.length !== 1 || !id || id.startsWith('-')) {
    process.stderr.write('Usage: deep fix <id>   starts work from a work item at a source you switched on, such as LIN-42\n');
    return 2;
  }
  try {
    const reply = await call(hubAddress().path, readFileSync(rootOf(installedRoot()).token, 'utf8').trim(), 'work.fix', { id, cwd: process.cwd() });
    if ('error' in reply) {
      process.stderr.write(`${reply.error.remediation}\n`);
      return 1;
    }
    process.stdout.write(`${JSON.stringify(reply.result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`);
    return 3;
  }
}
