// #45 AC9: 30 days of readings recompute in under 10 s and update incrementally in under 1 s, judged by the design's rule for
// timing results (five runs after a warm-up), and only on a reference Mac on mains power; anywhere else each timed test skips
// as INCONCLUSIVE, never passes. That an update gives the same readings as a recompute holds on any machine.
// The merge base has no readings, so the merge-base comparison is the perf lane's (perf-lane.test.ts).
import { describe, expect, it } from 'vitest';
import { readingsOf, recompute, update, type Reading, type RecordEvent } from '../../../packages/readings/src/index.ts';
import { environmentProblem, judge } from '../26/helpers.ts';
import { ask, DAY, held, MINUTE, T0, usage } from './events.ts';

/** A heavy session: ten turns, each with a prompt, a stop and its usage. */
function session(name: string, start: number): RecordEvent[] {
  const out: RecordEvent[] = [];
  for (let t = 0; t < 10; t++) {
    const at = start + t * MINUTE;
    out.push(ask(name, at), held(name, at + 30_000, { fast: 3000, snapshot_start: 500 }), usage(name, at + 31_000, `msg_${name}_${t}`, { input: 1000, output: 200 }, { basis: 'estimated', usd: 0.01, rate_card: 'card' }));
  }
  return out;
}
/** A heavy month, as #26's budget has it: 30 days of 20 sessions, 18,000 events. */
const month = (): RecordEvent[] => Array.from({ length: 30 }, (_, d) => Array.from({ length: 20 }, (_, s) => session(`D${d}S${s}`, T0 + d * DAY + s * 30 * MINUTE))).flat(2);
const sorted = (readings: Reading[]): Reading[] => [...readings].sort((a, b) => `${a.id} ${a.subject}`.localeCompare(`${b.id} ${b.subject}`));
const FIVE = [0, 1, 2, 3, 4];

describe('AC9 budgets', () => {
  it('#45.d0a882a2 AC9 an update over a new session gives exactly the readings a recompute over everything gives, and they differ from the readings before it', () => {
    const before = month().slice(0, 300);
    const fresh = session('New', T0 + 40 * DAY);
    const updated = sorted(readingsOf(update(recompute(before), fresh)));
    expect(updated).toEqual(sorted(readingsOf(recompute([...before, ...fresh]))));
    expect(updated, 'the new session shows').not.toEqual(sorted(readingsOf(recompute(before))));
  });

  it('#45.d0a882a2 AC9 30 days of readings recompute in under 10 s on the reference Mac', (ctx) => {
    const events = month();
    const problem = environmentProblem();
    if (problem) { ctx.skip(`INCONCLUSIVE ${problem}: a budget counts only on a reference Mac on mains power`); return; }
    recompute(events); // warm-up
    const runs = FIVE.map(() => { const t0 = performance.now(); readingsOf(recompute(events)); return performance.now() - t0; });
    judge(ctx, 'AC9 recompute 30 days (ms)', runs, 10_000);
  }, 300_000);

  it('#45.d0a882a2 AC9 readings update incrementally in under 1 s on the reference Mac, over a month already read', (ctx) => {
    const state = recompute(month());
    const problem = environmentProblem();
    if (problem) { ctx.skip(`INCONCLUSIVE ${problem}: a budget counts only on a reference Mac on mains power`); return; }
    update(state, session('Warm', T0 + 40 * DAY)); // warm-up
    const runs = FIVE.map((i) => { const fresh = session(`N${i}`, T0 + (41 + i) * DAY); const t0 = performance.now(); readingsOf(update(state, fresh)); return performance.now() - t0; });
    judge(ctx, 'AC9 update over one new session (ms)', runs, 1000);
  }, 300_000);
});
