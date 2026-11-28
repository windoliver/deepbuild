import { afterEach, describe, expect, it } from 'vitest';
import { allEvents, claudeSession, cleanup, FakeServer, listedOf, listFailures, makeWorld, sessionStart, startHub, V1, within } from './helpers.ts';

afterEach(cleanup, 60_000);

const LIST_MS = 10_000;

describe(`#2855.61e68686 the lister still reads a handshake server after its probe`, () => {
  it(`#2855.61e68686 a handshake server that answers server/discover with -32601, and one that never answers it, are each probed, then listed by tool and digest, the silent one within 10 s`, async () => {
    const w = makeWorld();
    const refuser = FakeServer.install(w, 'refuser', 'minus32601');
    const mute = FakeServer.install(w, 'mute', 'silent');
    const hub = await startHub(w);
    const s = claudeSession(w);
    await sessionStart(s);
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
