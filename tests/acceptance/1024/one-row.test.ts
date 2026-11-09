// #1024's two criteria on one replay (README): a Codex thread the record holds as its SessionStart's dashed ID and as
// the archive's dashless handle shows as one row, under the dashed ID, before a hub restart, after it and the
// transcript.archived it brings, and after the hooks that follow; and a listing with two rows for it fails, naming both.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup } from '../39/helpers.ts';
import { AC, hubStatusRows, replay, statusCount, twoRows, type Replayed } from './replay.ts';

let world: Replayed;
beforeAll(async () => { world = await replay(); }, 600_000);
afterAll(cleanup, 60_000);

describe('one Codex thread, one row, across a hub restart and transcript.archived', () => {
  it(`${AC[1]} the thread shows as one row under its SessionStart's dashed ID at every step`, () => {
    const { thread, handle } = world;
    for (const s of world.seen) {
      const fail = twoRows(s.rows, thread, `${s.step}, status.read`);
      expect(fail, fail).toBeUndefined();
      // deep status lists every session of the home, which holds only this thread.
      const n = statusCount(s.status);
      expect(n, `${s.step}, deep status: it lists ${n ?? 'no'} session${n === 1 ? '' : 's'} where the home has the one thread ${thread} (handle form ${handle}):\n${s.status}`).toBe(1);
      // deep hub status, where it names the thread at all, names it once and by the dashed ID.
      const named = hubStatusRows(s.hubStatus, thread);
      const listed = named.length ? twoRows(named, thread, `${s.step}, deep hub status`) : undefined;
      expect(listed, listed).toBeUndefined();
    }
  });

  it(`${AC[2]} a hub showing the thread as two rows, its dashed ID and the record's dashless handle, fails, naming both`, () => {
    const { thread, events } = world;
    // The dashless form as the record holds it: the handle on the archive's transcript.archived.
    const archived = events.find((e) => e.kind === 'transcript.archived' && typeof e.data?.session === 'string' && e.data.session.replace(/^session:/, '').replace(/-/g, '') === thread.replace(/-/g, ''));
    expect(archived, `BLOCKED: no transcript.archived for ${thread} in the record`).toBeDefined();
    const dashless = String(archived!.data.session).replace(/^session:/, '');
    expect(dashless, 'the record\'s handle is the thread\'s ID without its dashes').not.toBe(thread);
    const last = world.seen.at(-1)!;
    const row = last.rows.find((r) => r.id === thread) ?? { id: thread, repo: 'shop', agent: 'codex', state: 'finished', why: '' };
    // The listing the issue's run showed: the Codex row, and a second row under the dashless form.
    const two = [...last.rows, { ...row, id: dashless, agent: 'agent', state: 'quiet', why: 'last seen a while ago' }];
    const fail = twoRows(two, thread, 'the two-row listing');
    expect(fail, 'the two-row listing must fail').toBeDefined();
    expect(fail, fail).toContain(thread);
    expect(fail, fail).toContain(dashless);
    // And the same check, as AC1 runs it, on what this hub showed.
    for (const s of world.seen) {
      const own = twoRows(s.rows, thread, s.step);
      expect(own, own).toBeUndefined();
    }
  });
});
