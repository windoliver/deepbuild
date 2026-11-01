// #45 AC15, AC16: per session, the slow-lane runs that ended stale and the checks held for a loop, on the record facts the
// README defines (run.stale@1, check.held@1, check.held_start@1).
import { describe, expect, it } from 'vitest';
import { loopHolds, staleRuns } from '../../../packages/readings/src/index.ts';
import { ask, claimOf, DAY, finished, held, heldPlace, heldStart, runOf, SECOND, stale, started, T0 } from './events.ts';

describe('AC15 slow-lane runs that ended stale', () => {
  /** S15 runs across midnight UTC: the first journey ends stale on one day, the second on the next. S15b has one more. */
  function world() {
    const dayOne = T0 + 11 * 3600 * SECOND; // 23:00 UTC
    const replyA = dayOne + 10 * SECOND;
    const dayTwo = T0 + DAY;
    const replyB = dayTwo + 10 * SECOND;
    return [
      // You begin the turn; its stop starts the journey; you type again 20 s after the reply.
      ask('S15', dayOne, 'person'),
      held('S15', replyA, { fast: 5000, claim: claimOf('A') }),
      started('S15', replyA + 1, runOf('a'), 'journey', claimOf('A')),
      ask('S15', replyA + 20 * SECOND, 'person'),
      finished('S15', replyA + 300 * SECOND, runOf('a'), 'journey', 'passed'),
      stale('S15', replyA + 300 * SECOND, runOf('a'), 'journey', claimOf('A'), claimOf('A2')),
      // A goal's turn; the journey starts when the grace window ends, 60 s after the reply; the continuation comes at 90 s.
      ask('S15', dayTwo, 'continuation'),
      held('S15', replyB, { fast: 5000, claim: claimOf('B') }),
      started('S15', replyB + 60 * SECOND, runOf('b'), 'journey', claimOf('B')),
      ask('S15', replyB + 90 * SECOND, 'continuation'),
      finished('S15', replyB + 360 * SECOND, runOf('b'), 'journey', 'passed'),
      stale('S15', replyB + 360 * SECOND, runOf('b'), 'journey', claimOf('B'), claimOf('B2')),
      // Another session, on the first day.
      ask('S15b', dayOne, 'person'),
      held('S15b', replyA, { fast: 5000, claim: claimOf('C') }),
      started('S15b', replyA + 1, runOf('c'), 'journey', claimOf('C')),
      ask('S15b', replyA + 45 * SECOND, 'app'),
      stale('S15b', replyA + 300 * SECOND, runOf('c'), 'journey', claimOf('C'), claimOf('C2')),
    ];
  }

  it('#45.767e60da AC15 the session reads 2 stale runs, one outdated by person at 20 s, within 30 s of its stop, and one by continuation at 90 s', () => {
    const session = staleRuns(world()).sessions.find((s) => s.session === 'S15');
    expect(session?.count, 'per session, across its two days').toBe(2);
    expect(session?.within_30s).toBe(1);
    expect(session?.runs.map((r) => ({ run: r.run, outdated_by: r.outdated_by, after_ms: r.after_ms }))).toEqual([
      { run: runOf('a'), outdated_by: 'person', after_ms: 20_000 },
      { run: runOf('b'), outdated_by: 'continuation', after_ms: 90_000 },
    ]);
  });

  it('#45.767e60da AC15 another session keeps its own count, by what outdated it: 1, by app at 45 s, outside the 30 s', () => {
    const session = staleRuns(world()).sessions.find((s) => s.session === 'S15b');
    expect(session?.count).toBe(1);
    expect(session?.within_30s).toBe(0);
    expect(session?.runs[0]?.outdated_by).toBe('app');
    expect(session?.runs[0]?.after_ms).toBe(45_000);
  });
});

describe('AC16 checks held for a loop', () => {
  it('#45.5f772137 AC16 held through three goal turns, each newer snapshot taking its place, and started at the goal\'s end: three places taken, three runs saved, one start, by the loop\'s pause, 45 s from its own stop; counting the places as runs fails', () => {
    const at = (n: number) => T0 + n * 60 * SECOND;
    const claims = [claimOf('L0'), claimOf('L1'), claimOf('L2'), claimOf('L3')];
    const read = loopHolds([
      ask('S16', at(0) - SECOND, 'continuation'),
      held('S16', at(0), { fast: 2000, claim: claims[0]! }),
      heldPlace('S16', at(0), 'journey', claims[0]!, null),
      ask('S16', at(1) - SECOND, 'continuation'),
      held('S16', at(1), { fast: 2000, claim: claims[1]! }),
      heldPlace('S16', at(1), 'journey', claims[1]!, claims[0]!),
      ask('S16', at(2) - SECOND, 'continuation'),
      held('S16', at(2), { fast: 2000, claim: claims[2]! }),
      heldPlace('S16', at(2), 'journey', claims[2]!, claims[1]!),
      ask('S16', at(3) - SECOND, 'continuation'),
      held('S16', at(3), { fast: 2000, claim: claims[3]! }),
      heldPlace('S16', at(3), 'journey', claims[3]!, claims[2]!),
      heldStart('S16', at(3) + 45 * SECOND, 'journey', claims[3]!, 'pause'),
      started('S16', at(3) + 45 * SECOND, runOf('j'), 'journey', claims[3]!),
    ]);
    const session = read.sessions.find((s) => s.session === 'S16');
    expect(session?.places_taken).toBe(3);
    expect(session?.runs_saved).toBe(3);
    expect(session?.runs_started, 'the held places never ran').toBe(1);
    expect(session?.starts).toEqual([{ check: 'journey', claim: claims[3], by: 'pause', waited_ms: 45_000 }]);
  });
});
