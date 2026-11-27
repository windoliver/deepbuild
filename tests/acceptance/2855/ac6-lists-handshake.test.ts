// #2855 AC6: "A fake handshake server that answers `server/discover` with `-32601` is listed as on the merge base, by
// tool and digest. One that never answers the probe is listed too, within 10 s. A planted lister that waits its whole
// limit on the probe lists nothing and fails, naming the server. One that takes `-32601` as the end lists nothing and
// fails the same way"
//
// Two fake handshake servers in Claude Code's user config (fixtures/fake-server.mjs), each logging every request with
// its time: `refuser` answers server/discover with -32601, `mute` never answers it. One Claude Code session start
// makes the hub list them. From each server's log, the lister's process (the only one that starts them here) must open
// with the server/discover probe, as Scope says the lister opens, then send initialize; `mcp.tools_listed` must hold
// the server's two tools with the digests the hub gives a handshake server's schemas; and `mute`'s listing, from the
// probe to its last tools/list, must take at most 10 s. Every failure line names the server.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, allEvents, claudeSession, cleanup, FakeServer, listedOf, listFailures, makeWorld, sessionStart, startHub, V1, within } from './helpers.ts';

afterEach(cleanup, 60_000);

const LIST_MS = 10_000;

describe(`${AC.listsHandshake} the lister still reads a handshake server after its probe`, () => {
  it(`${AC.listsHandshake} a handshake server that answers server/discover with -32601, and one that never answers it, are each probed, then listed by tool and digest, the silent one within 10 s`, async () => {
    const w = makeWorld();
    const refuser = FakeServer.install(w, 'refuser', 'minus32601');
    const mute = FakeServer.install(w, 'mute', 'silent');
    const hub = await startHub(w);
    const s = claudeSession(w);
    await sessionStart(s);
    // The listing ends within 10 s of the start; 30 s leaves room for the hub's own work under load.
    const events = await within(30_000, async () => {
      const all = await allEvents(hub);
      return listedOf(all, 'refuser').length && listedOf(all, 'mute').length ? all : undefined;
    }) ?? await allEvents(hub);
    const failures: string[] = [];
    for (const server of [refuser, mute]) {
      const lister = server.byProcess()[0] ?? [];
      const methods = lister.map((r) => String(r.method));
      if (methods[0] !== 'server/discover') failures.push(`${server.name}: the lister's first request is ${JSON.stringify(methods[0] ?? null)}, not the server/discover probe (its requests: ${methods.join(', ')})`);
      else if (!methods.includes('initialize')) failures.push(`${server.name}: after the probe the lister sent no initialize (its requests: ${methods.join(', ')})`);
      failures.push(...listFailures(server.name, listedOf(events, server.name)[0], V1));
      if (server === mute && lister.length) {
        const lists = lister.filter((r) => r.method === 'tools/list');
        const took = lists.length ? Number(lists.at(-1)!.at) - Number(lister[0]!.at) : undefined;
        if (took === undefined || took > LIST_MS) failures.push(`${server.name}: its listing ${took === undefined ? 'never reached tools/list' : `took ${took} ms from the first request to the last tools/list`}, not within ${LIST_MS / 1000} s`);
      }
    }
    expect(failures, 'the handshake servers probed and listed').toEqual([]);
  }, 300_000);
});
