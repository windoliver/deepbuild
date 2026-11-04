// #45 AC12, AC13, AC14: held time, from stop.held@1, with the issue's and the design's numbers. A stop.held's ts is its reply.
import { describe, expect, it } from 'vitest';
import { budgetCost, heldTime } from '../../../packages/readings/src/index.ts';
import { ask, claimOf, finished, held, MINUTE, runOf, SECOND, started, T0 } from './events.ts';

const BUDGET = { budget_ms: 10_000 };

/** The issue's turn: 8 s (1 s snapshot and start, 7 s fast), sent back, 120 s of work, then 6 s (1 s, 1 s queue, 4 s fast). */
function oneTurn() {
  const prompt = ask('S12', T0);
  return {
    prompt,
    events: [
      prompt,
      held('S12', T0 + 8 * SECOND, { snapshot_start: 1000, fast: 7000 }),
      held('S12', T0 + 134 * SECOND, { snapshot_start: 1000, queue_wait: 1000, fast: 4000 }),
    ],
  };
}

describe('AC12 a turn\'s held time sums its stops', () => {
  it('#45.f68b8bc0 AC12 the turn reads 14 s, 2 s of snapshot and start, 1 s of queue wait and 11 s of fast-lane checks; from the first stop to the last reply reads 134 s and only the last stop reads 6 s, and each fails', () => {
    const { prompt, events } = oneTurn();
    const turn = heldTime(events, BUDGET).turns.find((t) => t.turn === prompt.id);
    expect(turn?.total_ms).toBe(14_000);
    expect(turn?.by).toEqual({ question: 0, slow: 0, fast: 11_000, snapshot_start: 2000, queue_wait: 1000 });
  });

  it('#45.f68b8bc0 AC12 the session\'s total counts it once: 14 s, with each stop\'s own hold beside it, and another session\'s hold apart', () => {
    const { events } = oneTurn();
    const read = heldTime([...events, ask('S12b', T0), held('S12b', T0 + 3 * SECOND, { fast: 3000 })], BUDGET);
    const session = read.sessions.find((s) => s.session === 'S12');
    expect(session?.total_ms).toBe(14_000);
    expect(session?.by.fast).toBe(11_000);
    expect(read.sessions.find((s) => s.session === 'S12b')?.total_ms).toBe(3000);
    expect(read.stops.filter((s) => s.session === 'S12').map((s) => s.total_ms)).toEqual([8000, 6000]);
  });
});

describe('AC13 held time per code-changing stop', () => {
  /** Ten stops held 4 s, an eleventh held 4 s and 30 s more as a slow hold, and fifty that changed nothing, held 20 ms. */
  function theSession() {
    const events = [ask('S13', T0)];
    let at = T0;
    for (let i = 0; i < 10; i++) events.push(held('S13', (at += MINUTE), { fast: 4000 }));
    events.push(held('S13', (at += MINUTE), { fast: 4000, slow: 30_000 }));
    for (let i = 0; i < 50; i++) events.push(held('S13', (at += MINUTE), { snapshot_start: 20, code_changing: false }));
    return events;
  }

  it('#45.6c13bfa7 AC13 it reads 4 s at p50 and p95, inside its band at a 10 s budget, with 30 s of slow hold apart; a reading over every stop, or one that adds the slow hold in, fails', () => {
    const reading = heldTime(theSession(), BUDGET).sessions.find((s) => s.session === 'S13')?.code_changing;
    expect(reading?.p50_ms, 'over every stop it would read 20 ms').toBe(4000);
    expect(reading?.p95_ms, 'with the slow hold in it would read 34 s').toBe(4000);
    expect(reading?.stops, 'the eleven that changed a check\'s inputs').toBe(11);
    expect(reading?.budget_ms).toBe(10_000);
    expect(reading?.band).toBe('inside');
    expect(reading?.slow_hold_ms).toBe(30_000);
  });

  it('#45.6c13bfa7 AC13 the budget is its band: twenty code-changing stops held 12 s read over a 10 s budget', () => {
    const events = [ask('S13o', T0), ...Array.from({ length: 20 }, (_, i) => held('S13o', T0 + (i + 1) * MINUTE, { fast: 12_000 }))];
    const reading = heldTime(events, BUDGET).sessions.find((s) => s.session === 'S13o')?.code_changing;
    expect(reading?.p95_ms).toBe(12_000);
    expect(reading?.band).toBe('over');
  });
});

describe('AC14 what the budget costs', () => {
  it('#45.0d7e6986 AC14 unit, left by the budget and failing twice after the reply, counts once, with the turn its FAIL started; a journey over the hold by its own time isn\'t counted, nor lint, which passed', () => {
    const c = claimOf('C14');
    const reply = T0 + 10 * SECOND;
    const next = ask('S14', reply + 300 * SECOND);
    const read = budgetCost([
      ask('S14', T0),
      held('S14', reply, { fast: 9000, claim: c, budget_cost: ['unit', 'lint'] }),
      started('S14', reply + 1, runOf('unit1'), 'unit', c),
      started('S14', reply + 2, runOf('lint1'), 'lint', c),
      started('S14', reply + 3, runOf('journey1'), 'journey', c),
      finished('S14', reply + 5 * SECOND, runOf('unit1'), 'unit', 'failed'),
      finished('S14', reply + 6 * SECOND, runOf('lint1'), 'lint', 'passed'),
      started('S14', reply + 7 * SECOND, runOf('unit2'), 'unit', c),
      finished('S14', reply + 9 * SECOND, runOf('unit2'), 'unit', 'failed'),
      finished('S14', reply + 200 * SECOND, runOf('journey1'), 'journey', 'failed'),
      next,
    ]);
    expect(read.left, 'unit and lint: the checks the budget left that the hold alone would have run').toBe(2);
    expect(read.failed_after_reply, 'unit, once; not the journey').toBe(1);
    expect(read.items).toEqual([{ check: 'unit', claim: c, turn_started: next.id }]);
  });
});
