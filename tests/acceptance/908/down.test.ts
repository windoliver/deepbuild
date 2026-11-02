// #908 AC3: only an ask that hadn't shown has its deadline moved by the hub being down; one that showed before the
// hub went down keeps its deadline, and every ask ends. Everything moves on the virtual clock (helpers.ts).

import { expect, test } from 'vitest';
import type { AskKind } from '../../../packages/asks/src/index.ts';
import { SECOND, WAIT, clock, inWorld } from './helpers.ts';
import { A_RAISED, BACK, BATCH, B_RAISED, GOES } from './scenarios.ts';

test('AC3 an ask that showed before the hub went down keeps its deadline, and every ask in the fixture ends', async () => {
  await inWorld(A_RAISED, async (w) => {
    const kinds = new Map<string, AskKind>();
    await w.start('S1', 'T1');
    const a = await w.raise('S1', 'definition', 'the offline mode');
    kinds.set(a, 'definition');
    await w.awake(BATCH);
    const aShown = await w.shownAt(a);
    expect(aShown === undefined ? 'never' : clock(aShown), `ask ${a} shows in the 16:00 batch`).toBe(clock(BATCH));
    await w.awake(B_RAISED);
    await w.start('S2', 'T2');
    const b = await w.raise('S2', 'choice', 'the storage');
    kinds.set(b, 'choice');
    await w.awake(GOES);
    expect(await w.shownAt(b), `ask ${b}, whose deadline comes after the 00:00 batch, waits for it`).toBeUndefined();

    // Down from 16:01 to 00:30: ask a had shown, so its 19:59 deadline stays, and it passed while the hub was down.
    const aDeadline = await w.deadline(a);
    expect(clock(aDeadline), `ask ${a} is raised with the 4 h definition deadline setup drafts`).toBe(clock(A_RAISED + WAIT.definition));
    await w.down(BACK);
    expect(clock(await w.deadline(a)), `ask ${a} showed at 16:00, before the hub went down, so it keeps its deadline`).toBe(clock(aDeadline));
    await w.awake(BACK + SECOND);
    const aClosed = await w.closing(a);
    expect(aClosed.map((e) => e.kind), `ask ${a} keeps its deadline, which passed while the hub was down, so it takes its default as the hub starts`).toEqual(['ask.defaulted']);
    expect(aClosed[0]!.ts, `ask ${a} takes its default within the hub's first beat after it starts at 00:30`).toBeLessThanOrEqual(BACK + SECOND);

    // Ask b showed as the hub came back. Down again, from 00:30:01 to 30 s before its deadline: it keeps that deadline.
    const bShown = await w.shownAt(b);
    expect(bShown === undefined ? 'never' : clock(bShown), `ask ${b} shows as the hub comes back at 00:30`).toBe(clock(BACK));
    const bDeadline = await w.deadline(b);
    await w.down(bDeadline - 30 * SECOND);
    expect(clock(await w.deadline(b)), `ask ${b} showed at 00:30, before the hub went down again, so it keeps its deadline`).toBe(clock(bDeadline));
    await w.awake(bDeadline - SECOND);
    expect((await w.closing(b)).map((e) => e.kind), `ask ${b} keeps its deadline, ${clock(bDeadline)}: it stays open until then`).toEqual([]);
    await w.awake(bDeadline);
    const bClosed = await w.closing(b);
    expect(bClosed.map((e) => e.kind), `ask ${b} takes its default at the deadline it kept`).toEqual(['ask.defaulted']);
    expect(clock(bClosed[0]!.ts), `ask ${b} takes its default at the deadline it kept`).toBe(clock(bDeadline));

    // Every ask in the fixture ends, once, after it showed, and no deadline is past its kind's wait counted again from its first showing.
    const raised = (await w.events('ask.created')).map((e) => `ask:${e.id}`);
    expect(raised.sort(), 'the fixture raised these two asks and no other').toEqual([a, b].sort());
    for (const h of raised) {
      const closed = await w.closing(h);
      expect(closed.length, `ask ${h} ends, once`).toBe(1);
      const shown = (await w.shownAt(h))!;
      expect(closed[0]!.ts, `ask ${h} ends no sooner than it showed`).toBeGreaterThanOrEqual(shown);
      const kind = kinds.get(h)!;
      const deadline = await w.deadline(h);
      expect(deadline, `ask ${h}'s deadline, ${clock(deadline)}, is no later than its ${kind} wait counted again from its first showing at ${clock(shown)}: ${clock(shown + WAIT[kind])}`).toBeLessThanOrEqual(shown + WAIT[kind]);
    }
  });
}, 120_000);
