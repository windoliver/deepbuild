import { afterEach, describe, expect, it } from 'vitest';
import {
  answered, CACHE_SCOPE, cleanup, errorOf, handshakeSession, Mcp, MISSING_PAGE, modern, resultOf, serverHome, SERVERS, toolsOf, TTL_MS, type Obj,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`#2855.2b6ba6a3 a client with no handshake is served`, () => {
  for (const server of SERVERS) {
    it(`#2855.2b6ba6a3 ${server.label}: with no initialize and 2026-07-28 in each request's _meta, tools/list is a handshake session's tools in its order with resultType "complete", ttlMs ${TTL_MS} and cacheScope "${CACHE_SCOPE}"; a tool call's result has resultType "complete"; ping is -32601; resources/read of a missing page is -32602 where a handshake session gets -32002`, async () => {
      const home = serverHome();
      const { mcp: shake, init } = await handshakeSession(server, home);
      const caps = (resultOf(init)?.capabilities ?? {}) as Obj;
      const shakeList = await shake.request('tools/list', {});
      const shakeTools = toolsOf(shakeList) ?? [];
      const first = shakeTools[0]?.name;
      const shakeCall = first === undefined ? undefined : await shake.request('tools/call', { name: first, arguments: {} });
      const hasResources = 'resources' in caps;
      const shakeRead = hasResources ? await shake.request('resources/read', { uri: MISSING_PAGE }) : undefined;
      shake.stop();

      const mcp = Mcp.start(server, home);
      const failures: string[] = [];
      const complete = (method: string, reply: Obj | undefined): Obj | undefined => {
        const result = resultOf(reply);
        if (!result) { failures.push(`${server.label}: ${method} is answered ${answered(reply)}, not a result`); return undefined; }
        if (result.resultType !== 'complete') failures.push(`${server.label}: ${method}'s result has resultType ${JSON.stringify(result.resultType)}, not "complete"`);
        return result;
      };

      const list = complete('tools/list', await mcp.request('tools/list', modern()));
      if (list) {
        if (list.ttlMs !== TTL_MS) failures.push(`${server.label}: tools/list's result has ttlMs ${JSON.stringify(list.ttlMs)}, not ${TTL_MS}`);
        if (list.cacheScope !== CACHE_SCOPE) failures.push(`${server.label}: tools/list's result has cacheScope ${JSON.stringify(list.cacheScope)}, not "${CACHE_SCOPE}"`);
        const tools = Array.isArray(list.tools) ? list.tools : [];
        if (!shakeTools.length) failures.push(`${server.label}: its handshake session lists no tools to compare with`);
        if (JSON.stringify(tools) !== JSON.stringify(shakeTools)) failures.push(`${server.label}: tools/list names ${JSON.stringify(tools.map((t) => (t as Obj).name))}, not the handshake session's tools ${JSON.stringify(shakeTools.map((t) => t.name))} as they are, in their order`);
      }
      if (first !== undefined) {
        const call = complete(`tools/call of ${first}`, await mcp.request('tools/call', modern({ name: first, arguments: {} })));
        if (call) {
          const { resultType: _type, ...rest } = call;
          if (JSON.stringify(rest) !== JSON.stringify(resultOf(shakeCall))) failures.push(`${server.label}: tools/call of ${first} is answered ${JSON.stringify(rest).slice(0, 300)}, not the handshake session's result ${JSON.stringify(resultOf(shakeCall)).slice(0, 300)}`);
        }
      }
      const ping = await mcp.request('ping', modern());
      if (errorOf(ping)?.code !== -32601) failures.push(`${server.label}: ping is answered ${answered(ping)}, not -32601`);
      if (hasResources) {
        if (errorOf(shakeRead)?.code !== -32002) failures.push(`${server.label}: in a handshake session resources/read of ${MISSING_PAGE} is answered ${answered(shakeRead)}, not -32002`);
        const read = await mcp.request('resources/read', modern({ uri: MISSING_PAGE }));
        if (errorOf(read)?.code !== -32602) failures.push(`${server.label}: resources/read of ${MISSING_PAGE} is answered ${answered(read)}, not -32602`);
      }
      mcp.stop();
      expect(failures, `${server.label} served with no handshake`).toEqual([]);
    }, 120_000);
  }
});
