// #321 AC4: a server you added to Claude Code yourself, never synced by DeepBuild, whose tool list at the next session
// start adds `delete_repo`, has that tool held at PreToolUse the same way as a synced server's. `tracker` is a fake
// MCP server at local scope (`~/.claude.json`'s projects[<repo>].mcpServers, where `claude mcp add` writes one by
// default); `forge` beside it is in the user-scope config, where DeepBuild's sync writes the servers it syncs, and is
// the control. Both are updated to add delete_repo between two session starts. A guard that holds only synced
// servers' tools (DEEP_HUB_PLANT=holds-synced-only) holds forge's but lets tracker's run, and fails this test naming
// the server.
import { afterEach, describe, it } from 'vitest';
import {
  AC4, FakeServer, approve, cleanup, expectFree, expectHeld, expectRuns, failureOf, lastPos, makeWorld, mcpCall, must,
  newSession, startHub, startRecorded, stillHeld, stopHub, tool, typed, verdict,
} from './helpers.ts';

afterEach(cleanup, 60_000);

async function scenario(plant?: string): Promise<void> {
  const who = `AC4 ${AC4}`;
  const synced = `${who} [forge, synced at user scope]`;
  const yours = `${who} [tracker, added by you at local scope, never synced]`;
  const w = makeWorld();
  const forgeV1 = [tool('list_issues', { readOnlyHint: true }), tool('create_issue')];
  const trackerV1 = [tool('list_tickets', { readOnlyHint: true }), tool('create_ticket')];
  const forge = FakeServer.install(w, 'forge', 'user', forgeV1);
  const tracker = FakeServer.install(w, 'tracker', 'local', trackerV1);
  const hub = await startHub(w, { plant });
  try {
    const s1 = newSession(w);
    await startRecorded(w, hub, s1, [forge, tracker], who);
    await typed(w, s1, 'List the open tickets.');
    await expectFree(w, hub, s1, mcpCall(tracker, 'list_tickets'), { who: yours, names: ['tracker', 'list_tickets'], server: tracker });

    forge.update([...forgeV1, tool('delete_repo')], '1.1.0');
    tracker.update([...trackerV1, tool('delete_repo')], '2.0.0');
    const since = await lastPos(hub);
    const s2 = newSession(w);
    await startRecorded(w, hub, s2, [forge, tracker], who);
    await typed(w, s2, 'Remove the scratch repositories.');
    const heldSynced = await expectHeld(w, hub, s2, mcpCall(forge, 'delete_repo'), { who: synced, names: ['forge', 'delete_repo'], since, server: forge });
    const heldYours = await expectHeld(w, hub, s2, mcpCall(tracker, 'delete_repo'), { who: yours, names: ['tracker', 'delete_repo'], since, server: tracker });
    await stillHeld(hub, heldYours, 5000);
    await expectFree(w, hub, s2, mcpCall(tracker, 'list_tickets'), { who: yours, names: ['tracker', 'list_tickets'], server: tracker });
    await expectRuns(w, hub, heldYours, await approve(w, hub, heldYours));
    await expectRuns(w, hub, heldSynced, await approve(w, hub, heldSynced));
  } finally {
    await stopHub(hub);
  }
}

describe(`AC4 ${AC4} a server you added yourself, never synced, has a new delete_repo held the same way`, () => {
  it('AC4 tracker (yours, local scope) and forge (synced, user scope) each add delete_repo at the next session start: both held until your yes, tracker\'s read tool still runs', async (ctx) => {
    await verdict(ctx, () => scenario());
  }, 900_000);

  it('AC4 (wrong program) a guard that holds only synced servers\' tools (DEEP_HUB_PLANT=holds-synced-only) lets tracker\'s delete_repo run and fails this test, naming the server', async (ctx) => {
    await verdict(ctx, async () => {
      const why = await failureOf(() => scenario('holds-synced-only'));
      must(why !== null, `${AC4} the planted guard holds-synced-only must fail this test; it passed`);
      must(why.includes('fake server tracker'), `${AC4} the planted guard must fail this test naming the server tracker; it failed with: ${why}`);
    });
  }, 900_000);
});
