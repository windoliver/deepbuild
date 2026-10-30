// #29 AC35: each stop's held time, recorded and split by why, the parts summing to the hold (README, rule 10).
import { describe, expect, it } from 'vitest';
import { simulate, type SchedulerPlant } from '../../../packages/gate/src/index.ts';
import { check, edit, mustFail, prompt, script, stop, stopOf, sum, MINUTE } from './helpers.ts';

const ids = (s: ReturnType<typeof stopOf>) => `stop ${s.stop}`;
function ac35(plant?: SchedulerPlant) {
  const opts = plant ? { plant } : {};
  // 1. held 8 s, checkout ready at 1 s, fast-lane checks run until 8 s.
  const a = simulate({ config: { slots: 2 }, sessions: [script('A', 'claude', [check('c', 7000, { inputs: ['src/**'] })], [prompt(0), edit(0, 'S1'), stop(0, 'S1', { checkout_ms: 1000, id: 'held8' })])] }, opts);
  const sa = stopOf(a, 'A', 1);
  expect(sa.held, `${ids(sa)}: held 8 s, 1 s of snapshot and start and 7 s of fast-lane checks`).toEqual({ total: 8000, question: 0, slow: 0, fast: 7000, snapshot_start: 1000, queue_wait: 0 });
  // 2. checks that wait 1 s for slots another session holds.
  const b = simulate({ config: { slots: 1 }, foreign: [{ at: 0, ms: 1000, slots: 1 }], sessions: [script('B', 'claude', [check('c', 3000, { inputs: ['src/**'] })], [prompt(0), edit(0, 'S1'), stop(0, 'S1', { id: 'queued1' })])] }, opts);
  const sb = stopOf(b, 'B', 1);
  expect(sb.held, `${ids(sb)}: the second it waits for a slot another session holds is queue wait`).toEqual({ total: 4000, question: 0, slow: 0, fast: 3000, snapshot_start: 0, queue_wait: 1000 });
  // 3. an observed Codex stop held 30 s past its fast-lane checks for its journey.
  const c = simulate({ config: { slots: 2, stop_timeout_ms: 45 * MINUTE }, sessions: [script('C', 'codex-observed', [check('unit', 2000, { inputs: ['src/**'] }), check('journey:checkout', 30_000, { inputs: ['src/**'], deadline_ms: 30_000 })], [prompt(0), edit(0, 'S1'), stop(0, 'S1', { id: 'codex30' })])] }, opts);
  const sc = stopOf(c, 'C', 1);
  expect(sc.held, `${ids(sc)}: those 30 s are a slow hold`).toEqual({ total: 32_000, question: 0, slow: 30_000, fast: 2000, snapshot_start: 0, queue_wait: 0 });
  // 4. a stop whose send-back a question holds: its whole hold is a question hold.
  const d = simulate({ config: { slots: 2 }, sessions: [script('D', 'claude', [check('unit', 3000, { inputs: ['src/**'], ends: 'failed' })], [prompt(0), edit(0, 'S1'), stop(0, 'S1', { sorted: 'question_holds', id: 'question3' })])] }, opts);
  const sd = stopOf(d, 'D', 1);
  expect(sd.kind, `${ids(sd)}: the question holds the send-back`).toBe('question_holds');
  expect(sd.held, `${ids(sd)}: the whole hold is a question hold`).toEqual({ total: 3000, question: 3000, slow: 0, fast: 0, snapshot_start: 0, queue_wait: 0 });
  for (const s of [sa, sb, sc, sd]) expect(sum(s.held), `${ids(s)}: the parts sum to the hold`).toBe(s.held.total);
  for (const s of [sa, sb, sc, sd]) expect(s.held.total, `${ids(s)}: the hold is from the Stop hook's request to its reply`).toBe(s.reply_at - s.at);
}
describe('AC35 held time is recorded and split by why', () => {
  it('AC35 snapshot and start, fast-lane checks, queue wait, a slow hold and a question hold, each moment under the first reason that applies', () => ac35());
  it('AC35 a runner that records only the hold\'s length fails, naming the stop', () => mustFail('holds-only-the-hold-length', () => ac35('holds-only-the-hold-length'), ['stop ']));
  it('AC35 a runner that puts one moment under two reasons fails, naming the stop', () => mustFail('one-reason-per-record', () => ac35('one-reason-per-record'), ['stop ']));

  it('AC35 a stop whose snapshot changed no check\'s inputs is not code-changing, reuses results and is held for its validity gate alone', () => {
    const t = simulate({ config: { slots: 2 }, sessions: [script('E', 'claude', [check('c', 3000, { inputs: ['src/**'] })], [
      prompt(0), edit(0, 'S1'), stop(0, 'S1', { id: 'first' }), prompt(20_000), stop(20_000, 'S1', { changed: [], id: 'again' })])] });
    const [first, again] = [stopOf(t, 'E', 1), stopOf(t, 'E', 2)];
    expect(first.code_changing).toBe(true);
    expect(again.code_changing).toBe(false);
    expect(again.admitted, 'runs nothing').toEqual([]);
    expect(t.runs.length, 'no second run').toBe(1);
    expect(again.held.fast + again.held.slow + again.held.queue_wait, 'only its validity gate holds it').toBe(0);
    expect(sum(again.held)).toBe(again.held.total);
  });
  it('AC35 the checks the budget left to the slow lane that the hold alone would have run are recorded', () => {
    const t = simulate({ config: { slots: 2 }, sessions: [script('F', 'claude', [
      check('typecheck', 15_000, { inputs: ['src/**'] }), check('journey:checkout', 300_000, { inputs: ['src/**'] })], [prompt(0), edit(0, 'S1'), stop(0, 'S1')])] });
    const s = stopOf(t, 'F', 1);
    expect(new Set(s.slow)).toEqual(new Set(['typecheck', 'journey:checkout']));
    expect(s.budget_cost, 'typecheck would end inside the 60 s hold; the journey would not').toEqual(['typecheck']);
  });
});
