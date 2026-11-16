// AC6: a change that landed with its taste call open is done for the issues blocked by it, so they start; a change held
// for its call (it reaches a release) isn't, so the issues it blocks don't start, while a slot is free.
import { expect, test } from 'vitest';
import { FIRST, MIN, named, openCallsOf, sleep, startsOf, waitUntil, World } from './helpers.ts';

const LANDS = 100;
const AFTER_LANDED = 101;
const HELD = 102;
const AFTER_HELD = 103;

test(named(6), async () => {
  // The two blocked issues hold their turns once started: seen starting, they make no change.
  const w = await World.open({ issues: [{}, { blockedBy: [LANDS], gated: true }, { reaches: 'release' }, { blockedBy: [HELD], gated: true }], atOnce: 'four' });
  await w.startRun();
  const landed = await waitUntil(() => w.mergeOf(LANDS), FIRST, 2000);
  expect(landed, `#${LANDS}'s reversible change, its taste call open, lands within ${FIRST / MIN} minutes of the approval (${await w.about(LANDS)})`).toBeDefined();

  // The issue blocked by the landed change starts, its blocker's call still open.
  const started = await waitUntil(() => w.on(AFTER_LANDED)[0], 10 * MIN, 2000);
  expect(started, `#${AFTER_LANDED}, blocked by #${LANDS}, whose change landed with its call open, starts`).toBeDefined();
  expect(started!.started, `#${AFTER_LANDED} starts once #${LANDS}'s change landed, not before`).toBeGreaterThanOrEqual(landed!.ended);
  expect(openCallsOf(await w.events(), LANDS).length, `#${LANDS}'s call is still open: its change landed with the call open`).toBe(1);
  expect(w.state(LANDS), `#${LANDS} stays open, naming its call`).toBe('open');

  // The issue blocked by the held change doesn't, once that change waits for you (its call raised), and 90 s more.
  const waiting = await waitUntil(async () => openCallsOf(await w.events(), HELD).length > 0, 10 * MIN, 2000);
  expect(waiting, `#${HELD}'s change waits for you: its taste call is raised (${await w.about(HELD)})`).toBe(true);
  await sleep(90_000);
  expect(w.merged(HELD), `#${HELD}'s change reaches a release, so it stays held (AC2)`).toBe(false);
  expect(w.starts(AFTER_HELD), `#${AFTER_HELD}, blocked by #${HELD}, whose change is held, doesn't start`).toEqual([]);
  expect(startsOf(await w.events(), AFTER_HELD).length, `the record holds no start on #${AFTER_HELD}`).toBe(0);
}, 60 * MIN);
