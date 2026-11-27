// #2855 AC5: "A fake stdio server that refuses `initialize`, answers `server/discover` and takes `tools/list` only with
// a version in `_meta` is listed: `mcp.tools_listed` holds its two tools with their digests and says it took no
// handshake. After it adds `delete_repo`, a call to that tool waits for your approval as a handshake server's added tool
// does, and the fake server gets no request for it. On the merge base the lister reads no list and the call runs, and
// this test fails, naming the tool"
//
// Two fake servers in Claude Code's user config (fixtures/fake-server.mjs): `forge`, which takes no handshake, and
// `tracker`, a handshake server, the comparison "as a handshake server's added tool does". Both start with the same two
// tools. A first Claude Code session start makes the hub list them; both servers are then updated to add delete_repo,
// and a second session start lists them again. The agent calls delete_repo of each: its PreToolUse must not let it
// through, an ask naming the server and delete_repo must wait for you, and the fake server must get no tools/call for
// it. Where deep-hook lets a call through, the test runs it on the fake server as Claude Code would. Every failure line
// names the server, and those about the call name delete_repo.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, allEvents, claudeSession, cleanup, decision, FakeServer, lastPos, listedOf, listFailures, makeWorld, preToolUse, saysNoHandshake, sessionStart, shown, startHub, tool, typed, V1, within, type Ev, type Hub,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const V2 = [...V1, tool('delete_repo')];

/** The listings of each server once there are `n` of the comparison's; the one under test gets 5 s more. */
async function listings(hub: Hub, servers: FakeServer[], n: number): Promise<Map<string, Ev[]>> {
  const read = async () => { const events = await allEvents(hub); return new Map(servers.map((s) => [s.name, listedOf(events, s.name)])); };
  await within(45_000, async () => ((await read()).get('tracker')!.length >= n ? true : undefined));
  await within(5000, async () => ((await read()).get('forge')!.length >= n ? true : undefined));
  return read();
}

/** delete_repo called on `server`: a failure line naming it, or none when it waits for your approval and never reaches the server. */
async function heldCall(hub: Hub, s: Awaited<ReturnType<typeof claudeSession>>, server: FakeServer, since: number): Promise<string[]> {
  const before = server.calls('delete_repo');
  const call = preToolUse(s, server.name, 'delete_repo');
  const ask = await within(60_000, async () => {
    if (call.result && decision(call.result) === 'allow') return undefined;
    return (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.log_pos > since && String(e.data?.question ?? '').includes(server.name) && String(e.data?.question ?? '').includes('delete_repo'));
  }) ?? undefined;
  const failures: string[] = [];
  if (call.result && decision(call.result) === 'allow') {
    await server.runCall('delete_repo');
    failures.push(`${server.name}: the call to delete_repo ran with nothing held: deep-hook allowed mcp__${server.name}__delete_repo at PreToolUse (${shown(call.result)})`);
  } else if (!ask) failures.push(`${server.name}: no ask names delete_repo 60 s after its call, so the call to delete_repo doesn't wait for your approval`);
  else if (ask.data.kind !== 'authority') failures.push(`${server.name}: the ask holding delete_repo is ${String(ask.data.kind)}, not an authority ask`);
  const received = server.calls('delete_repo') - before;
  if (received) failures.push(`${server.name}: the fake server got ${received} tools/call request(s) for delete_repo`);
  return failures;
}

describe(`${AC.listsModern} the lister reads a server that takes no handshake`, () => {
  it(`${AC.listsModern} a server that refuses initialize and answers server/discover is listed with its two tools and their digests, saying it took no handshake; its added delete_repo waits for your approval as a handshake server's does and never reaches it`, async () => {
    const w = makeWorld();
    const forge = FakeServer.install(w, 'forge', 'modern');
    const tracker = FakeServer.install(w, 'tracker', 'minus32601');
    const hub = await startHub(w);
    const failures: string[] = [];

    const s1 = claudeSession(w);
    await sessionStart(s1);
    const first = await listings(hub, [forge, tracker], 1);
    for (const server of [forge, tracker]) failures.push(...listFailures(server.name, first.get(server.name)![0], V1));
    const forgeListed = first.get('forge')![0];
    if (forgeListed && !saysNoHandshake(forgeListed)) failures.push(`forge: mcp.tools_listed doesn't say it took no handshake: ${JSON.stringify({ ...forgeListed.data, tools: undefined })}`);

    forge.update(V2, '1.1.0');
    tracker.update(V2, '1.1.0');
    const since = await lastPos(hub);
    const s2 = claudeSession(w);
    await sessionStart(s2);
    await listings(hub, [forge, tracker], 2);
    await typed(s2, 'Clean up the archived repositories.');
    for (const server of [tracker, forge]) failures.push(...await heldCall(hub, s2, server, since));
    expect(failures, 'forge listed with no handshake, and delete_repo held as tracker\'s is').toEqual([]);
  }, 600_000);
});
