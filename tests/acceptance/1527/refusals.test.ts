// AC3, AC6 and AC7's second sentence, in one world, each its own input: an hourly watcher whose wake test stays quiet
// on its planted change, one whose wake test wakes on its twin, the same watcher with a right wake test (which is
// approved and made: a world that refuses every wake test fails), an hourly watcher with no wake test, and a monthly
// report whose dry run reports no cost, so its card can't say what a run or a month costs.
import { expect, test } from 'vitest';
import { FEED_WAKE, fixture, hourly, Job, MIN, monthly, named, type Run } from './helpers.ts';

let shared: Promise<Job> | undefined;
const quiet = (j: Job) => hourly(j.feed!.url, { topic: 'design feed', wake: FEED_WAKE(fixture('wake-quiet.sh')) });
const twin = (j: Job) => hourly(j.feed!.url, { topic: 'support feed', wake: FEED_WAKE(fixture('wake-twin.sh')) });
const right = (j: Job) => hourly(j.feed!.url, { topic: 'team feed' });
const none = (j: Job) => hourly(j.feed!.url, { topic: 'release feed', wake: null });
async function world(): Promise<Job> {
  const j = await Job.open({ feed: fixture('feed-two.json') });
  const tickets = j.w.file('tickets.csv', fixture('report-1.csv'));
  j.answers([
    { match: 'design feed', answer: quiet(j).answer }, { match: 'support feed', answer: twin(j).answer },
    { match: 'team feed', answer: right(j).answer }, { match: 'release feed', answer: none(j).answer },
    { match: 'tickets report', answer: monthly(tickets, { topic: 'tickets' }).answer },
  ]);
  // The tickets report's dry run reports no cost; every other costs $0.05.
  j.work({ dry: [{ match: 'tickets report', cost_usd: null }, { cost_usd: 0.05 }], turns: [{ cost_usd: 0.05, files: { 'news.md': '# Notes\n' } }] });
  return j;
}
const nothingMade = (r: { made: unknown[]; runs: Run[] }, what: string): void => {
  expect(r.made.map((e) => JSON.stringify(e).slice(0, 300)), `${what}: refused, so no workspace is made`).toEqual([]);
  expect(r.runs.map((x) => x.run), `${what}: refused, so the job never runs`).toEqual([]);
};

test(named(3), async () => {
  const j = await (shared ??= world());
  const wake = FEED_WAKE();

  const q = quiet(j);
  const a = await j.refused(q.words, wake.planted.name);
  nothingMade(a, 'a wake test that stays quiet on the planted change');
  expect(a.text, `a wake test that stays quiet on the planted change is refused, naming it ("${wake.planted.name}")`).toContain(wake.planted.name);

  const t = twin(j);
  const b = await j.refused(t.words, wake.twin.name);
  nothingMade(b, 'a wake test that wakes on the twin');
  expect(b.text, `a wake test that wakes on the twin is refused, naming the twin ("${wake.twin.name}")`).toContain(wake.twin.name);

  // The same watcher with a wake test that wakes on the planted change and stays quiet on its twin is approved and made.
  const ok = right(j);
  const { card } = await j.ask(ok.words);
  expect(card, 'the watcher with a right wake test reaches its card').toBeDefined();
  const { pos } = await j.yes(card!);
  expect(await j.workspace(pos), 'the watcher with a right wake test is approved: your yes makes its workspace').toBeDefined();
}, 60 * MIN);

test(named(6), async () => {
  const j = await (shared ??= world());
  const n = none(j);
  const r = await j.refused(n.words, n.heading);
  nothingMade(r, 'an hourly job with no wake test');
  expect(r.text, `the card for an hourly job with no wake test is refused, naming the job ("${n.heading}")`).toContain(n.heading);
}, 30 * MIN);

test(named(7), async () => {
  const j = await (shared ??= world());
  const tickets = j.w.file('tickets.csv', fixture('report-1.csv'));
  const m = monthly(tickets, { topic: 'tickets' });
  const r = await j.refused(m.words, /cost|spend/i, [tickets]);
  nothingMade(r, 'a card without its cost per run and per month');
  expect(r.text, 'a card without a cost per run and per month fails, saying the cost is what it lacks').toMatch(/cost|spend/i);
}, 30 * MIN);
