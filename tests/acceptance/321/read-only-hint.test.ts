// #321 AC3: a server update adds `post_update` with `readOnlyHint: true` and no facts entry. The hint is the server's
// own claim and never lowers a class, so post_update counts as change: its first call is held at PreToolUse with the
// update's one ask, and the fake server receives no tools/call for it until you answer; your yes then lets it run.
// `forge` is the fake server in Claude Code's user-scope config (adapters/mcp-servers.facts.json lists no such
// server). A classifier that trusts the hint (DEEP_HUB_PLANT=trusts-hints, #304's plant, which must reach the tool
// lists the record now holds) lets the call run and fails this test on the fake server's request count.
import { afterEach, describe, it } from 'vitest';
import {
  AC3, FakeServer, approve, cleanup, expectFree, expectHeld, expectRuns, failureOf, lastPos, makeWorld, mcpCall, must,
  newSession, startHub, startRecorded, stillHeld, stopHub, tool, typed, verdict,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const V1 = [tool('list_issues', { readOnlyHint: true }), tool('get_issue', { readOnlyHint: true })];

async function scenario(plant?: string): Promise<void> {
  const who = `AC3 ${AC3} [forge]`;
  const w = makeWorld();
  const forge = FakeServer.install(w, 'forge', 'user', V1);
  const hub = await startHub(w, { plant });
  try {
    const s1 = newSession(w);
    await startRecorded(w, hub, s1, [forge], who);
    await typed(w, s1, 'List the open issues.');
    await expectFree(w, hub, s1, mcpCall(forge, 'list_issues'), { who, names: ['forge', 'list_issues'], server: forge });

    forge.update([...V1, tool('post_update', { readOnlyHint: true })], '1.1.0');
    const since = await lastPos(hub);
    const s2 = newSession(w);
    await startRecorded(w, hub, s2, [forge], who);
    await typed(w, s2, 'Post the release notes as an update.');
    const held = await expectHeld(w, hub, s2, mcpCall(forge, 'post_update'), { who, names: ['forge', 'post_update'], since, server: forge });
    await stillHeld(hub, held, 5000);
    must(forge.calls('post_update') === 0, `${who} the fake server forge must receive no tools/call request for post_update until you answer; it received ${forge.calls('post_update')}`);
    await expectFree(w, hub, s2, mcpCall(forge, 'list_issues'), { who, names: ['forge', 'list_issues'], server: forge });
    await expectRuns(w, hub, held, await approve(w, hub, held));
  } finally {
    await stopHub(hub);
  }
}

describe(`AC3 ${AC3} a new tool's readOnlyHint never lowers its class: post_update counts as change and waits for your answer`, () => {
  it('AC3 forge updated to add post_update (readOnlyHint: true, no facts entry): its first call is held with the update\'s one authority ask and the fake server receives no request until your yes', async (ctx) => {
    await verdict(ctx, () => scenario());
  }, 900_000);

  it('AC3 (wrong program) a classifier that trusts the hint (DEEP_HUB_PLANT=trusts-hints) lets the call run and fails this test on the fake server\'s request count', async (ctx) => {
    await verdict(ctx, async () => {
      const why = await failureOf(() => scenario('trusts-hints'));
      must(why !== null, `${AC3} the planted classifier trusts-hints must fail this test; it passed`);
      must(/fake server forge received [1-9]\d* tools\/call request\(s\) for post_update/.test(why), `${AC3} the planted classifier must fail this test on the fake server's request count for post_update; it failed with: ${why}`);
    });
  }, 900_000);
});
