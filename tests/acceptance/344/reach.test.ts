// A rule's reach before it is saved (#344): the sessions and tool calls its scope would have matched in the last 30 days
// of the record, each by handle, newest first, read from the record alone. README: Invented surfaces, `deep rules reach`.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupAll, deep, fixtureWorld, json, seedSessions, settle, startHub, stopHub, type Line } from './helpers.ts';

afterAll(cleanupAll, 120_000);

describe('#344 the preview before a rule is rescoped', () => {
  it('AC10 #344.ba9f0acc rescoping a rule from packages/dev/** to packages/dev/render/** shows, before save, 12 of the month\'s 40 sessions matched the old scope and 3 match the new one, each by handle', async () => {
    const w = fixtureWorld();
    // 40 sessions in the last 30 days: 3 read packages/dev/render twice, 9 read packages/dev/src, 28 only web/app.ts.
    const sessions = Array.from({ length: 40 }, (_, i) => ({
      daysAgo: 1 + i * 0.6,
      reads: i < 3 ? ['packages/dev/render/r.ts', 'packages/dev/render/r.ts'] : i < 12 ? ['packages/dev/src/a.ts'] : ['web/app.ts'],
    }));
    const ids = await seedSessions(w, sessions);
    const hub = await startHub(w);
    try {
      const before = await settle(hub, () => true, 0);
      const reach = async (scope: string): Promise<Line> => {
        const r = await deep(w, ['rules', 'reach', '--repo', w.repo, '--scope', scope, '--json']);
        return json(r, `deep rules reach --scope ${scope}`);
      };
      const old = await reach('packages/dev/**');
      const oldIds = (old.sessions as { handle: string; tool_calls: number }[] | undefined) ?? [];
      expect(oldIds.length, `the old scope matched 12 of the month's sessions (a preview that counts every session in the repo shows 40; this one shows ${oldIds.length})`).toBe(12);
      expect(oldIds.map((s) => s.handle), 'each by handle, newest first').toEqual(ids.slice(0, 12).map((id) => `session:${id}`));
      expect(old.tool_calls, 'and 15 tool calls').toBe(15);
      const next = await reach('packages/dev/render/**');
      const nextIds = (next.sessions as { handle: string; tool_calls: number }[] | undefined) ?? [];
      expect(nextIds.length, `the new scope matches 3 (the preview shows ${nextIds.length})`).toBe(3);
      expect(nextIds.map((s) => s.handle), 'each by handle, newest first').toEqual(ids.slice(0, 3).map((id) => `session:${id}`));
      expect(next.tool_calls, 'and 6 tool calls').toBe(6);
      const after = await settle(hub, () => true, 0);
      expect(after.length, 'the preview reads the record alone: it appended nothing').toBe(before.length);
      expect(after.filter((e) => /^(job|run)\./.test(e.kind)).map((e) => e.kind), 'and started no job').toEqual([]);
    } finally {
      await stopHub(hub);
    }
  }, 240_000);
});
