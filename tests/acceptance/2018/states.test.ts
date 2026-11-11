// AC2 #2018.2b9628d8: a generated test over random event sequences finds exactly one state for every session, the same
// after a hub restart and after a replay to the same log_pos; a session with an open ask and a stale verdict reads
// needs you on every surface; and a fixture BLOCKED session whose unblock task defaulted reads "BLOCKED · waits for
// <owner>: <evidence>", a bare BLOCKED failing, naming the row.
//
// The generated worlds are records seeded through the real record and asks core, each read by a real hub: live, from its
// database once it stops, after the record's own replay of the log on a copy (`rebuild`), and after a restart. One
// state is one row of the issue's table of fourteen, with its status-map entry; and where the issue and the design leave
// no room on which row a walk's facts match first, that row (helpers.ts, `expected`; README, Pinned 2).
import fc from 'fast-check';
import { afterAll, describe, expect, test } from 'vitest';
import {
  allEvents, atOneLogPos, blockedFailures, blockedRowFailures, blockOf, byId, cleanup, control, deep, EVIDENCE, ID, linesWith, mainWorld, makeWorld, MIN, needsYouFailures, none, OWNER,
  type Plan, readingOf, replayed, restart, rowOf, sameFailures, seedPlans, stateFailures, statusRows, type Step, STEPS, stopHub, STALE_ASK, tableFailures, TITLES, wordsOf, type World,
} from './helpers.ts';

afterAll(cleanup, 120_000);

// ---- The generator: each session a walk over the events a record holds of one (helpers.ts, `seedPlans`). Half the
// walks are any steps at all; half end on a claim and what follows one (its verdict, the verdict going stale, a
// send-back, asks), after any steps at all, so every world holds sessions in the rows a verdict gives.

