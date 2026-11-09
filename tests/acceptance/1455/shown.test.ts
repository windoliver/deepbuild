// AC1, AC2 and AC3: the fixture run, every view the app has over fixtures/run.events.jsonl, read as the strings it shows
// (README, The fixture run). One clean run is shared; each plant is its own run. A plant's test first holds the clean
// run to the same judge, so a program that already fails it can't make the plant look caught.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, MINUTES, asks, chartFailures, cleanup, fixtureRun, fixtureTexts, fixtureWordFailures, FORBIDDEN, holds, plainWords, sessions, titleFailures, type FixtureRun,
} from './helpers.ts';

const LONG = 60 * MINUTES;
let clean: FixtureRun;
afterAll(cleanup, 60_000);
beforeAll(async () => {
  // The premise: no fixture holds a forbidden phrase, so whatever a view shows of one is the app's own.
  for (const { file, text } of fixtureTexts()) {
    const found = FORBIDDEN.filter((f) => holds(text, f.phrase)).map((f) => f.phrase);
    if (found.length) throw Error(`INVALID: the fixture ${file} itself holds ${found.join(', ')}`);
  }
  if (!asks().some((a) => a.stalled)) throw Error('INVALID: the fixture has no stalled claim\'s ask, so no card could show its kind name');
  if (!sessions().some((s) => s.deadlines.length) || !sessions().some((s) => !s.deadlines.length)) throw Error('INVALID: the fixture needs a session with deadlines and one without');
  clean = await fixtureRun();
}, LONG);

describe('#1455 what a person reads', () => {
  it(`${AC1}: a dump of every string the real app shows on a fixture run holds none of Cart total, Repository skeleton, returned, the tagline or an internal kind name`, () => {
    expect(clean.cards.length, 'the run opened no card').toBe(asks().length);
    expect(fixtureWordFailures(clean, plainWords()), `the fixture run's strings, in ${clean.out}`).toEqual([]);
  });

  it(`${AC1}: a planted view that shows "stalled claim" fails, naming the string and its view`, async () => {
    expect(fixtureWordFailures(clean, plainWords()), 'the clean run already fails AC1, so the plant can\'t be told from it').toEqual([]);
    const planted = await fixtureRun('card-shows-kind-name');
    const failures = fixtureWordFailures(planted, plainWords());
    const named = failures.filter((f) => f.includes('stalled claim') && /\bcard\b/.test(f));
    expect(named, `the planted card that shows "stalled claim" wasn't caught, naming the string and the card: ${JSON.stringify(failures)}`).not.toEqual([]);
  }, LONG);

  it(`${AC2}: a session with no deadline draws no chart and no caption; with deadlines, the caption shows once and the readout agrees with it`, () => {
    expect(clean.pages.length, 'the run drew no session page').toBe(sessions().length);
    expect(chartFailures(clean.pages)).toEqual([]);
  });

  it(`${AC2}: a planted readout that counts asks under an hours caption fails, naming both`, async () => {
    expect(chartFailures(clean.pages), 'the clean run already fails AC2, so the plant can\'t be told from it').toEqual([]);
    const planted = await fixtureRun('readout-counts-asks');
    const failures = chartFailures(planted.pages);
    const page = planted.pages.find((p) => p.session.deadlines.length)!;
    const caption = page.seen.items.find((i) => i.id === 'session-caption');
    const readout = page.seen.items.find((i) => i.id === 'session-readout');
    expect(caption && readout, `the planted page draws no caption and readout to judge: ${JSON.stringify(page.seen.items.map((i) => i.id))}`).toBeTruthy();
    const text = (v: unknown) => JSON.stringify((v as { text: string }).text);
    expect(failures.filter((f) => f.includes(text(caption!.value)) && f.includes(text(readout!.value))), `the planted readout wasn't caught naming both its caption and itself: ${JSON.stringify(failures)}`).not.toEqual([]);
    expect(Number((readout!.value as { text: string }).text.match(/\d+/)?.[0]), 'the plant\'s readout counts the session\'s asks').toBe(page.session.asks);
  }, LONG);

  it(`${AC3}: the accessible name of a session's page still holds "Session", and its visible title holds no raw ID`, () => {
    expect(clean.pages.some((p) => p.session.title === null), 'the fixture has no untitled session').toBe(true);
    expect(titleFailures(clean.pages)).toEqual([]);
  });

  it(`${AC3}: a planted title that draws the ID fails, naming the session`, async () => {
    expect(titleFailures(clean.pages), 'the clean run already fails AC3, so the plant can\'t be told from it').toEqual([]);
    const planted = await fixtureRun('title-draws-id');
    const failures = titleFailures(planted.pages);
    const named = sessions().filter((s) => failures.some((f) => f.includes(s.id) && f.includes('raw ID')));
    expect(named, `no planted title was caught drawing its ID, naming its session: ${JSON.stringify(failures)}`).not.toEqual([]);
  }, LONG);
});
