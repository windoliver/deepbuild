// #45's scope items the blind suite doesn't name in a criterion: lifecycle numbers, failed calls, review wait, blocked time,
// approval wait, and pricing by exact model.
import { describe, expect, it } from 'vitest';
import { countTexts, lifecycleNumbers, readingsOf, recompute, type RecordEvent } from '../src/index.js';

const MIN = 60_000;
let n = 0;
const ev = (kind: string, ts: number, session: string | null, data: Record<string, unknown>, subject: string | null = null): RecordEvent => ({ id: `e${n++}`, kind, v: 1, ts, session, subject, data });
const find = (events: RecordEvent[], id: string, subject: string | null = null) => readingsOf(recompute(events)).find((r) => r.id === id && (subject === null || r.subject === subject));

describe('from the record', () => {
  it('counts failed calls by signature across sessions, and never a call that worked', () => {
    const events = [
      ev('tool.after', 1, 'A', { outcome: 'failed', signature: 'bash:npm-test' }),
      ev('tool.after', 2, 'B', { outcome: 'failed', signature: 'bash:npm-test' }),
      ev('tool.after', 3, 'B', { outcome: 'failed', signature: 'read:enoent' }),
      ev('tool.after', 4, 'B', { outcome: 'ok', signature: 'bash:npm-test' }),
    ];
    expect(find(events, 'failed_calls', 'bash:npm-test')?.value).toBe(2);
    expect(find(events, 'failed_calls', 'read:enoent')?.value).toBe(1);
  });

  it('review wait is the time from a stop to your next message, and an automatic prompt adds none', () => {
    const events = [
      ev('user.ask', 0, 'A', { msg: 1, text: 'go', tasks: [], from: 'person' }),
      ev('agent.stop', 1 * MIN, 'A', {}),
      ev('user.ask', 4 * MIN, 'A', { msg: 2, text: 'more', tasks: [], from: 'person' }),
      ev('agent.stop', 5 * MIN, 'A', {}),
      ev('user.ask', 6 * MIN, 'A', { msg: 3, text: 'next', tasks: [], from: 'continuation' }),
    ];
    expect(find(events, 'review.wait')?.value).toBe(3 * MIN);
  });

  it('blocked time runs from a BLOCKED verdict to the claim\'s next verdict, and one still blocked adds nothing yet', () => {
    const events = [
      ev('verdict.made', 0, null, { claim: 'claim:a', outcome: 'BLOCKED' }),
      ev('verdict.made', 7 * MIN, null, { claim: 'claim:a', outcome: 'PASS' }),
      ev('verdict.made', 8 * MIN, null, { claim: 'claim:b', outcome: 'BLOCKED' }),
    ];
    expect(find(events, 'blocked.time')?.value).toBe(7 * MIN);
  });

  it('approval wait is the median per kind of ask, from its asking to its answer', () => {
    const asked = (id: string, ts: number, kind: string, took: number) => [ev('ask.created', ts, null, { kind }, id), ev('ask.answered', ts + took, null, {}, id)];
    const events = [...asked('ask:a', 0, 'authority', 1 * MIN), ...asked('ask:b', 10, 'authority', 5 * MIN), ...asked('ask:c', 20, 'authority', 9 * MIN), ...asked('ask:d', 30, 'taste', 2 * MIN)];
    expect(find(events, 'approval.wait', 'authority')?.value).toBe(5 * MIN);
    expect(find(events, 'approval.wait', 'taste')?.value).toBe(2 * MIN);
  });
});

describe('lifecycle numbers', () => {
  const pr = (over: Partial<Parameters<typeof lifecycleNumbers>[1][number]>) => ({ number: 1, merged_at: 100 * MIN, issue_opened_at: 0, opened_at: 50 * MIN, reviews: [], ...over });
  const of = (prs: Parameters<typeof lifecycleNumbers>[1]) => Object.fromEntries(lifecycleNumbers('o/r', prs).map((x) => [x.reading, x.value]));

  it('reads issue to merge, first-pass share and first review', () => {
    const read = of([pr({}), pr({ merged_at: 200 * MIN, reviews: [{ at: 60 * MIN, state: 'CHANGES_REQUESTED' }, { at: 70 * MIN, state: 'APPROVED' }] })]);
    expect(read['reading:orissuetomerge']).toBe(100 * MIN);
    expect(read['reading:orfirstpass']).toBe(0.5);
    expect(read['reading:orfirstreview']).toBe(10 * MIN);
  });

  it('a number with nothing to count is missing, never zero', () => {
    expect(of([])).toEqual({});
    expect(Object.keys(of([pr({ issue_opened_at: null })]))).toEqual(['reading:orfirstpass']);
  });
});

describe('the shipped rate card', () => {
  const line = (model: string) => JSON.stringify({ type: 'assistant', message: { id: 'm', model, usage: { input_tokens: 1_000_000, output_tokens: 0 } } });
  const cost = (model: string) => countTexts([line(model)]).cost;

  it('prices a model by its own name or that name with a date, never by a shorter name it extends', () => {
    expect(cost('claude-opus-4-20250514')).toMatchObject({ basis: 'estimated', usd: 15 });
    expect(cost('claude-opus-4-6')).toMatchObject({ basis: 'estimated', usd: 5 });
    expect(cost('claude-opus-5-5')).toMatchObject({ basis: 'estimated', usd: 4 });
    expect(cost('claude-sonnet-5-6')).toEqual({ basis: 'unpriced' });
  });
});
