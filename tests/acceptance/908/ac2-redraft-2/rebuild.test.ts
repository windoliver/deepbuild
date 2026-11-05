// #908.22f5f214 "Rebuilding the record from the log gives the same moved deadline", on AC1's night: asks raised
// at 23:00, the Mac asleep from 23:30 to 08:00, on the virtual clock, over a real SQLite record.

import { afterEach, expect, test } from 'vitest';
import {
  AUTHORITY, AWAKE, closings, DEFINITION, iso, MINUTE, movesOf, night, noDefaultBeforeShown, openWorld, type World,
} from './helpers.ts';

const ID = '#908.22f5f214';
let worlds: World[] = [];
afterEach(async () => { for (const w of worlds) await w.close(); worlds = []; });
const world = async (): Promise<World> => { const w = await openWorld(); worlds.push(w); return w; };

const untold = (w: World): string => (w.told ? '' : ' (the asks core has no away(from, to), so the hub could not tell it about the time away)');

test(`${ID} rebuilding the record from the log gives each ask the same moved deadline, recorded on the ask with its span`, async () => {
  const w = await world();
  const { definition, authority } = await night(w);
  const before = new Map<string, number | undefined>();
  for (const [h, expected] of [[definition, DEFINITION], [authority, AUTHORITY]] as const) {
    const by = expected.moved - expected.raisedDeadline;
    const moves = await movesOf(w, h, by);
    expect(moves.length, `ask ${h}: the core records a deadline move on the ask, carrying the span that moved it ${by / MINUTE} min, from ${iso(expected.raisedDeadline)} to ${iso(expected.moved)}${untold(w)}`).toBeGreaterThan(0);
    const deadline = await w.deadline(h);
    expect(deadline, `ask ${h}: the asks table reads the moved deadline, ${iso(expected.moved)}, not ${iso(expected.raisedDeadline)}`).toBe(expected.moved);
    before.set(h, deadline);
  }
  // Every table but events dropped, and the log replayed into them.
  await w.record.rebuild();
  for (const h of [definition, authority]) {
    expect(await w.deadline(h), `ask ${h}: the rebuilt record gives the same moved deadline`).toBe(before.get(h));
  }
});

test(`${ID} a hub started on the rebuilt record takes each default when the hub that moved the deadline would`, async () => {
  // Twin worlds through the same night: one hub runs on; the other's record is rebuilt from its log at 08:00 and its
  // hub started again on it, at the same virtual time, so no more time away passes.
  const ran = await world();
  const rebuilt = await world();
  const asks = { ran: await night(ran), rebuilt: await night(rebuilt) };
  await rebuilt.record.rebuild();
  await rebuilt.restart();
  const { definition, authority } = asks.rebuilt;

  const steps = [AWAKE + 1000, DEFINITION.defaultsAt - 1, DEFINITION.defaultsAt, AUTHORITY.raisedDeadline, AUTHORITY.moved - 1, AUTHORITY.moved];
  for (const t of steps) {
    for (const w of [ran, rebuilt]) {
      await w.at(t);
      await w.shown();
    }
    if (t === AWAKE + 1000) {
      expect(await closings(rebuilt, definition), `ask ${definition}: on the rebuilt record it has not taken its default at 08:00:01, a second after it first showed${untold(rebuilt)}`).toEqual([]);
    }
    if (t === AUTHORITY.moved - 1) {
      expect(await closings(rebuilt, authority), `ask ${authority}: on the rebuilt record it is still open past its raised deadline, ${iso(AUTHORITY.raisedDeadline)}, until its moved one, ${iso(AUTHORITY.moved)}${untold(rebuilt)}`).toEqual([]);
    }
  }

  expect(await closings(rebuilt, definition), `ask ${definition}: on the rebuilt record it takes its default at 09:00, an hour after it first showed`).toEqual([['ask.defaulted', DEFINITION.defaultsAt, DEFINITION.answer]]);
  expect(await closings(rebuilt, authority), `ask ${authority}: on the rebuilt record it takes no at its moved deadline, ${iso(AUTHORITY.moved)}`).toEqual([['ask.defaulted', AUTHORITY.moved, AUTHORITY.answer]]);
  // The same as the hub that never stopped.
  expect(await closings(rebuilt, definition), `ask ${definition}: the rebuilt record closes it as the hub that ran on did`).toEqual(await closings(ran, asks.ran.definition));
  expect(await closings(rebuilt, authority), `ask ${authority}: the rebuilt record closes it as the hub that ran on did`).toEqual(await closings(ran, asks.ran.authority));
  for (const w of [ran, rebuilt]) await noDefaultBeforeShown(w);
});
