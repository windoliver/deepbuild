// AC4: a standing run has no end date. It goes on past 7 days with no ask, and its weekly notice, which needs no
// answer, lists what it landed, what it left and what it spent. At its plan share it starts nothing until the next
// window, and asks nothing.
import { expect, test } from 'vitest';
import { DAY, HOUR, LABEL, lists, MIN, named, noticeOf, said, shown, sleep, waitUntil, World } from './helpers.ts';

const SHARE = 50;
const SCOPE = `work through open issues labelled "${LABEL}" with Claude Code, two at a time, up to ${SHARE}% of each plan window`;
const LANDS = 100;
const LEFT = 101;
const WAITS = 102;

test(named(4), async () => {
  // The hub's clock is the test's to step, and the account's five-hour window reads 5% used. #100 is worked once the
  // test lets it go and lands; #101's attempt holds its turn, so the run leaves it; #102 comes later.
  const w = await World.open({ issues: [{}, {}], more: 1, plan: { [LANDS]: { launches: ['gated'] }, [LEFT]: { launches: ['gated'] }, [WAITS]: { launches: ['gated'] } }, clock: true, account: true });
  const asked = await w.run(SCOPE);
  expect(asked.code, `deep work "${SCOPE}" raises the standing run's one approval and exits 0: ${shown(asked)}`).toBe(0);
  const { ask } = await w.approve(asked);
  const asks = async (): Promise<string[]> => (await w.asksBesides(ask)).map((e) => String(e.data.question).slice(0, 300));

  const both = await waitUntil(() => w.on(LANDS)[0] && w.on(LEFT)[0], 15 * MIN, 2000);
  expect(both, `#${LANDS} and #${LEFT} start: ${w.starts(LANDS).concat(w.starts(LEFT)).join('; ')}`).toBeTruthy();
  // Half a minute into the week, #100's attempt goes on, so its landing falls inside any week counted from here.
  await sleep(30_000);
  w.go(LANDS);
  const landed = await waitUntil(() => w.merged(LANDS) && w.state(LANDS) === 'closed', 40 * MIN, 2000);
  expect(landed, `#${LANDS}'s change lands and its issue closes`).toBe(true);

  // At its plan share: the five-hour window 60% used, past the run's 50%. A ready issue comes, and a slot is free.
  await w.report(60, w.resets);
  w.add(WAITS);
  const added = Date.now();
  await waitUntil(() => w.forge.readAfter(added, WAITS), 5 * MIN, 2000);
  await sleep(90_000);
  expect(w.starts(WAITS), `at its plan share the run starts nothing: #${WAITS} is ready and a slot is free`).toEqual([]);
  expect((await w.startsOf(WAITS)).length, `the record holds no start for #${WAITS}`).toBe(0);
  expect(await asks(), 'at its plan share the run raises no ask').toEqual([]);

  // 10 s past 7 days since the approval on the hub's clock, so past the window's reset: the next window reads 5% used.
  const events = await w.events();
  const approved = Math.max(...events.filter((e) => (e.kind === 'start.approval' && e.data.ask === ask) || (e.kind === 'ask.answered' && e.subject === ask)).map((e) => e.ts));
  const now = await w.clock(Math.max(0, approved + 7 * DAY + 10_000 - (await w.clock(0))));
  expect(now, 'the hub\'s clock is past 7 days since the approval and past the window\'s reset').toBeGreaterThan(Math.max(approved + 7 * DAY, w.resets));
  await w.report(5, now + 5 * HOUR);
  const next = await waitUntil(() => w.on(WAITS)[0], 10 * MIN, 2000);
  expect(next, `in the next window, past 7 days, the run goes on: #${WAITS} starts`).toBeDefined();

  const notice = await waitUntil(async () => noticeOf(await w.events(), ask), 5 * MIN, 2000);
  expect(notice, `the record holds the run's weekly notice: an event naming ${ask} whose data holds landed, left and spent`).toBeDefined();
  const text = JSON.stringify(notice!.event.data).slice(0, 1500);
  expect(lists(notice!.landed, LANDS), `the notice lists #${LANDS} as landed: ${text}`).toBe(true);
  expect(lists(notice!.left, LEFT), `the notice lists #${LEFT} as left: ${text}`).toBe(true);
  expect(lists(notice!.left, LANDS), `#${LANDS} landed, so it isn't left: ${text}`).toBe(false);
  expect(said(notice!.spent), `the notice says what the run spent: ${text}`).toBe(true);
  expect(await asks(), 'the run went on past 7 days with no ask, and its notice needs no answer').toEqual([]);
}, 90 * MIN);
