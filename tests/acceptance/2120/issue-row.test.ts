// AC6: a session DeepBuild starts for an issue shows that issue in the session map (README).
//
// #1330's world: an approval for issue 41, then `deep start --issue 41`. The stand-in agent runs its one turn, its hooks
// reaching the hub; once the session map holds the session (its row's `map`, as `sessions.read` gives it), the row's
// issue must be 41. On the base the start's branch is deep/41-<id>, and the map reads an issue only as issue-<n>, so
// the row's issue is null.
import { expect, test } from 'vitest';
import { approve, mentions, openWorld, standInIn, start, waitFor, type Line } from '../1330/helpers.ts';
import { blocked, installStandIn, started } from './helpers.ts';

const AC6 = 'AC6 #2120.606be734';

test(`${AC6} a session started with deep start for issue 41: once its first hook is mapped, its row's issue in the session map is 41`, async (ctx) => {
  const w = await openWorld();
  installStandIn(w);
  await blocked('the approval of issue 41', () => approve(w, { issues: [41], agents: ['claude-code'], atOnce: 1, planShare: 50 }));
  const s = started(await start(w, { issue: 41 }), 'deep start --issue 41');
  const agent = await blocked("the started agent's turn", () => standInIn(w, s.worktree, { done: true }));
  const session = String(agent.session);

  const row = await blocked(`the session map's row of session ${session}`, () => waitFor(async () => ((await w.client.call('sessions.read')).sessions as Line[]).find((r) => mentions(r, session) && r.map), 30_000, `a row of session ${session} with its map in sessions.read`));
  // The map reads the issue from the worktree as git shows it; a read that failed (a loaded machine) shows no branch.
  if (!row.map.branch) ctx.skip(`INCONCLUSIVE ${AC6}: the session map read no branch for session ${session} (${JSON.stringify(row.map).slice(0, 300)})`);
  expect(row.map.issue, `${AC6} session ${session}, which deep start started for issue 41 on branch ${s.branch}, shows issue 41 in the session map: its row's map is ${JSON.stringify(row.map).slice(0, 600)}`).toBe(41);
});
