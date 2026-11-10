// AC5 #1463.31fc1678: an agent's `deep_status` holds no other session's asks; a planted row leak fails, naming the session.
// #26's agent stand-in runs its hooks and its `deep mcp` as its children, so the hub binds that deep mcp to its session;
// the record holds an open ask of its own session and one of another session's, seeded before the hub starts.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { agentWorld, callTool, cleanup as cleanup26, valueOf } from '../26/helpers.ts';
import { cleanup, ID, leakFailures } from './helpers.ts';

afterAll(async () => { await cleanup(); await cleanup26(); }, 60_000);

const MINE = 'Which header colour on the login page?';
const THEIRS = 'Keep the changelog as a list or as prose?';
/** The agent's deep_status over a record holding its own open ask and another session's; that other session. */
async function statusWith(plant?: string): Promise<{ value: unknown; own: string; other: { session: string; handle: string; question: string } }> {
  const other = { session: randomUUID(), handle: '', question: THEIRS };
  const w = await agentWorld({
    ...(plant ? { plant } : {}),
    seeded: async (s, session, worktree) => {
      await s.start(session.id, worktree);
      await s.raise(session.id, 'taste', MINE);
      await s.start(other.session, '/work/docs');
      other.handle = await s.raise(other.session, 'choice', THEIRS);
    },
  });
  return { value: valueOf(await callTool(w.agent, 'deep_status', {}), 'deep_status'), own: w.session.id, other };
}

describe(ID.scope, () => {
  test(`${ID.scope}: an agent's deep_status holds no other session's asks`, async () => {
    const { value, own, other } = await statusWith();
    console.log(`deep_status for ${own}: ${JSON.stringify(value).slice(0, 1500)}`);
    expect(leakFailures(value, own, other), "the agent's deep_status").toEqual([]);
  }, 600_000);

  test(`${ID.scope}: a planted row leak fails, naming the session`, async () => {
    const { value, own, other } = await statusWith('status-row-leak');
    const failures = leakFailures(value, own, other);
    expect(failures.some((f) => f.includes(`holds session ${other.session}'s`)), `DEEP_HUB_PLANT=status-row-leak must fail naming session ${other.session}: ${JSON.stringify(failures)}`).toBe(true);
  }, 600_000);
});
