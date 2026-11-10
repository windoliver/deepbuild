// AC3 #1023.88d3d827: a planted adapter that leaves the session open fails the test, naming the session. The judge is
// AC1's and AC2's own (helpers.ts, judgeClosed: one session.end after the process ended, not a hook's, a reading saying
// so, and closed in `deep hub status` within 60 s), run on run 1 of fixtures/ctrl-c-ends.json: it must pass the shipped
// hub and fail the hub started with DEEP_HUB_PLANT=leaves-codex-session-open, naming the session.
import { afterEach, describe, expect, it } from 'vitest';
import { AC3, cleanup, endRun, hubWithSetup, judgeClosed, makeHome, PLANT, plantedHub, replayTurn, type Home, type Hub } from './helpers.ts';

afterEach(cleanup, 60_000);

async function judgedRun(h: Home, hub: Hub): Promise<{ id: string; problems: string[] }> {
  const rp = await replayTurn(h, 1);
  const at = await endRun(hub, rp);
  return { id: rp.t.id, problems: (await judgeClosed(hub, rp.t.id, at, { status: true })).problems };
}

describe(AC3, () => {
  it(`${AC3}: the judge passes the shipped hub on a Ctrl-C end with no SessionEnd, and fails the planted ${PLANT}, naming the session`, async () => {
    const h = makeHome();
    const shipped = await judgedRun(h, await hubWithSetup(h));
    expect(shipped.problems, `${AC3}: the shipped hub must close session ${shipped.id} as AC1 and AC2 ask, or the planted run below proves nothing:\n${shipped.problems.join('\n')}`).toEqual([]);
    await cleanup();
    const p = makeHome();
    const planted = await judgedRun(p, await plantedHub(p));
    expect(planted.problems.length, `${AC3}: with DEEP_HUB_PLANT=${PLANT} the judge must fail, since the planted adapter leaves session ${planted.id} open`).toBeGreaterThan(0);
    for (const problem of planted.problems) expect(problem, `${AC3}: each failure names the session left open`).toContain(planted.id);
  }, 300_000);
});
