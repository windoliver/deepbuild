// AC1 #1023.f4fb4c83: the three Ctrl-C ends of fixtures/ctrl-c-ends.json, each a Codex CLI process of its own on one
// real hub, are each read as the session's end: run 2's one session.end carries its SessionEnd's reason, "other"; runs 1
// and 3, which fired no SessionEnd, are each closed once by the hub after their process ends, with a reading saying so;
// and no session ends while its own process still runs.
import { afterEach, describe, expect, it } from 'vitest';
import { AC1, allEvents, cleanup, endProblems, endRun, hubWithSetup, judgeClosed, makeHome, ofSession, replayTurn, sleep, type Replay } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(AC1, () => {
  it(`${AC1}: three Ctrl-C ends replayed: one session.end each; run 2's reason "other" from its payload; runs 1 and 3 closed by the hub from their process's exit, with a reading saying Codex fired no SessionEnd`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const runs: Replay[] = [];
    for (const n of [1, 2, 3]) runs.push(await replayTurn(h, n));
    const problems: string[] = [];
    for (const rp of runs) {
      const at = await endRun(hub, rp);
      if (!rp.firesSessionEnd) problems.push(...(await judgeClosed(hub, rp.t.id, at, { status: false })).problems.map((p) => `run ${rp.run}, ${p}`));
      const events = await allEvents(hub);
      // A process's exit ends only the sessions it ran: the runs still going stay open.
      for (const later of runs.filter((x) => x.run > rp.run)) {
        const ends = ofSession(events, later.t.id, 'session.end');
        if (ends.length) problems.push(`run ${later.run}, session ${later.t.id}: a session.end is on record while its process (pid ${later.cli.pid}) still runs, after run ${rp.run}'s process ended`);
      }
    }
    // Every end has had its chance to land twice: run 2's process ended after its SessionEnd, and must add no second end.
    await sleep(3000);
    const events = await allEvents(hub);
    const two = runs[1]!;
    problems.push(...endProblems(events, two.t.id, { reason: 'other' }).map((p) => `run 2, ${p}`));
    for (const rp of [runs[0]!, runs[2]!]) {
      const ends = ofSession(events, rp.t.id, 'session.end');
      if (ends.length > 1) problems.push(`run ${rp.run}, session ${rp.t.id}: ${ends.length} session.end on record, not one`);
    }
    expect(problems, `${AC1}: each Ctrl-C end must be read as the session's end, once:\n${problems.join('\n')}`).toEqual([]);
  }, 300_000);
});
