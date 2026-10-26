// #26.730e54de With the hub stopped, `deep_status` and a `deep_wait` already waiting each answer within a second
// that the hub is unreachable, never with a success; the agent's tool list is the same before, during and after;
// and once the hub is back the next call succeeds without restarting the agent's session.
// The agent's one deep mcp runs throughout; only the hub stops (SIGTERM, by its PID) and starts again on its root.

import { afterAll, expect, test } from 'vitest';
import {
  agentWorld, callTool, errorOf, cleanup, listTools, pending, sleep, startHub, stopHub, valueOf, word,
} from './helpers.ts';

afterAll(cleanup, 30_000);

test('#26.730e54de with the hub stopped, deep_status and a waiting deep_wait answer within a second that it is unreachable; the tool list holds; the next call after it is back succeeds', async () => {
  let open = '';
  const question = `Which footer for ${word()}?`;
  const { hub, home, agent, session } = await agentWorld({
    seeded: async (s, sess, worktree) => {
      await s.start(sess.id, worktree);
      open = await s.raise(sess.id, 'taste', question);
    },
  });
  const before = await listTools(agent);
  expect(before.map((t) => t.name), 'the tool list has deep_status and deep_wait').toEqual(expect.arrayContaining(['deep_status', 'deep_wait']));
  const server = await agent.mcpProcess();

  // deep_wait on the session's open ask, waiting when the hub stops.
  const waiting = pending(callTool(agent, 'deep_wait', { ask: open }));
  const early = await Promise.race([waiting.then((r) => r), sleep(2000).then(() => undefined)]);
  if (early) throw Error(`deep_wait on the open ${open} answered before the hub stopped: ${early.failed ?? JSON.stringify(early.returned?.reply).slice(0, 1500)}`);
  await stopHub(hub);
  const stopped = performance.now();
  const waited = await waiting;
  const after = performance.now() - stopped;
  if (!waited.returned) throw Error(`deep_wait failed rather than answering: ${waited.failed}`);
  const waitError = errorOf(waited.returned, 'the waiting deep_wait, with the hub stopped');
  expect(waitError.code, 'the waiting deep_wait says the hub is unreachable').toBe('unavailable');
  expect(after, `the waiting deep_wait answers within a second of the hub stopping (it took ${after.toFixed(0)} ms)`).toBeLessThan(1000);

  const status = await callTool(agent, 'deep_status', {});
  const statusError = errorOf(status, 'deep_status with the hub stopped');
  expect(statusError.code, 'deep_status says the hub is unreachable').toBe('unavailable');
  expect(status.ms, `deep_status answers within a second with the hub stopped (it took ${status.ms.toFixed(0)} ms)`).toBeLessThan(1000);
  expect(await listTools(agent), 'the tool list with the hub stopped is the one before').toEqual(before);

  // The hub is back. The agent's next tool call carries its PreToolUse, as it would; its deep mcp is the same process.
  const back = await startHub(home);
  await agent.stamp(back, session, 'deep_status', {});
  const again = valueOf(await callTool(agent, 'deep_status', {}), 'deep_status once the hub is back');
  expect(again?.session, 'once the hub is back, deep_status reads the session it serves').toBe(session.id);
  expect(await agent.mcpProcess(), 'the agent\'s deep mcp is the same process throughout').toEqual(server);
  expect(server.alive, 'the agent\'s deep mcp kept running').toBe(true);
  expect(await listTools(agent), 'the tool list after the hub is back is the one before').toEqual(before);
}, 180_000);
