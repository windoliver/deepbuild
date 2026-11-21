// AC1: an hourly watcher of the fixture team feed, approved with its wake test, then 24 fires on the hub's clock. The
// feed changes once, before the 10th fire: that fire wakes the model once, and the other 23 are uncounted no-ops with
// no plan usage. A planted program that wakes the model on each fire fails here, naming each such fire.
import { expect, test } from 'vitest';
import { fireLine, fixture, HOUR, hourly, Job, MIN, named, runLine, shown, type Fire } from './helpers.ts';

const FIRES = 24;
/** The fire before which the feed gets its one new story. */
const CHANGED = 10;

test(named(1), async () => {
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
  expect(first, 'your yes starts the job: a schedule.run of it (its schedule naming the brief\'s key) within 2 minutes').toBeDefined();
  expect(first!.ended, `the first run ends: ${runLine(first!)}`).toBeDefined();

  const fires: Fire[] = [];
  for (let i = 1; i <= FIRES; i++) {
    if (i === CHANGED) {
      j.feed!.set(fixture('feed-three.json'));
      j.work({ dry: [{ cost_usd: 0.05 }], turns: [{ cost_usd: 0.05, files: { 'news.md': '# New in the team feed\n\n- The new printer is in\n' } }] });
    }
    const f = await j.fire(i, key, HOUR);
    fires.push(f);
    expect(f.runs.map(runLine), `${fireLine(f)}: each hourly fire runs the job once`).toHaveLength(1);
    expect(f.runs[0]!.ended, `${fireLine(f)}: the fire's run ends`).toBeDefined();
  }

  const quiet = fires.filter((f) => f.i !== CHANGED);
  const changed = fires[CHANGED - 1]!;
  expect(quiet.filter((f) => f.turns.length > 0).map(fireLine), 'no fire on a feed with nothing new wakes the model').toEqual([]);
  expect(changed.turns.length, `${fireLine(changed)}: the feed's one change wakes the model, once`).toBe(1);
  expect(fires.reduce((n, f) => n + f.turns.length, 0), 'one model turn in the 24 hours').toBe(1);
  expect(changed.runs[0]!.noop, `${fireLine(changed)}: the run that woke the model is no no-op`).toBe(false);
  expect(quiet.filter((f) => !f.runs.every((r) => r.noop && r.verdict === undefined)).map(fireLine), 'the other 23 are uncounted no-ops: noop, and no verdict on the claim').toEqual([]);
  expect(quiet.length, 'the other fires are 23').toBe(23);
  expect(quiet.filter((f) => f.usage.length > 0).map((f) => `${fireLine(f)}: ${f.usage.map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 160)}`).join('; ')}`), 'no plan usage on those 23').toEqual([]);
}, 120 * MIN);
