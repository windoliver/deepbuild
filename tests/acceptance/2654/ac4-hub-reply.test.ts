// #2654 criterion 4: "With the hub's reply held open with no newline, `deep mcp` gives up at the cap and tells its
// client the call failed, where today it waits and grows"
//
// A stand-in hub on the home's default socket greets deep mcp and answers its deep_status call with the start of a
// reply and then 32 MiB (the cap and 16 MiB more) with no newline, and holds the connection open. "Gives up at the
// cap": deep mcp answers its client that the call failed (a JSON-RPC error, or a tool result with isError) once the
// stand-in has sent at least the cap, and well before the 55 s deep mcp waits for any call today (ANSWER_MS, mcp.ts):
// the test waits 45 s from the call.
import { expect, test } from 'vitest';
import { AC, CAP, Mcp, SHORT, StandInHub, mb, request, tempHome } from './helpers.ts';

const WAIT_MS = 45_000;

test(`${AC.reply} with the hub's reply held open with no newline, deep mcp gives up at the 16 MiB cap and tells its client the call failed`, async () => {
  const { dir, home } = tempHome();
  const hub = new StandInHub(home, CAP + 16 * 1024 * 1024);
  await hub.listening();
  const mcp = new Mcp(home, dir);
  await mcp.write(request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-2654', version: '0' } }));
  const init = await mcp.waitFor((l) => l.id === 1, 60_000);
  expect(init?.result, `setup: deep mcp answers initialize (${mcp.shown()})`).toBeDefined();
  const called = Date.now();
  await mcp.write(request(2, 'tools/call', { name: 'deep_status', arguments: {} }));
  const answer = await mcp.waitFor((l) => l.id === 2, WAIT_MS);
  const writtenThen = hub.written;
  const after = Date.now() - called;
  await mcp.end(5_000);

  expect(hub.called, `setup: deep mcp sent its call to the stand-in hub (${mcp.shown()})`).toBe(true);
  expect(answer, `deep mcp tells its client within ${WAIT_MS / 1000} s that the call failed; the stand-in had sent ${mb(hub.written)} of a reply with no newline${hub.finishedAt ? `, all of it ${((hub.finishedAt - called) / 1000).toFixed(1)} s after the call` : ''}; ${mcp.shown()}`).toBeDefined();
  const failed = answer!.error !== undefined || answer!.result?.isError === true;
  expect(failed, `the answer to the call says it failed: ${JSON.stringify(answer).slice(0, 1500)}`).toBe(true);
  expect(writtenThen, `deep mcp gave up at the cap, after ${(after / 1000).toFixed(1)} s, with ${mb(writtenThen)} of the reply sent, not before ${mb(CAP)}`).toBeGreaterThanOrEqual(CAP);
}, SHORT);
