// #319.ed496876 and #319.eaa6ea10: batches with a daily cap, on the virtual clock. Batches fall every 8 hours
// (16:00, 00:00, 08:00 UTC around T0 = 2026-10-20 12:00); the cap counts the asks batches show in a UTC day.

import { afterEach, expect, test } from 'vitest';
import {
  ask, core, DAY, HOUR, MINUTE, noDefaultBeforeShown, openWorld, settings, sourceOf, T0, type World,
} from './helpers.ts';

let world: World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

const B16 = T0 + 4 * HOUR;        // 2026-10-20 16:00, the first batch after T0
const MIDNIGHT = T0 + 12 * HOUR;  // 2026-10-21 00:00, the next batch, and a new day's cap

test('#319.ed496876 asks beyond the day\'s cap wait for the next batch, unless a session is held on one or its deadline would pass first', async () => {
  const w = (world = await openWorld({ settings: settings({ batch: { every: '8h', cap: 3 } }) }));
  const taste: string[] = [];
  for (const n of [1, 2, 3, 4]) {
    await w.start(`S${n}`, `T${n}`);
    taste.push(await w.asks.raise(core(`S${n}`), sourceOf('taste'), ask('taste', `screen ${n}`)));
  }
  expect(await w.shown(), 'taste calls whose deadlines come after the 16:00 batch wait for it').toEqual([]);
  const queued = await w.inboxRow(taste[0]!);
  expect([queued?.status, queued?.owner, queued?.age], `ask ${taste[0]} reads in the inbox as queued, with you, raised just now`).toEqual(['queued', 'you', 0]);

  await w.at(B16);
  const batched = (await w.shown()).filter((h) => taste.includes(h));
  expect(batched, 'the 16:00 batch shows three of the four, the day\'s cap').toHaveLength(3);
  const beyond = taste.find((h) => !batched.includes(h))!;
  const waiting = await w.inboxRow(beyond);
  expect([waiting?.status, waiting?.age], `ask ${beyond}, beyond the cap, waits in the inbox, 4 hours old`).toEqual(['queued', 4 * HOUR]);

  // Beyond the cap: a provisional taste call its session is held on, and an early question due before midnight.
  await w.at(B16 + MINUTE);
  await w.start('S5', 'T5');
  await w.start('S6', 'T6');
  const held = await w.asks.raise(core('S5'), sourceOf('taste'), ask('taste', 'checkout button', { provisional: true }));
  const early = await w.asks.raise(core('S6'), sourceOf('definition'), ask('definition', 'export format'));
  let shown = await w.shown();
  expect(shown, `ask ${early}, whose 4-hour deadline passes before the next batch, shows at once, cap or not`).toContain(early);
  expect(shown, `ask ${held} waits for the next batch until its session is held on it`).not.toContain(held);
  expect(shown, `ask ${beyond}, beyond the cap, waits for the next batch`).not.toContain(beyond);
  expect(await w.asks.holds('S5', { leaves_machine: true }), `session S5's push waits on ask ${held}`).toContain(held);
  shown = await w.shown();
  expect(shown, `ask ${held} shows at once once its session is held on it, cap or not`).toContain(held);

  await w.at(MIDNIGHT - MINUTE);
  expect(await w.shown(), `ask ${beyond} still waits for the next batch`).not.toContain(beyond);
  await w.at(MIDNIGHT);
  expect(await w.shown(), `ask ${beyond} shows in the next batch`).toContain(beyond);
  await noDefaultBeforeShown(w);
});

test('#319.eaa6ea10 with batches 8 hours apart and the day\'s cap reached, an early question raised just after a batch shows at once, a taste call waits, and no ask takes its default before it has shown', async () => {
  const w = (world = await openWorld({ settings: settings({ batch: { every: '8h', cap: 2 } }) }));
  const first: string[] = [];
  for (const n of [1, 2, 3]) {
    await w.start(`S${n}`, `T${n}`);
    first.push(await w.asks.raise(core(`S${n}`), sourceOf('taste'), ask('taste', `screen ${n}`)));
  }
  await w.at(B16);
  expect((await w.shown()).filter((h) => first.includes(h)), 'the 16:00 batch reaches the day\'s cap of two').toHaveLength(2);

  await w.at(B16 + MINUTE);
  await w.start('S4', 'T4');
  await w.start('S5', 'T5');
  const early = await w.asks.raise(core('S4'), sourceOf('definition'), ask('definition', 'export format'));
  const taste = await w.asks.raise(core('S5'), sourceOf('taste'), ask('taste', 'header'));
  expect((await w.events('ask.created')).find((e) => `ask:${e.id}` === early)?.data, `ask ${early} has the 4-hour deadline`).toMatchObject({ deadline: B16 + MINUTE + 4 * HOUR });
  const shown = await w.shown();
  expect(shown, `the early question ${early} shows at once: its deadline, 20:01, comes before the next batch`).toContain(early);
  expect(shown, `the taste call ${taste} waits for the next batch: its deadline is 3 days off`).not.toContain(taste);
  expect((await w.inboxRow(taste))?.status, `the taste call ${taste} reads as queued`).toBe('queued');

  await w.at(B16 + MINUTE + 4 * HOUR);
  expect((await w.about(early)).filter((e) => e.kind === 'ask.defaulted').map((e) => e.ts), `the early question ${early} takes its default at its deadline`).toEqual([B16 + MINUTE + 4 * HOUR]);
  expect((await w.about(taste)).filter((e) => e.kind === 'ask.defaulted'), `the taste call ${taste} hasn't taken its default`).toEqual([]);
  expect(await w.shown(), `the taste call ${taste} still waits for the next batch`).not.toContain(taste);
  await w.at(MIDNIGHT);
  expect(await w.shown(), `the taste call ${taste} shows in the next batch`).toContain(taste);

  // Every deadline passes: each ask takes its default only after it has shown.
  await w.at(B16 + MINUTE + 3 * DAY);
  for (const h of [...first, early, taste]) expect((await w.about(h)).filter((e) => e.kind === 'ask.defaulted'), `ask ${h} takes its default`).toHaveLength(1);
  await noDefaultBeforeShown(w);
});