const any: fc.Arbitrary<Step[]> = fc.array(fc.constantFrom(...STEPS), { maxLength: 9 });
const claimed: fc.Arbitrary<Step[]> = fc.tuple(
  fc.array(fc.constantFrom(...STEPS), { maxLength: 5 }),
  fc.array(fc.constantFrom<Step>('PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'stale', 'sentBack', 'ask', 'moot'), { maxLength: 3 }),
).map(([before, after]): Step[] => [...before, 'claim', ...after]);
const plan: fc.Arbitrary<Plan> = fc.record({ old: fc.boolean(), steps: fc.oneof(any, claimed) });
/** Bounded shrinking: each case starts real hubs, so a failing world is shrunk a few steps, never to exhaustion. */
const worlds = fc.limitShrink(fc.array(plan, { minLength: 5, maxLength: 8 }), 4);
/** The seed every run of this suite draws its worlds from, and how many worlds. */
const SEED = 2018;
const RUNS = 6;
const REPOS = ['shop', 'docs', 'search'] as const;
/** How many sessions, over the run, the table's first matching row was held to. */
let judged = 0;

/** What's wrong with one generated world: a state for every session, the same from the database, after a replay and after a restart. */
async function worldFailures(plans: readonly Plan[]): Promise<string[]> {
  const w = await makeWorld({ repos: REPOS, seed: (s, T) => seedPlans(s, T, plans, REPOS), frozen: true });
  try {
    const ids = plans.map((_, i) => w.sessions[`s${i}`]!.id);
    const live = await statusRows(w);
    const conn = await control(w.hub);
    const first = tableFailures(live.rows, plans, ids, await allEvents(conn).finally(() => conn.close()), 'deep status --json');
    judged += first.judged;
    await stopHub(w.hub);
    const down = await statusRows(w, { down: true });
    const again = await replayed(w);
    await restart(w);
    const after = await statusRows(w);
    const failures = [
      ...stateFailures(live.rows, ids, 'deep status --json'),
      ...first.failures,
      ...sameFailures(live.rows, down.rows, ids, 'with the hub up', `from its database at log_pos ${down.log_pos}`),
      ...(again.log_pos === down.log_pos ? [] : [`the replay of the log stands at log_pos ${again.log_pos}, not the record's ${down.log_pos}`]),
      ...sameFailures(down.rows, again.rows, ids, `at log_pos ${down.log_pos}`, 'after a replay to that log_pos'),
      ...stateFailures(after.rows, ids, 'deep status --json after a hub restart'),
      ...sameFailures(live.rows, after.rows, ids, 'before a hub restart', 'after it'),
    ];
    // Each failure names its session; the walk that made it goes beside it.
    return failures.map((f) => { const i = ids.findIndex((id) => f.includes(id)); return i < 0 ? f : `${f} [its events: ${plans[i]!.old ? 'three days old: ' : ''}${plans[i]!.steps.join(', ') || 'a start alone'}]`; });
  } finally {
    await stopHub(w.hub);
  }
}

let made: Promise<World> | undefined;
const world = (): Promise<World> => (made ??= mainWorld());

describe(ID.states, () => {
  test(`${ID.states}: a generated test over random event sequences finds exactly one state for every session, the same after a hub restart and after a replay to the same log_pos (seed ${SEED}, ${RUNS} worlds)`, async () => {
    await fc.assert(fc.asyncProperty(worlds, async (plans) => {
      none(await worldFailures(plans), 'every session of a generated record');
    }), { seed: SEED, numRuns: RUNS });
    // Reached only when every world passed: the table's order was held to sessions, not left to none.
    console.log(`the generated worlds: ${judged} sessions held to the table's first matching row`);
    expect(judged, `the sessions of ${RUNS} generated worlds whose record held only what their walk appended, and whose row the issue leaves no room on`).toBeGreaterThanOrEqual(RUNS);
  }, 60 * MIN);

  test(`${ID.states}: a session with an open ask and a stale verdict reads needs you on every surface`, async () => {
    const w = await world();
    const s = w.sessions.needs!;
    const title = TITLES.needs;
    expect(w.asks.some((a) => a.question === STALE_ASK && a.session === s.id), 'the fixture session has its open ask').toBe(true);
    const out: string[] = [];
    const line = (text: string): string => linesWith(text, title).join('\n');
    const { r, seen, status } = await atOneLogPos(w);
    try {
      const row = rowOf(status.rows, s.id);
      if (row?.word !== 'needs you' || row.entry !== 'needs_you') out.push(`deep status --json reads ${JSON.stringify([row?.word, row?.entry])} for session ${s.id}, not needs you`);
      out.push(...needsYouFailures('deep status line', line((await deep(w, ['status'])).stdout), s.id, 'stale'));
      out.push(...needsYouFailures('deep line', line((await deep(w, [])).stdout), s.id, 'stale'));
      const app = rowOf(seen.rows, s.id);
      if (app?.word !== 'needs you') out.push(`the app's list reads ${JSON.stringify(app?.word)} for session ${s.id}, not needs you`);
      out.push(...needsYouFailures('sidebar row', wordsOf(seen.snapshot, byId(seen.snapshot, `session:${s.id}`)), s.id, 'stale'));
      const slot = byId(seen.snapshot, `session:${s.id}:word`)?.name;
      if (slot !== 'needs you') out.push(`the sidebar row's state word reads ${JSON.stringify(slot)} for session ${s.id}, not needs you`);
      out.push(...needsYouFailures('menu bar', (seen.snapshot.menu_bar?.items ?? []).filter((l) => l.includes(title)).join('\n'), s.id, 'stale'));
      await r.open(`session/${s.id}`);
      await r.wait(300);
      const page = await r.see();
      out.push(...needsYouFailures('session page', wordsOf(page.snapshot, byId(page.snapshot, `session/${s.id}`)), s.id));
      await r.wait(3000);
      const posted = (await r.close()).filter((p) => p.session === s.id);
      out.push(...needsYouFailures('notification', posted.map((p) => p.text).join('\n'), s.id, 'stale'));
    } finally {
      await r.stop();
    }
    none(out, 'each surface, for the session with an open ask and a stale verdict');
  }, 30 * MIN);

  test(`${ID.states}: a planted table that tries stale before an open ask fails, naming the surface`, async () => {
    const w = await world();
    const s = w.sessions.needs!;
    const row = rowOf((await statusRows(w, { plant: 'stale-before-ask' })).rows, s.id);
    const text = (await deep(w, ['status'], 'stale-before-ask')).stdout;
    const failures = [
      ...(row?.word === 'needs you' ? [] : [`the deep status --json row reads ${JSON.stringify(row?.word ?? 'no row')} for session ${s.id}, not needs you`]),
      ...needsYouFailures('deep status line', linesWith(text, TITLES.needs).join('\n'), s.id, 'stale'),
    ];
    expect(['the deep status --json row reads ', 'the deep status line reads '].filter((surface) => failures.some((f) => f.startsWith(surface))).length, `DEEP_HUB_PLANT=stale-before-ask must fail naming the surface, deep status's line and its --json row: ${JSON.stringify(failures)}`).toBe(2);
  }, 30 * MIN);

  test(`${ID.states}: a fixture BLOCKED session whose unblock task defaulted reads "BLOCKED · waits for <owner>: <evidence>"`, async () => {
    const w = await world();
    const s = w.sessions.blocked!;
    const id = `session:${s.id}`;
    const out: string[] = [];
    const { r, seen, status } = await atOneLogPos(w);
    try {
      expect(status.rows.some((x) => x.id.startsWith('ask:') && x.session === s.id), 'the unblock task took its default, so the session has no open ask').toBe(false);
      out.push(...blockedRowFailures(rowOf(status.rows, s.id), id, OWNER, EVIDENCE));
      out.push(...blockedFailures(blockOf((await deep(w, ['status'])).stdout, TITLES.blocked), id, OWNER, EVIDENCE, 'deep status'));
      out.push(...blockedFailures(readingOf(byId(seen.snapshot, id), `BLOCKED · waits for ${OWNER}: ${EVIDENCE}`), id, OWNER, EVIDENCE, "the app's list"));
    } finally {
      await r.stop();
    }
    none(out, `the BLOCKED row reads "BLOCKED · waits for ${OWNER}: ${EVIDENCE}"`);
  }, 30 * MIN);

  test(`${ID.states}: a bare BLOCKED fails, naming the row`, async () => {
    const w = await world();
    const s = w.sessions.blocked!;
    const id = `session:${s.id}`;
    const planted = await statusRows(w, { plant: 'blocked-bare' });
    const text = blockOf((await deep(w, ['status'], 'blocked-bare')).stdout, TITLES.blocked);
    const failures = [...blockedRowFailures(rowOf(planted.rows, s.id), id, OWNER, EVIDENCE), ...blockedFailures(text, id, OWNER, EVIDENCE, 'deep status')];
    expect(failures.filter((f) => f.startsWith(`row ${id} reads a bare BLOCKED`)).length, `DEEP_HUB_PLANT=blocked-bare must fail naming the row, in deep status and in its --json: ${JSON.stringify(failures)}`).toBe(2);
  }, 30 * MIN);
});
