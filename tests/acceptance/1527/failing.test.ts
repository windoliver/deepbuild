// AC2: the hourly team-feed watcher's wake test starts exiting non-zero (the feed answers a page that isn't JSON) at
// its third fire. Each run from then on is a FAIL on the schedule's claim, never a no-op, spaced as #365 states (each
// next run waits twice the last gap, up to 6 h, and after 5 FAILs in a row the schedule pauses), and none wakes the
// model. A program that reads the failure as nothing new fails here, naming each such run.
import { expect, test } from 'vitest';
import { fireLine, fixture, HOUR, hourly, Job, MIN, named, runLine, shown, type Fire } from './helpers.ts';

/** #365's spacing from the first FAIL of an hourly schedule: gaps of 2, 4, 6 and 6 hours, then paused. */
const SPACED = [0, 2, 6, 12, 18];
/** Hours watched from the first failing fire: past where a sixth run would be if the schedule didn't pause. */
const WATCH = 30;

test(named(2), async () => {
  const j = await Job.open({ feed: fixture('feed-two.json') });
  const { words, answer } = hourly(j.feed!.url);
  j.answers([{ match: 'team feed', answer }]);
  j.work({ dry: [{ cost_usd: 0.05 }], turns: [{ cost_usd: 0.05, files: { 'news.md': '# New in the team feed\n\n- The office moves to the third floor\n- Friday lunch is at noon\n' } }] });

  const { sent, card } = await j.ask(words);
  expect(card, `the hourly job with its wake test reaches its card (deep: ${sent.ran ? shown(sent.ran) : 'still running'})`).toBeDefined();
  const key = String(card!.drafted.data.key);
  const { pos, ran } = await j.yes(card!);
  expect(ran.code, `your yes to ${card!.ask} is taken (${shown(ran)})`).toBe(0);
  const first = await j.firstRun(key, pos);
  expect(first?.ended, 'your yes starts the job and its first run ends: a schedule.run of it within 2 minutes').toBeDefined();

  // Two fires with nothing new: the job runs hourly.
  for (let i = 1; i <= 2; i++) {
    const f = await j.fire(i, key, HOUR);
    expect(f.runs.map(runLine), `${fireLine(f)}: each hourly fire runs the job once`).toHaveLength(1);
  }

  // From the third fire the wake test exits non-zero: the feed answers a page that isn't JSON.
  j.feed!.set(fixture('feed-garbled.txt'), 'text/html');
  const fires: Fire[] = [];
  for (let h = 0; h < WATCH; h++) fires.push(await j.fire(3 + h, key, HOUR));
  const runs = fires.flatMap((f) => f.runs);
  expect(runs.map(runLine), `${fireLine(fires[0]!)}: the fire whose wake test exits non-zero still makes a run`).not.toEqual([]);
  expect(runs.filter((r) => r.noop).map(runLine), 'a wake test that exits non-zero is never read as nothing new: no run is a no-op').toEqual([]);
  expect(runs.filter((r) => r.verdict !== 'FAIL').map(runLine), 'each run whose wake test exits non-zero is a FAIL on the schedule\'s claim').toEqual([]);
  expect(fires[0]!.runs.map(runLine), 'the first FAIL is the fire where the wake test first exits non-zero').toHaveLength(1);

  const t0 = runs[0]!.due;
  const hours = runs.map((r) => Math.round((r.due - t0) / HOUR));
  expect(hours.map((h) => `${h} h`), `spaced as #365 states: each next run waits twice the last gap, up to 6 h, and after 5 FAILs in a row it pauses (${runs.map(runLine).join('; ')})`).toEqual(SPACED.map((h) => `${h} h`));
  expect(runs.filter((r, i) => Math.abs(r.due - t0 - SPACED[i]! * HOUR) > 15 * MIN).map(runLine), 'each run falls within 15 minutes of its slot').toEqual([]);
  expect(fires.filter((f) => f.turns.length > 0).map(fireLine), 'a failing wake test wakes no model').toEqual([]);
}, 120 * MIN);
