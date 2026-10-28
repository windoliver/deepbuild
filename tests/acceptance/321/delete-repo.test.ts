// #321 AC2: a server update that adds `delete_repo` holds that tool at PreToolUse until you approve it once, and the
// server's read-only tools keep working. `forge` is a fake MCP server (fixtures/mcp-server.mjs) in Claude Code's
// user-scope config, where DeepBuild's sync writes the servers it syncs. A first session records its tool list; the
// server is updated to add delete_repo; the next session start records the new list. delete_repo, called twice, is
// held by the update's one authority ask and never reaches the server, while list_issues and get_issue run. After
// your yes it runs, again with no ask, and in a later session too. The issue names no wrong program for this
// criterion: the base, which holds nothing, is its wrong program (BASE-FAILURE.txt).
import { afterEach, describe, it } from 'vitest';
import {
  AC2, FakeServer, againHeld, approve, cleanup, expectFree, expectHeld, expectRuns, lastPos, makeWorld, mcpCall,
  newSession, startHub, startRecorded, stillHeld, stopHub, tool, typed, verdict,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const V1 = [tool('list_issues', { readOnlyHint: true }), tool('get_issue', { readOnlyHint: true }), tool('create_issue')];

describe(`AC2 ${AC2} a server update that adds delete_repo holds it until you approve it once; read-only tools keep working`, () => {
  it('AC2 forge updated to add delete_repo: delete_repo held by one ask and never sent to the server until your yes, then runs with no ask in this session and the next; list_issues and get_issue run throughout', async (ctx) => {
    await verdict(ctx, async () => {
      const who = `AC2 ${AC2} [forge]`;
      const w = makeWorld();
      const forge = FakeServer.install(w, 'forge', 'user', V1);
      const hub = await startHub(w);
      try {
        const s1 = newSession(w);
        await startRecorded(w, hub, s1, [forge], who);
        await typed(w, s1, 'List the open issues.');
        await expectFree(w, hub, s1, mcpCall(forge, 'list_issues'), { who, names: ['forge', 'list_issues'], server: forge });

        forge.update([...V1, tool('delete_repo')], '1.1.0');
        const since = await lastPos(hub);
        const s2 = newSession(w);
        await startRecorded(w, hub, s2, [forge], who);
        await typed(w, s2, 'Clean up the archived repositories.');
        const held = await expectHeld(w, hub, s2, mcpCall(forge, 'delete_repo'), { who, names: ['forge', 'delete_repo'], since, server: forge });
        await againHeld(w, hub, held, since);
        await expectFree(w, hub, s2, mcpCall(forge, 'list_issues'), { who, names: ['forge', 'list_issues'], server: forge });
        await expectFree(w, hub, s2, mcpCall(forge, 'get_issue'), { who, names: ['forge', 'get_issue'], server: forge });
        await stillHeld(hub, held, 3000);
        await expectRuns(w, hub, held, await approve(w, hub, held));
        // Approved once: it runs from now on, in this session and the next, with no ask.
        await expectFree(w, hub, s2, mcpCall(forge, 'delete_repo'), { who, names: ['forge', 'delete_repo'], server: forge });
        const s3 = newSession(w);
        await startRecorded(w, hub, s3, [forge], who);
        await typed(w, s3, 'Delete the old sandbox repository.');
        await expectFree(w, hub, s3, mcpCall(forge, 'delete_repo'), { who, names: ['forge', 'delete_repo'], server: forge });
      } finally {
        await stopHub(hub);
      }
    });
  }, 900_000);
});
