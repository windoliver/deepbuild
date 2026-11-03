// #874 AC1 #874.b1e77128: through a real hub, in an empty repo, a drafted check that declares a surface runs on the base
// against a stand-in, and the record holds its hash. The drafted check for a new `GET /health` declares the service
// surface it enters through; the agent writes the app; the stop's claim runs the check on its snapshot (it passes) and,
// a fix check, on the base, an empty root commit with no start command. There the check must reach the stand-in, the
// service #31's service builds from its one fixed form, answering 200 and `{}`, and fail at its named
// `assert.deepEqual` for `{"status":"ok"}`; and R1's `stand_in` in the record must hold the hash #31's service returns
// for that stand-in. Planted wrong programs: a hub that never carries the surface to the base checkout, and one that
// builds the stand-in but records no hash.
import { describe, expect, it } from 'vitest';
import { AC1, baseRuns, CHECK, claimThroughHub, mustFail, standInHash31, standInOf, SURFACE, type Claimed } from './helpers.ts';

async function judge(c: Claimed): Promise<void> {
  const base = baseRuns(c);
  expect(base.length, `${CHECK} must run on the base, the empty root commit: its runs saw ${JSON.stringify(c.seen)}`).toBeGreaterThan(0);
  for (const n of base) {
    expect(n.cwd, 'the base run is in a temporary checkout, never your worktree').not.toBe(c.w.repo);
    expect({ status: n.status, body: n.body, error: n.error }, `${CHECK} on the base must reach the stand-in of its declared surface, a service answering 200 and {} (it saw ${JSON.stringify(n)})`)
      .toEqual({ status: 200, body: '{}', error: null });
  }
  const standIn = standInOf(c);
  const defs = c.events.filter((e) => e.kind.startsWith('definition.') && e.data.task_ref === c.task).map((e) => `${e.kind} ${JSON.stringify(e.data.requirements)}`);
  expect(standIn, `the record must hold R1's stand_in: the task's definition events are ${defs.join('; ').slice(0, 1500)}`).toBeDefined();
  expect(standIn!.hash, 'R1\'s stand_in hash must be the hash #31\'s service returns for the stand-in of GET /health').toBe(await standInHash31());
  expect(standIn!.surface, 'R1\'s stand_in names the surface the check enters through').toMatchObject(SURFACE);
}

describe(`AC1 ${AC1} through a real hub, in an empty repo, a drafted check that declares a surface runs on the base against a stand-in, and the record holds its hash`, () => {
  it('AC1 the check for GET /health fails on the stand-in\'s {} on the base, and R1\'s stand_in holds the stand-in\'s hash', async () => {
    await judge(await claimThroughHub('empty', 'body'));
  }, 300_000);

  it('AC1 (wrong program) a hub that never carries the declared surface to the base checkout fails this test, naming the stand-in', async () => {
    const c = await claimThroughHub('empty', 'body', 'stand-in-surface-dropped');
    await mustFail('stand-in-surface-dropped', () => judge(c), ['must reach the stand-in']);
  }, 300_000);

  it('AC1 (wrong program) a hub that builds the stand-in but records no hash fails this test, naming stand_in', async () => {
    const c = await claimThroughHub('empty', 'body', 'stand-in-unrecorded');
    await mustFail('stand-in-unrecorded', () => judge(c), ['stand_in']);
  }, 300_000);
});
