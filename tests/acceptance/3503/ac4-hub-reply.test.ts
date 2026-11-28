// #3503 criterion 4: "With the hub's reply held open with no newline, the server gives up at the cap and tells its
// client the call failed, where today it waits and grows"
//
// A stand-in hub on the home's default socket greets deep-hook, takes its hello, and answers its find_actions call with
// the start of a reply and then 32 MiB (the cap and 16 MiB more) with no newline, and holds the connection open. "Gives
// up at the cap": the server answers its client that the call failed (a JSON-RPC error, or a tool result with isError)
// once the stand-in has sent at least the cap, and well before the 55 s it waits for any call today (ANSWER,
// actions.rs): the test waits 45 s from the call.
import { expect, test } from 'vitest';
import { AC, CAP, MIB, SHORT, StandInHub, mb, request, startActions, tempHome } from './helpers.ts';

const WAIT_MS = 45_000;

test(`${AC.reply} with the hub's reply held open with no newline, deep-hook mcp actions gives up at the 16 MiB cap and tells its client the call failed`, async () => {
  const { dir, home } = tempHome();
  const hub = new StandInHub(home, CAP + 16 * MIB);
  await hub.listening();
  const server = startActions(home, dir);
  await server.write(request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-3503', version: '0' } }));
  const init = await server.waitFor((l) => l.id === 1, 60_000);
  if (!init?.result) throw Error(`BLOCKED: the server didn't answer initialize: ${server.shown()}`);
  await server.write(request(2, 'tools/call', { name: 'find_actions', arguments: { query: null } }));
  const answer = await server.waitFor((l) => l.id === 2, WAIT_MS);
  const writtenThen = hub.written;
  hub.close();
  await server.end();

  expect(hub.called, `setup: the server sent its call to the stand-in hub (${server.shown()})`).toBe(true);
  expect(answer, `the server tells its client within ${WAIT_MS / 1000} s that the call failed; the stand-in had sent ${mb(writtenThen)} of a reply with no newline by then; what it wrote once the stand-in then dropped the connection: ${server.shown()}`).toBeDefined();
  const failed = answer!.error !== undefined || answer!.result?.isError === true;
  expect(failed, `the answer to the call says it failed: ${JSON.stringify(answer).slice(0, 1500)}`).toBe(true);
  expect(writtenThen, `the server gave up at the cap, with ${mb(writtenThen)} of the reply sent, not before ${mb(CAP)}`).toBeGreaterThanOrEqual(CAP);
}, SHORT);
