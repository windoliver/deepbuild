// #2855 AC3: "A request naming `2099-01-01` in its `_meta` is answered `-32022`, its `data` holding `supported` and
// `requested`, and the hub's count of calls from that process stays as it was. A planted server that serves it fails,
// naming the version"
//
// "The hub's count of calls from that process" is read as the tool calls that process sends to the hub's socket
// (README, Readings). A listener at the address the home's config.json names (for the reading tools, the reading job's
// socket they are started with) counts them. A fresh process of each server is sent, with no handshake, a tools/call of
// its first tool naming 2099-01-01 in `_meta`: the request that would reach the hub. Then the same process sends the
// same call naming 2026-07-28, which must reach the listener once, so the count is shown to count. Every failure line
// names the server and the version.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, answered, cleanup, countCalls, errorOf, FUTURE, handshakeSession, Mcp, MODERN, modern, serverHome, SERVERS, sleep, SUPPORTED, toolsOf } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC.unheldVersion} a version the server doesn't hold is answered -32022 and never reaches the hub`, () => {
  for (const server of SERVERS) {
    it(`${AC.unheldVersion} ${server.label}: a tools/call naming ${FUTURE} in its _meta is answered -32022 with data.supported and data.requested, and no call from that process reaches the ${server.reaches}`, async () => {
      const home = serverHome();
      const { mcp: shake } = await handshakeSession(server, home);
      const first = toolsOf(await shake.request('tools/list', {}))?.[0]?.name;
      shake.stop();
      const counter = await countCalls(server, home);
      const mcp = Mcp.start(server, home);
      const failures: string[] = [];
      if (first === undefined) failures.push(`${server.label}: lists no tool to call`);
      else {
        const before = counter.calls();
        const reply = await mcp.request('tools/call', modern({ name: first, arguments: {} }, FUTURE));
        await sleep(1500);
        const error = errorOf(reply);
        if (error?.code !== -32022) failures.push(`${server.label}: a tools/call naming ${FUTURE} is answered ${answered(reply)}, not -32022`);
        else {
          const data = (error.data ?? {}) as { supported?: unknown; requested?: unknown };
          if (!Array.isArray(data.supported) || JSON.stringify([...data.supported].sort()) !== JSON.stringify([...SUPPORTED].sort())) failures.push(`${server.label}: the -32022 for ${FUTURE} has data.supported ${JSON.stringify(data.supported)}, not the versions it holds ${JSON.stringify(SUPPORTED)}`);
          if (data.requested !== FUTURE) failures.push(`${server.label}: the -32022 for ${FUTURE} has data.requested ${JSON.stringify(data.requested)}, not ${FUTURE}`);
        }
        const after = counter.calls();
        if (after !== before) failures.push(`${server.label}: the tools/call naming ${FUTURE} reached the ${server.reaches}: its count of calls from the process went from ${before} to ${after} (${counter.lines().slice(-3).join(' | ')})`);
        // The same process, naming the revision it holds: the call reaches the listener once.
        await mcp.request('tools/call', modern({ name: first, arguments: {} }, MODERN));
        await sleep(500);
        if (counter.calls() !== after + 1) failures.push(`${server.label}: the count is not shown to count: a tools/call naming ${MODERN} took it from ${after} to ${counter.calls()}, not ${after + 1}`);
      }
      mcp.stop();
      expect(failures, `${server.label} answers ${FUTURE} without the ${server.reaches}`).toEqual([]);
    }, 120_000);
  }
});
