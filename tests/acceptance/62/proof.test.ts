// #62 Proof and AC12. A week of recorded sessions replayed: the learned changes with their evidence and
// scopes, one rollback, and a rollback to a date. Then the layer rebuilt from its events equals the
// incremental projection byte for byte.
import { afterEach, describe, expect, it } from 'vitest';
import { allEvents, apply, DAY, expectState, firstRowDifference, handleOf, HOUR, layerRow, LOCAL_FIRST, openWorld, propose, removeRoots, said, sliceText, startSession, T0, widen, youApp, type World } from './helpers.ts';

afterEach(removeRoots);

interface Week {
  w: World;
  sessions: string[];             // every session, in the order they started
  atDate: Map<string, unknown>;   // each session's start slice at the date
  learned: string[];              // every learn.* event appended this week, in order
  state: Record<string, string>;  // the state each learned change must end in
  rolledOne: string[];            // what the single rollback returned
  rolledSince: string[];          // what the rollback to the date returned
  expectedSince: string[];        // what it must compensate, newest first
  flaggedBy: Record<string, string>; // change → the rolled-back change it was built on
}

/** Monday to Sunday in two repos, two sessions a day, a learned change or more a day (README: Proof). */
async function replayWeek(): Promise<Week> {
  const w = await openWorld(T0);
  const sessions: string[] = [];
  const learned: string[] = [];
  const state: Record<string, string> = {};
  const day = (d: number, hour = 0) => T0 + d * DAY + hour * HOUR;
  const startDay = async (d: number) => {
    w.clock.set(day(d));
    const shop = await startSession(w, 'shop', [
      { id: 'm1', from: 'you', text: `day ${d}: shop tests run with npm run test:unit` },
      { id: 'm2', from: 'you', text: `day ${d}: the shop api runs on ${4100 + d}` },
      { id: 'm3', from: 'agent', text: `day ${d}: done, all green` },
    ]);
    const blog = await startSession(w, 'blog', [
      { id: 'm1', from: 'you', text: `day ${d}: never push without asking` },
      { id: 'm2', from: 'you', text: `day ${d}: the blog builds with hugo` },
      { id: 'f1', from: 'fetch', text: `day ${d}: the hugo docs say themes live in themes/` },
    ]);
    sessions.push(shop, blog);
    return { shop, blog };
  };
  const track = (id: string, final: string) => { learned.push(id); state[id] = final; return id; };

  // Monday: a session's lesson, local first; the rule you typed.
  const mon = await startDay(0);
  const l0Change = { target: 'slice:shop-tests', diff: '+ shop tests: npm run test:unit', evidence: [{ at: said(mon.shop, 'm1'), quote: 'shop tests run with npm run test:unit' }] };
  const l0 = track(await apply(w, { ...l0Change, scope: `session:${mon.shop}` }, LOCAL_FIRST), 'applied');
  track(await apply(w, { layer: 'base', target: 'rule:nopush', diff: '+ never push without asking', evidence: [{ at: said(mon.blog, 'm1'), quote: 'never push without asking' }], scope: 'all' }, 'you'), 'applied');
  // Tuesday: you widen Monday's lesson to its repo; a blog lesson stays in its session.
  const tue = await startDay(1);
  track(await widen(w, { ...l0Change, scope: 'repo:shop', supersedes: await handleOf(w, l0) }, 'you'), 'applied');
  const blogChange = { target: 'slice:blog-build', diff: '+ blog builds with hugo', evidence: [{ at: said(tue.blog, 'm2'), quote: 'the blog builds with hugo' }] };
  const l1 = track(await apply(w, { ...blogChange, scope: `session:${tue.blog}` }, LOCAL_FIRST), 'applied');
  // Wednesday: a port, with its replay; an agent's proposal; an outside claim refused.
  const wed = await startDay(2);
  const l2 = track(await apply(w, { target: 'slice:shop-port', diff: '+ shop api on 4102', evidence: [{ at: said(wed.shop, 'm2'), quote: 'the shop api runs on 4102' }], scope: `session:${wed.shop}`, replay: { tasks: 20, regressions: 0 } }, LOCAL_FIRST), 'rolled_back');
  track(await propose(w, wed.shop, 'shop', { target: 'slice:shop-ci', diff: '+ ci runs unit tests first', evidence: [{ at: said(wed.shop, 'm3'), quote: 'all green' }], scope: `session:${wed.shop}` }), 'proposed');
  track(await apply(w, { target: 'slice:blog-themes', diff: '+ themes live in themes/', evidence: [{ at: said(wed.blog, 'f1'), quote: 'themes live in themes/' }], scope: `session:${wed.blog}` }, LOCAL_FIRST), 'refused');
  // Thursday: a correction superseding Wednesday's port; an attempt on an approved check, refused.
  const thu = await startDay(3);
  const l3 = track(await apply(w, { target: 'slice:shop-port', diff: '- shop api on 4102\n+ shop api on 4103', evidence: [{ at: said(thu.shop, 'm2'), quote: 'the shop api runs on 4103' }], scope: `session:${thu.shop}`, supersedes: await handleOf(w, l2) }, LOCAL_FIRST), 'applied');
  track(await apply(w, { target: 'check:app.e2e', diff: '- expect(total).toBeVisible()', evidence: [{ at: said(thu.shop, 'm3'), quote: 'all green' }], scope: `session:${thu.shop}` }, LOCAL_FIRST), 'refused');
  // Friday: a change citing Monday's; then you roll back Wednesday's port, which flags Thursday's correction.
  const fri = await startDay(4);
  track(await apply(w, { target: 'slice:shop-ci', diff: '+ ci runs the unit tests first', evidence: [{ at: await handleOf(w, l0), quote: 'shop tests: npm run test:unit' }, { at: said(fri.shop, 'm1'), quote: 'npm run test:unit' }], scope: 'repo:shop' }, 'you'), 'applied');
  w.clock.set(day(4, 6));
  const rolledOne = await w.record.rollBack(youApp, { change: l2 });

  // The date: Saturday 00:00.
  const date = day(5);
  w.clock.set(date);
  const atDate = new Map<string, unknown>();
  for (const s of sessions) atDate.set(s, await w.record.startSlice(s));
  // Saturday: a new lesson; you widen Tuesday's blog lesson to every repo.
  const sat = await startDay(5);
  w.clock.set(day(5, 2));
  const l5 = track(await apply(w, { target: 'slice:blog-theme', diff: '+ blog theme is paper', evidence: [{ at: said(sat.blog, 'm2'), quote: 'builds with hugo' }], scope: `session:${sat.blog}` }, LOCAL_FIRST), 'rolled_back');
  const l5w = track(await widen(w, { ...blogChange, scope: 'all', supersedes: await handleOf(w, l1) }, 'you'), 'rolled_back');
  // Sunday: Monday's lesson rewritten; then you roll back everything learned since Saturday.
  const sun = await startDay(6);
  w.clock.set(day(6, 2));
  const l6 = track(await apply(w, { target: 'slice:shop-tests', diff: '- shop tests: npm run test:unit\n+ shop tests: npm run test:all', evidence: [{ at: said(sun.shop, 'm1'), quote: 'npm run test:unit' }], scope: 'repo:shop', supersedes: await handleOf(w, l0) }, 'you'), 'rolled_back');
  w.clock.set(day(6, 8));
  const rolledSince = await w.record.rollBack(youApp, { since: date });
  return { w, sessions, atDate, learned, state, rolledOne, rolledSince, expectedSince: [l6, l5w, l5], flaggedBy: { [l3]: l2 } };
}

