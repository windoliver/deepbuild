// `deep fix <id>` (#66): starts work from a work item by its ID at any source you switched on, over the running hub.
// It prints one sentence naming the task it started, or with `--json` the task and the item's link as one line of JSON
// (#1812), and asks no question.
import { call, notAnswered } from './client.js';
import { hubControl } from './paths.js';
import { visible } from './visible.js';

export async function fixCommand(args: readonly string[]): Promise<number> {
  const json = args.includes('--json');
  const [id, ...rest] = args.filter((a) => a !== '--json');
  if (rest.length || !id || id.startsWith('-')) {
    process.stderr.write('Usage: deep fix <id> [--json]   starts work from a work item at a source you switched on, such as LIN-42\n');
    return 2;
  }
  try {
    const { path: socket, token } = hubControl();
    const reply = await call(socket, token, 'work.fix', { id, cwd: process.cwd() });
    if ('error' in reply) {
      process.stderr.write(`${reply.error.remediation}\n`);
      return 1;
    }
    const { task, link } = reply.result as { task: string; link: string };
    process.stdout.write(json ? `${JSON.stringify(reply.result)}\n` : `${visible(`Started ${task} from ${id}: ${link}`)}\n`);
    return 0;
  } catch (error) {
    return notAnswered(error);
  }
}
