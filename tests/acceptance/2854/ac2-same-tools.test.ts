// #2854 AC2: "After a handshake at each held revision, `tools/list` returns the same tools in the same order, and one
// call to a tool of each server is answered as it is at `2025-06-18`"
//
// "A handshake at a held revision" is one the server answers with that revision because it holds it. A server that
// sends back whatever it is sent holds no revision, so each test first shows the server holds a list: initialize
// naming 1900-01-01 is answered 2025-11-25, not sent back (README: Readings). Then, per held revision, a fresh session
// of the server in one home: initialize naming it is answered with it; tools/list is the 2025-06-18 session's, tool for
// tool and byte for byte, in its order; and a call to its first listed tool, with no arguments, is answered as the
// 2025-06-18 session's call is. No hub is reachable from the home, so deep mcp's and both deep-actions' calls are
// answered that the hub is unreachable, and the reading tools' that the job's socket can't be reached.
import { describe, expect, it } from 'vitest';
import { AC, HELD, holdsAList, scratch, SERVERS, session } from './helpers.ts';

describe(`${AC.sameTools} the same tools at each held revision`, () => {
  for (const server of SERVERS) {
    it(`${AC.sameTools} ${server.label}: after a handshake at each held revision tools/list returns the 2025-06-18 tools in the same order, and a call to its first tool is answered as at 2025-06-18`, async () => {
      const home = scratch();
      const held = await holdsAList(server, home);
      expect(held, `${server.label} holds a list of handshake revisions`).toBeUndefined();
      const sessions = new Map<string, Awaited<ReturnType<typeof session>>>();
      for (const revision of HELD) sessions.set(revision, await session(server, revision, home));
      const base = sessions.get('2025-06-18')!;
      expect(base.tools?.length, `${server.label} lists tools at 2025-06-18`).toBeGreaterThan(0);
      const failures: string[] = [];
      for (const revision of HELD) {
        const s = sessions.get(revision)!;
        if (s.answered !== revision) failures.push(`${server.label}: the handshake naming ${revision} is answered ${JSON.stringify(s.answered)}`);
        const names = (s.tools ?? []).map((t) => t.name);
        const baseNames = base.tools!.map((t) => t.name);
        if (JSON.stringify(names) !== JSON.stringify(baseNames)) failures.push(`${server.label} at ${revision}: tools/list names ${JSON.stringify(names)}, not 2025-06-18's ${JSON.stringify(baseNames)}`);
        else for (const [i, tool] of (s.tools ?? []).entries()) if (JSON.stringify(tool) !== JSON.stringify(base.tools![i])) failures.push(`${server.label} at ${revision}: tool ${tool.name} differs from 2025-06-18's`);
        if (JSON.stringify(s.call?.result ?? s.call?.error) !== JSON.stringify(base.call?.result ?? base.call?.error)) failures.push(`${server.label} at ${revision}: the call to ${s.callOf} is answered ${JSON.stringify(s.call).slice(0, 400)}, not as at 2025-06-18: ${JSON.stringify(base.call).slice(0, 400)}`);
      }
      expect(failures, `${server.label}'s sessions at ${HELD.join(' and ')}`).toEqual([]);
    }, 300_000);
  }
});