describe('Proof: a week of recorded sessions replayed', () => {
  it('Proof the week lists every learned change with its evidence and scope; one rollback and a rollback to a date leave the log whole, the slices as they were at the date, and the dependants flagged', async () => {
    const week = await replayWeek();
    const { w } = week;
    const events = await allEvents(w.record);
    const byId = new Map(events.map((e) => [e.id, e]));

    // "What did you learn this week?": every learned change, with its evidence and scope as recorded.
    const weekStart = T0, weekEnd = T0 + 7 * DAY;
    const thisWeek = (await w.record.table('learned_layer')).rows.filter((r) => typeof r.created === 'number' && r.created >= weekStart && r.created < weekEnd && r.kind !== 'learn.rolled_back');
    expect(thisWeek.map((r) => String(r.id)).sort(), 'the week lists every learned change').toEqual([...week.learned].sort());
    for (const id of week.learned) {
      const row = await layerRow(w, id);
      const data = byId.get(id)!.data as { evidence: unknown; scope: string };
      expect(JSON.parse(String(row.evidence)), `${id} lists its evidence`).toEqual(data.evidence);
      expect(row.scope, `${id} lists its scope`).toBe(data.scope);
      await expectState(w, id, week.state[id]!, `the week's change ${id}`);
    }
    for (const [id, base] of Object.entries(week.flaggedBy)) {
      const flag = String((await layerRow(w, id)).flagged ?? '');
      expect(flag.includes(base) || flag.includes(await handleOf(w, base)), `${id} is flagged, built on the rolled-back ${base}`).toBe(true);
    }

    // The rollbacks: compensating events, nothing deleted, the date's newest first.
    expect(week.rolledOne).toHaveLength(1);
    expect(week.rolledSince, 'the rollback to Saturday compensates newest first').toEqual(week.expectedSince);
    const rolledEvents = events.filter((e) => e.kind === 'learn.rolled_back');
    expect(rolledEvents, 'one learn.rolled_back per compensated change').toHaveLength(1 + week.expectedSince.length);
    for (const id of week.learned) expect(byId.has(id), `${id} is still in the log`).toBe(true);
    expect(events.map((e) => e.log_pos), 'log positions only grow').toEqual([...events.map((e) => e.log_pos)].sort((a, b) => a - b));

    // What agents read at session start is exactly what they read at the date.
    for (const [s, slice] of week.atDate) expect(await w.record.startSlice(s), `session ${s} reads what it read at the date`).toEqual(slice);
    // And the week's lessons are where their scopes put them: Monday's in every shop session, not the blog's.
    // Sessions in start order: Monday shop, Monday blog, Tuesday shop, …; Wednesday's shop is 4, Friday's 8.
    const monBlog = week.sessions[1]!, wedShop = week.sessions[4]!, friShop = week.sessions[8]!;
    expect(await sliceText(w, friShop), "Friday's shop session reads Monday's lesson, widened to the repo").toContain('shop tests: npm run test:unit');
    expect(await sliceText(w, monBlog), "Monday's blog session doesn't").not.toContain('shop tests: npm run test:unit');
    expect(await sliceText(w, monBlog), 'every session reads your rule').toContain('never push without asking');
    expect(await sliceText(w, wedShop), "Wednesday's shop session no longer reads the rolled-back port").not.toContain('shop api on 4102');
    await w.record.close();
  }, 120_000);
});

