// #908 AC2: a moved deadline is in the record, so rebuilding the record from its log gives the same one, and a hub
// started on the rebuilt record acts on it. Everything moves on the virtual clock (helpers.ts).

import { expect, test } from 'vitest';
import type { Event } from '../../../packages/record/src/index.ts';
import { AT_DEADLINE, SECOND, WAIT, clock, inWorld, type World } from './helpers.ts';
import { BACK, B_RAISED, GOES, SPAN } from './scenarios.ts';

// The first drafts of the night test (the AC1 ask's deadline in the record) and the Mac-asleep afternoon test were
// replaced by the blind redraft in ac2-redraft-2/ (README, Criteria to tests).

/** The core's records of a move of the ask's deadline: events about it, written by the core, whose data carries the span. */
const moves = async (w: World, handle: string): Promise<Event[]> =>
  (await w.about(handle)).filter((e) => e.writer === 'core' && typeof (e.data as { span?: unknown }).span === 'number');

for (const away of ['down'] as const) {
  test(`AC2 the hub ${away} from 16:01 to 00:30 while a 2-day ask waited for its batch moves its deadline by that span, recorded on the ask with the span, and the rebuilt record gives the same moved deadline`, async () => {
    await inWorld(B_RAISED, async (w) => {
      await w.start('S1', 'T1');
      const b = await w.raise('S1', 'choice', 'the storage');
      const raisedWith = await w.deadline(b);
      expect(clock(raisedWith), `ask ${b} is raised with the 2-day choice deadline setup drafts`).toBe(clock(B_RAISED + WAIT.choice));
      await w.awake(GOES);
      expect(await w.shownAt(b), `ask ${b}, whose deadline comes after the 00:00 batch, waits for it, so it hasn't shown at 16:01`).toBeUndefined();
      if (away === 'down') await w.down(BACK);
      else await w.asleep(BACK);
      const shown = await w.shownAt(b);
      expect(shown === undefined ? 'never' : clock(shown), `ask ${b} shows as the hub comes back at 00:30, the 00:00 batch having passed`).toBe(clock(BACK));
      const moved = await moves(w, b);
      expect(moved.length, `ask ${b}'s deadline move is recorded on the ask, once, with its span`).toBe(1);
      const span = (moved[0]!.data as { span: number }).span;
      // The hub's last beat was at 16:01:00; it may have gone at any time before the next, so the span is 8 h 29 min, give or take that one beat.
      expect(span, `ask ${b}'s deadline moves by the span the hub was ${away}, 16:01 to 00:30, give or take one beat`).toBeGreaterThanOrEqual(SPAN - SECOND);
      expect(span, `ask ${b}'s deadline moves by the span the hub was ${away}, 16:01 to 00:30, give or take one beat`).toBeLessThanOrEqual(SPAN);
      const deadline = raisedWith + span;
      expect(clock(await w.deadline(b)), `the record gives ask ${b} its deadline moved later by the span`).toBe(clock(deadline));
      // The hub stops at 00:30 and starts at 00:30:01 on the record rebuilt from its log.
      await w.down(BACK + SECOND, { rebuild: true });
      expect(clock(await w.deadline(b)), `rebuilt from the log, the record gives ask ${b} the same moved deadline`).toBe(clock(deadline));
      expect((await moves(w, b)).length, `ask ${b} had shown before this stop, so its deadline doesn't move again`).toBe(1);
      // Down again, ask b shown, until 30 s before its moved deadline; a hub on the rebuilt record defaults it there.
      await w.down(deadline - 30 * SECOND, { rebuild: true });
      await w.awake(deadline - SECOND);
      expect((await w.closing(b)).map((e) => e.kind), `on the rebuilt record, ask ${b} stays open until its moved deadline, ${clock(deadline)}`).toEqual([]);
      await w.awake(deadline);
      const closed = await w.closing(b);
      expect(closed.map((e) => e.kind), `on the rebuilt record, ask ${b} takes its default at its moved deadline`).toEqual(['ask.defaulted']);
      expect(clock(closed[0]!.ts), `on the rebuilt record, ask ${b} takes its default at its moved deadline`).toBe(clock(deadline));
      expect((closed[0]!.data as { answer: string }).answer, `ask ${b} takes the recommended option`).toBe(AT_DEADLINE.choice);
    });
  }, 120_000);
}
