// #908 AC1: an ask that first shows when the Mac wakes, past the deadline it was raised with, takes its default
// no sooner than the minimum notice after it shows. Everything moves on the virtual clock (helpers.ts).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { duration } from '../../../packages/asks/src/index.ts';
import { AT_DEADLINE, KINDS, NOTICE, SECOND, at, card, clock, inWorld } from './helpers.ts';
import { DEFAULTS, RAISED, night, stillOpen } from './scenarios.ts';

test('AC1 an ask raised at 23:00 with a 4 h deadline, the hub asleep from 23:30 to 08:00, shows at 08:00, has not defaulted at 08:00:01, and defaults at 09:00 unless answered', async () => {
  await inWorld(RAISED, async (w) => {
    const [x, y] = await night(w, [['S1', 'the offline mode'], ['S2', 'the export format']]) as [string, string];
    // 08:00:01 is the next tick: a hub that defaults there fails here, naming ask x.
    await w.awake(at(1, 8, 30), stillOpen(w, x));
    // The other ask is answered at 08:30, on its card.
    await w.asks.answer(card, y, { option: 'keep' });
    await stillOpen(w, x)(w.now());
    await w.awake(DEFAULTS - SECOND, stillOpen(w, x));
    await w.awake(DEFAULTS);
    const closed = await w.closing(x);
    expect(closed.map((e) => e.kind), `ask ${x}, unanswered, takes its default at 09:00`).toEqual(['ask.defaulted']);
    expect(clock(closed[0]!.ts), `ask ${x} takes its default at 09:00, one hour after it showed`).toBe(clock(DEFAULTS));
    expect((closed[0]!.data as { answer: string }).answer, `ask ${x} takes the option its default names`).toBe(AT_DEADLINE.definition);
    const answered = await w.closing(y);
    expect(answered.map((e) => e.kind), `ask ${y}, answered at 08:30, ends answered and never defaults`).toEqual(['ask.answered']);
    expect(clock(answered[0]!.ts), `ask ${y} is answered at 08:30`).toBe(clock(at(1, 8, 30)));
  });
}, 120_000);

test('AC1 the minimum notice is drafted at setup: 1 h for every kind, under asks.notice in <home>/config.json', async () => {
  await inWorld(RAISED, async (w) => {
    const config = JSON.parse(readFileSync(join(w.home, 'config.json'), 'utf8')) as { asks?: { notice?: Record<string, string> } };
    for (const kind of KINDS) {
      expect(duration(config.asks?.notice?.[kind]), `setup drafts a minimum notice for ${kind} asks: asks.notice.${kind} reads 1 h`).toBe(NOTICE);
    }
  });
});