describe('AC12 the layer rebuilt from its events equals the incremental projection byte for byte', () => {
  it('AC12 after the week, learned_layer and every start slice rebuild to exactly what the appends built', async () => {
    const week = await replayWeek();
    const { w } = week;
    const live = await w.record.table('learned_layer');
    // A rebuild of a layer that holds no judgments proves nothing: the week's states must be there first.
    const states = new Set(live.rows.map((r) => String(r.state)));
    for (const s of ['applied', 'refused', 'rolled_back', 'proposed']) expect(states.has(s), `the live layer holds a ${s} change`).toBe(true);
    expect(live.rows.some((r) => r.flagged !== null && r.flagged !== undefined), 'the live layer holds a flagged change').toBe(true);
    const slices = new Map<string, string>();
    for (const s of week.sessions) slices.set(s, JSON.stringify(await w.record.startSlice(s)));
    const logBefore = (await allEvents(w.record)).map((e) => `${e.log_pos}:${e.id}`);

    // Wrong programs: judgments made at append and kept only in the table or in memory; flags written by the
    // rollback call but by no event; a layer that reads the clock (the rebuild runs a week later).
    w.clock.tick(7 * DAY);
    await w.record.rebuild();
    const rebuilt = await w.record.table('learned_layer');
    expect(firstRowDifference(live, rebuilt), 'learned_layer rebuilt equals the live layer, row by row, values as stored').toBeUndefined();
    for (const s of week.sessions) expect(JSON.stringify(await w.record.startSlice(s)), `session ${s}'s start slice after the rebuild`).toBe(slices.get(s));
    expect((await allEvents(w.record)).map((e) => `${e.log_pos}:${e.id}`), 'the rebuild leaves the log as it was').toEqual(logBefore);
    await w.record.close();
  }, 120_000);
});
