// AC8: three changes within 2 s add one entry with the count 3.
//
// A real hub's record with one finished session and no open ask; the replica on a copy of it at the reference window,
// the session's page open. Three asks from that session open, each as a real hub records it and fed in log order, 300 ms
// of the replica's clock between them, so all three land inside 2 s; the announcements are read 3 s after the
// last (README, The fixtures: three together).
import { afterAll, describe, expect, it } from 'vitest';
import { shared } from '../16/helpers.ts';
import { makeWorld } from '../2018/helpers.ts';
import { blocked, changed, cleanup, flicks, MIN, SECOND, Stage } from './helpers.ts';
import { ID, openKeys, PLANT, together, type Read } from './judges.ts';

afterAll(cleanup, 5 * MIN);
const LIMIT = 180 * MIN;
const HELD = 'the shipped app must pass this judge first, or a plant it fails proves nothing';
const TITLE = 'Cart totals';
const QUESTIONS = ['Which store keeps the cart totals?', 'Keep the old totals table?', 'Round the totals up or down?'];
/** The replica's clock between two of the changes. */
const BETWEEN_MS = 300;
const WITHIN_MS = 2 * SECOND;

interface Run { what: string; before: Read; after: Read }
async function run(plant?: string): Promise<Run> {
  const w = await makeWorld({
    repos: ['shop'],
    seed: async (s, T) => {
      const at = T - 20 * MIN;
      await s.start('a', 'shop', at);
      await s.task('a', TITLE, at + 1000);
      await s.prompt('a', 'sum the cart', at + 2000);
      await s.stop('a', at + 20_000, false);
    },
  });
  const stage = await Stage.on(w, plant ? { plant } : {});
  try {
    const id = w.sessions.a?.id ?? blocked('the world has no session a');
    await stage.d.open(`session/${id}`);
    await stage.d.wait(3 * SECOND);
    const before = await stage.read();
    const handles: string[] = [];
    let from: number | undefined;
    for (const [i, question] of QUESTIONS.entries()) {
      if (i > 0) await stage.d.wait(BETWEEN_MS);
      from ??= stage.d.t;
      await changed(stage, async (s, at) => { handles.push(await s.ask('a', 'choice', question, at)); });
    }
    const span = stage.d.t - from!;
    if (span >= flicks(WITHIN_MS)) blocked(`the fixture didn't hold: the three asks landed over ${(span / flicks(SECOND)).toFixed(2)} s of the replica's clock, not within 2 s`);
    await stage.d.wait(3 * SECOND);
    return { what: `three changes within 2 s (the asks ${handles.map((h, i) => `${h} "${QUESTIONS[i]!}"`).join(', ')} from ${TITLE}, its page open)`, before, after: await stage.read() };
  } finally {
    await stage.stop();
  }
}
const judged = (r: Run): string[] => together({ what: r.what, n: 3, before: r.before, after: r.after, besides: [...QUESTIONS, ...openKeys(), TITLE] });
const shipped = shared(() => run());

describe(`AC8 ${ID.together} changes that land within 2 s of each other are one line with their count`, () => {
  it(`AC8 ${ID.together}: three changes within 2 s add one entry with the count 3`, async () => {
    expect(judged(await shipped())).toEqual([]);
  }, LIMIT);

  it(`AC8 ${ID.together} wrong program: a planted window that adds three (${PLANT.eachChange}) fails, naming them`, async () => {
    expect(judged(await shipped()), HELD).toEqual([]);
    const failures = judged(await run(PLANT.eachChange)).join('\n');
    expect(failures, `${PLANT.eachChange} wasn't caught naming its three entries`).toMatch(/added 3 entries, not one with the count 3: /);
    const named = failures.split('not one with the count 3: ')[1]!;
    for (const question of QUESTIONS) expect(named, `the failure names the entry for "${question}"`).toContain(question);
  }, LIMIT);
});
