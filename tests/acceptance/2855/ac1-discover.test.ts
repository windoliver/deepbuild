import { afterEach, describe, expect, it } from 'vitest';
import { answered, cleanup, errorOf, handshakeSession, HELD, Mcp, META, MODERN, modern, resultOf, serverHome, SERVERS, SUPPORTED, type Obj } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`#2855.a98dc587 each server answers server/discover`, () => {
  for (const server of SERVERS) {
    it(`#2855.a98dc587 ${server.label} answers server/discover with supportedVersions ${MODERN} first and each held handshake revision after it, capabilities naming tools (and resources where it has them), and its name and version under ${META.serverInfo}`, async () => {
      const home = serverHome();
      const { mcp: shake, init } = await handshakeSession(server, home);
      shake.stop();
      const caps = (resultOf(init)?.capabilities ?? {}) as Obj;
      const info = (resultOf(init)?.serverInfo ?? {}) as Obj;
      const mcp = Mcp.start(server, home);
      const reply = await mcp.request('server/discover', modern());
      mcp.stop();
      const failures: string[] = [];
      const result = resultOf(reply);
      if (!result || errorOf(reply)) failures.push(`${server.label}: server/discover is answered ${answered(reply)}, not a discover result`);
      else {
        const versions = result.supportedVersions;
        if (!Array.isArray(versions) || versions[0] !== MODERN || JSON.stringify([...versions.slice(1)].sort()) !== JSON.stringify([...HELD].sort()) || versions.length !== SUPPORTED.length) {
          failures.push(`${server.label}: supportedVersions is ${JSON.stringify(versions)}, not ${MODERN} first and then the held revisions ${HELD.join(', ')}`);
        }
        const offered = (result.capabilities && typeof result.capabilities === 'object' ? result.capabilities : undefined) as Obj | undefined;
        if (!offered || typeof offered.tools !== 'object' || offered.tools === null) failures.push(`${server.label}: capabilities ${JSON.stringify(result.capabilities)} names no tools`);
        if ('resources' in caps && (!offered || typeof offered.resources !== 'object' || offered.resources === null)) failures.push(`${server.label}: it has resources (its handshake says ${JSON.stringify(caps)}), yet discover's capabilities ${JSON.stringify(result.capabilities)} name none`);
        const named = ((result._meta ?? {}) as Obj)[META.serverInfo] as Obj | undefined;
        if (!named || named.name !== info.name || named.version !== info.version) failures.push(`${server.label}: _meta["${META.serverInfo}"] is ${JSON.stringify(named)}, not its name and version ${JSON.stringify({ name: info.name, version: info.version })}`);
      }
      expect(failures, `${server.label}'s answer to server/discover`).toEqual([]);
    }, 120_000);
  }
});
