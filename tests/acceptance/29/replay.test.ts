// #29 AC24, AC32 and AC41: the replay of 30 recorded sessions, a stop every 20 s, each stop's checks taking 5 to 90 s by
// their recorded runs, on a controlled clock (the check slots are half the cores: 6 on a 12-core reference Mac, 4 on an
// 8-core one). The seed is recorded in h-c.ts (AC29_SEED replays another).
import { describe, expect, it } from 'vitest';
import { simulate, type SchedulerPlant } from '../../../packages/gate/src/index.ts';
import { mustFail } from './helpers.ts';
import { auditHolds, auditQueue, auditRecords, replay, SEED, SESSIONS } from './h-c.ts';

const clean = (list: string[], what: string) => expect(list, `${what}: first violation ${list[0]}`).toEqual([]);

describe.each([6, 4])('replay of 30 recorded sessions on %i check slots', (slots) => {
  const sc = replay(SEED, slots);
  const run = (plant?: SchedulerPlant) => simulate(sc, plant ? { plant } : {});

  const ac24 = (plant?: SchedulerPlant) => {
    const t = run(plant);
    expect(t.stops.length, 'every stop replied').toBe(sc.sessions.reduce((n, s) => n + s.events.filter((e) => e.kind === 'stop').length, 0));
    const a = auditHolds(t);
    clean(a.holds, `stop ${a.holds[0]?.split(' ')[0]} held past its 60 s or the agent's Stop timeout`);
    clean(a.lines, 'every hold replies with a verdict line or a line naming each queued or running check and its expected time');
  };
  it(`AC24 (${slots} slots) every hold replies within 60 s with a verdict line or a line naming what still runs, none cut off by the Stop timeout`, () => {
    expect(sc.sessions.length).toBe(SESSIONS);
    ac24();
  });
  it(`AC24 (${slots} slots) a runner that sizes the fast lane by each check's own time alone holds stops past 60 s and fails, naming the first stop`, async () => {
    const bad = auditHolds(run('hold-sized-by-own-time')).holds;
    expect(bad.length, 'the planted runner must hold some stop past 60 s in this replay').toBeGreaterThan(0);
    await mustFail('hold-sized-by-own-time', () => ac24('hold-sized-by-own-time'), [bad[0]!.split(' ')[0]!]);
  });

  const ac32 = (plant?: SchedulerPlant) => {
    const t = run(plant);
    const a = auditQueue(t, sc);
    clean(a.stopped, 'a run in flight was stopped');
    clean(a.overlap, 'a check has more than one snapshot running or queued for one ask');
    clean(a.late, 'a slow run started on a snapshot it must not');
    expect(t.runs.some((r) => r.lane === 'slow'), 'the replay exercises the slow lane').toBe(true);
  };
  it(`AC32 (${slots} slots) no run in flight is stopped, no check has more than one snapshot running and one queued, no slow run starts on a failed, kept-working or outdated snapshot`, () => ac32());
  for (const plant of ['queues-every-green-snapshot', 'starts-on-every-green-stop'] as const) {
    it(`AC32 (${slots} slots) a runner that queues every stop's run (${plant}) starts runs on such snapshots and fails, naming the first`, async () => {
      const bad = auditQueue(run(plant), sc).late;
      expect(bad.length, 'the planted runner must start a slow run on such a snapshot in this replay').toBeGreaterThan(0);
      await mustFail(plant, () => ac32(plant), [bad[0]!.split(':')[0]!]);
    });
  }

  const ac41 = (plant?: SchedulerPlant) => {
    const t = run(plant);
    expect(t.runs.length).toBeGreaterThan(0);
    const bad = auditRecords(t, sc);
    clean(bad, 'every run records host local, the needs its check declared and its expected time');
  };
  it(`AC41 (${slots} slots) every run records host local and needs equal to what its check declared, with its expected time`, () => ac41());
  it(`AC41 (${slots} slots) a runner that leaves the host empty fails, naming the run`, async () => {
    const t = run('leaves-host-empty');
    const bad = auditRecords(t, sc);
    expect(bad.length).toBeGreaterThan(0);
    await mustFail('leaves-host-empty', () => ac41('leaves-host-empty'), [bad[0]!.split(':')[0]!]);
  });
});
