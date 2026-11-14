// A protocol peer, not a DeepBuild replacement. Keep the agent parent separate from the test's
// person/CLI process tree. Reuse the base's socket reader; every reply is the real hub's.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reply } from '../../../packages/hub/test/hub.ts';

if (process.argv[2] === 'hook') {
  process.once('message', async ({ socket, request }) => {
    try {
      const result = await reply(socket, `${JSON.stringify({ ...request, pid: process.pid, ppid: process.ppid })}\n`);
      process.send({ result }, () => process.disconnect());
    } catch (error) { process.send({ error: String(error) }, () => process.disconnect()); }
  });
} else {
  process.on('message', ({ id, socket, request }) => {
    const hook = fork(fileURLToPath(import.meta.url), ['hook'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    hook.once('message', (result) => process.send({ id, ...result }));
    hook.send({ socket, request });
  });
}
