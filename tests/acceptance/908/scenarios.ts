// The #908 fixtures the tests share: the issue's night (AC1, AC2) and the afternoon a hub goes down or the Mac
// sleeps while an ask waits for its batch (AC2, AC3). Times are UTC on the virtual clock; with the batches setup
// drafts (every 8 h), batches fall at 00:00, 08:00 and 16:00.

import { expect } from 'vitest';
import { SECOND, WAIT, at, clock, type World } from './helpers.ts';

// ---- The night: raised at 23:00 with a 4 h deadline, the Mac asleep from 23:30 to 08:00, the default at 09:00.
export const RAISED = at(0, 23);
export const SLEEPS = at(0, 23, 30);
export const WAKES = at(1, 8);
export const DEFAULTS = at(1, 9);

/** Fails, naming the ask, once it has closed in any way: it must stay open until `until`. */
export const stillOpen = (w: World, handle: string, until = DEFAULTS) => async (t: number): Promise<void> => {
  const closed = await w.closing(handle);
  if (!closed.length) return;
  const first = closed[0]!;
  const shown = await w.shownAt(handle);
  expect.fail(`ask ${handle} closed (${first.kind}) at ${clock(first.ts)}, ${(first.ts - (shown ?? first.ts)) / SECOND} s after it first showed at ${shown === undefined ? 'no time' : clock(shown)}; `
    + `unanswered, it takes its default no sooner than the 1 h minimum notice after it shows, at ${clock(until)} (checked at ${clock(t)})`);
};

/** The night up to the first beat after the Mac wakes: definition asks raised at 23:00, none shown before it sleeps, each shown at 08:00. */
export async function night(w: World, subjects: [session: string, subject: string][]): Promise<string[]> {
  const handles: string[] = [];
  for (const [i, [session, subject]] of subjects.entries()) {
    await w.start(session, `T${i + 1}`);
    handles.push(await w.raise(session, 'definition', subject));
  }
  for (const h of handles) expect(clock(await w.deadline(h)), `ask ${h} is raised with the 4 h definition deadline setup drafts, 03:00`).toBe(clock(RAISED + WAIT.definition));
  await w.awake(SLEEPS);
  for (const h of handles) {
    expect(await w.shownAt(h), `ask ${h}, whose 03:00 deadline comes after the 00:00 batch, waits for that batch, so it hasn't shown when the Mac sleeps at 23:30`).toBeUndefined();
  }
  await w.asleep(WAKES);
  for (const h of handles) {
    const shown = await w.shownAt(h);
    expect(shown === undefined ? 'never' : clock(shown), `ask ${h} shows at 08:00, when the Mac wakes`).toBe(clock(WAKES));
    expect((await w.closing(h)).map((e) => e.kind), `ask ${h} doesn't take its default as it shows at 08:00`).toEqual([]);
  }
  return handles;
}

// ---- The afternoon: one ask shows in the 16:00 batch; another, raised after it with a 2-day wait, waits for the
// 00:00 batch; at 16:01 the hub goes down (or the Mac sleeps) until 00:30, so the 00:00 batch passes unseen.
/** A definition ask (4 h), raised a minute before the 16:00 batch: it shows in it. */
export const A_RAISED = at(0, 15, 59);
export const BATCH = at(0, 16);
/** A choice ask (2 days), raised after the 16:00 batch: its deadline comes after the 00:00 batch, so it waits for it. */
export const B_RAISED = at(0, 16, 0, 30);
export const GOES = at(0, 16, 1);
export const BACK = at(1, 0, 30);
/** 16:01 to 00:30. */
export const SPAN = BACK - GOES;
