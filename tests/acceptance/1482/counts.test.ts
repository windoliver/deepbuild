// AC9, AC10, AC11's counts, AC12 and AC13 (README: The count journeys). Each journey launches the replica on the
// 1,000-row list at 1936 × 1584 in #1546's dirty mode, read-back off, and reads views rendered, entities notified, rows
// and elements built, frame by frame, from `close`'s report. These are counts, not clocks: the debug build on any Mac
// gives the same ones, so load can't make them INCONCLUSIVE.
import { afterAll, describe, expect, it } from 'vitest';
import {
  HUB_PLANT, READ_SESSION, ROWS, ROWS_10K, SESSION_PAGE, cleanup, countsOf, debugDrive, drawnOf, equalWriteProblems, framesOf, hoverRun,
  named, onList, renderedOutsideList, renderedWithin, requireMacos, rowSet, rowsOverScreen, sessionId, stateReading, type Report,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const LONG = 3_600_000;

/** The fixture's sessions a journey touches, by their place in the list: A opened, B unrelated, T renamed. */
const A = 2;
const B = 5;
const T = 4;
const rowId = (i: number): string => `session:${sessionId(i)}`;
const address = (i: number): string => `session/${sessionId(i)}`;
let ids = 0;
const nextId = (): string => `01KB1482J${String(++ids).padStart(17, '0')}`;

/** The five journeys any machine runs (the issue's Scope), and three more this file's criteria read. */
type Journey = 'open a session' | 'select a row' | 'type a word in the box' | 'an event from an unrelated session' | 'a hub tick with no change' | 'equal writes' | 'a title changes';
const FIVE: Journey[] = ['open a session', 'select a row', 'type a word in the box', 'an event from an unrelated session', 'a hub tick with no change'];
interface Ran { report: Report; steps: number[]; all: number[]; shown: number }

/**
 * Runs one journey in a fresh replica (the planted app when named): its report, its counted steps and every step.
 * The launch and each setup step settle for half a second of the clock first (README: The count journeys).
 */
async function journey(name: Journey, hub?: string): Promise<Ran> {
  requireMacos();
  const { r, shown } = await onList({ bin: debugDrive(), hub, launch: { read_back: 'off' } });
  const steps: number[] = [];
  const counted = async (step: Promise<unknown>): Promise<void> => { await step; steps.push(r.steps); };
  const setup = async (step: Promise<unknown>): Promise<void> => { await step; await r.settle(); };
  try {
    await r.settle();
    switch (name) {
      case 'open a session': await counted(r.click(rowId(A))); break;
      case 'select a row': await setup(r.click(rowId(A))); await counted(r.press('down')); break;
      case 'type a word in the box': await setup(r.open(address(A))); await counted(r.type('box-draft', 'hello')); break;
      case 'an event from an unrelated session':
        await setup(r.open(address(A)));
        await counted(r.feed(sessionId(B), rowSet(nextId(), B, { word: 'working', entry: 'running' })));
        break;
      case 'a hub tick with no change': await counted(r.feed(sessionId(READ_SESSION), rowSet(nextId(), READ_SESSION))); break;
      case 'equal writes':
        await setup(r.open(address(READ_SESSION)));
        await counted(r.feed(sessionId(READ_SESSION), rowSet(nextId(), READ_SESSION)));
        await counted(r.feed(sessionId(READ_SESSION), stateReading(nextId(), READ_SESSION)));
        await counted(r.open(address(READ_SESSION)));
        break;
      case 'a title changes':
        await setup(r.open(address(A)));
        await counted(r.feed(sessionId(T), rowSet(nextId(), T, { title: `Row 0000${T}, renamed` })));
        break;
    }
    const report = await r.close();
    return { report, steps, all: Array.from({ length: r.steps }, (_, k) => k + 1), shown };
  } finally {
    await r.stop();
  }
}
const cache = new Map<string, Promise<Ran>>();
/** The `k`th run of a journey, run once for the file. */
const ran = (name: Journey, k = 0, hub?: string): Promise<Ran> => {
  const key = `${name}|${k}|${hub ?? ''}`;
  if (!cache.has(key)) cache.set(key, journey(name, hub));
  return cache.get(key)!;
};

describe('#1482 the count journeys on the 1,000-row list', () => {
  it('AC9 an event from an unrelated session renders 0 views on the page', async () => {
    const { report, steps } = await ran('an event from an unrelated session');
    const page = named(report, SESSION_PAGE);
    expect(page.length, `the session's page is open: the report names ${SESSION_PAGE}`).toBeGreaterThan(0);
    const frames = framesOf(report, steps);
    expect(frames.filter((f) => f.drawn).length, 'the unrelated session\'s row changed in the list, which the window drew by itself').toBeGreaterThanOrEqual(1);
    expect(renderedWithin(report, frames, page), 'no view on the page rendered').toEqual([]);
  }, LONG);

  it('AC9 a planted page that redraws for every session fails, naming the view', async () => {
    const { report, steps } = await ran('an event from an unrelated session', 0, HUB_PLANT.pageRedrawsEverySession);
    const problems = renderedWithin(report, framesOf(report, steps), named(report, SESSION_PAGE));
    console.log(`AC9 planted: ${problems.slice(0, 3).join('; ')}`);
    expect(problems.length, 'the planted page renders for the other session\'s event').toBeGreaterThan(0);
    expect(problems[0], 'naming the view').toContain(SESSION_PAGE);
  }, LONG);

  it('AC10 three runs of each journey give identical counts', async () => {
    for (const name of FIVE) {
      const three: Ran[] = [];
      for (const k of [0, 1, 2]) three.push(await ran(name, k));
      const counts = three.map((j) => countsOf(j.report, j.all));
      const drew = three[0]!.steps.map((s) => framesOf(three[0]!.report, [s]).filter((f) => f.drawn).length);
      console.log(`AC10 ${name}: counted steps drew ${drew.join(', ')} frames; ${JSON.stringify(counts[0]).slice(0, 300)}`);
      if (name !== 'a hub tick with no change') expect(drew.every((n) => n >= 1), `${name}: the journey's step drew what it changed, so its counts count something`).toBe(true);
      expect(counts[1], `${name}: run 2's counts are run 1's`).toEqual(counts[0]);
      expect(counts[2], `${name}: run 3's counts are run 1's`).toEqual(counts[0]);
    }
  }, LONG);

  it('AC11 the hover over 10,000 rows builds the same rows and elements per frame as over 1,000, and no frame builds more rows than the window shows', async () => {
    requireMacos();
    const bin = debugDrive();
    const small = await hoverRun({ bin, rows: ROWS, launch: { read_back: 'off' } });
    const big = await hoverRun({ bin, rows: ROWS_10K, launch: { read_back: 'off' } });
    expect(big.rows.map((r) => r.id), 'the window shows the same rows at both lengths').toEqual(small.rows.map((r) => r.id));
    const built = (j: typeof small): { rows: number; elements: number }[] => drawnOf(j.report, j.steps).map((f) => ({ rows: f.rows, elements: f.elements }));
    console.log(`AC11 counts at 1,000 rows: ${JSON.stringify(built(small).slice(0, 4))}…; ${small.shown} rows on screen`);
    expect(built(small).length, 'every hover drew a frame').toBeGreaterThanOrEqual(small.steps.length);
    expect(built(small).every((c) => c.elements > 0), 'each drawn frame built elements: a count that reads 0 proves nothing').toBe(true);
    expect(built(big), 'frame for frame, the same rows and elements at 10,000 rows as at 1,000').toEqual(built(small));
    expect(rowsOverScreen(drawnOf(small.report, small.steps), small.shown), 'at 1,000 rows').toEqual([]);
    expect(rowsOverScreen(drawnOf(big.report, big.steps), big.shown), 'at 10,000 rows').toEqual([]);
  }, LONG);

  it('AC11 a planted list that builds a row out of view fails, naming the count', async () => {
    requireMacos();
    const planted = await hoverRun({ bin: debugDrive(), rows: ROWS, hub: HUB_PLANT.buildsRowOutOfView, launch: { read_back: 'off' } });
    const problems = rowsOverScreen(drawnOf(planted.report, planted.steps), planted.shown);
    console.log(`AC11 planted: ${problems.slice(0, 2).join('; ')}`);
    expect(problems.length, 'frames built a row the window doesn\'t show').toBeGreaterThan(0);
    expect(problems[0], 'naming the count').toMatch(/built \d+ rows; \d+ are on screen/);
  }, LONG);

  it('AC12 a write that equals what is shown, from a hub tick, a reading or a setter, notifies 0 entities and draws 0 frames', async () => {
    const { report, steps } = await ran('equal writes');
    const [tick, reading, setter] = steps as [number, number, number];
    expect(equalWriteProblems(report, framesOf(report, [tick])), 'the hub writes a row it already wrote').toEqual([]);
    expect(equalWriteProblems(report, framesOf(report, [reading])), 'the core\'s reading of the state the session is in').toEqual([]);
    expect(equalWriteProblems(report, framesOf(report, [setter])), 'opening the page the window shows').toEqual([]);
  }, LONG);

  it('AC12 a planted setter that notifies without comparing fails, naming the entity', async () => {
    const { report, steps } = await ran('equal writes', 0, HUB_PLANT.setterSkipsCompare);
    const problems = equalWriteProblems(report, framesOf(report, [steps[2]!]));
    console.log(`AC12 planted: ${problems.slice(0, 3).join('; ')}`);
    const notified = problems.find((p) => p.endsWith('was notified'));
    expect(notified, `the planted setter notified an entity: ${problems.join('; ')}`).toBeTruthy();
    expect(notified, 'naming the entity').toMatch(/: \S.* was notified$/);
  }, LONG);

  it('AC13 one row\'s title changes in the 1,000-row list: the frame builds at most the rows on screen and renders no view outside the list', async () => {
    const { report, steps, shown } = await ran('a title changes');
    const frames = framesOf(report, steps);
    expect(frames.filter((f) => f.drawn).length, 'the new title is drawn by the window itself').toBeGreaterThanOrEqual(1);
    expect(rowsOverScreen(frames.filter((f) => f.drawn), shown), `at most the ${shown} rows on screen`).toEqual([]);
    expect(renderedOutsideList(report, frames), 'no view outside the list').toEqual([]);
  }, LONG);

  it('AC13 a planted page that redraws with the list fails, naming the view', async () => {
    const { report, steps } = await ran('a title changes', 0, HUB_PLANT.pageRedrawsWithList);
    const problems = renderedOutsideList(report, framesOf(report, steps));
    console.log(`AC13 planted: ${problems.slice(0, 3).join('; ')}`);
    expect(problems.length, 'the page renders with the list').toBeGreaterThan(0);
    expect(problems.join('; '), 'naming the view').toContain(SESSION_PAGE);
  }, LONG);
});
