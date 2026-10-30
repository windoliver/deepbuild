// #45's scope items the blind suite doesn't name in a criterion: lifecycle numbers, failed calls, review wait, blocked time,
// approval wait, and pricing by exact model.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { countTexts, lifecycleNumbers, planWindowTokens, readingsOf, recompute, recomputeBaseline, staleRuns, type RecordEvent } from '../src/index.js';

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

describe('spend from the record', () => {
  const usage = (ts: number, turn: string, input: number, cost: object, covers = 'turn') => ev('turn.usage', ts, 'A', { turn, model: 'm', covers, tokens: { input, cached: 0, output: 0, exact: true }, cost });
  const person = (ts: number, msg: number) => ev('user.ask', ts, 'A', { msg, text: 'go', tasks: [], from: 'person' });
  const start = (ts: number, key: boolean) => ev('session.start', ts, 'A', { agent: 'claude-code', worktree: '/w', branch: null, thread: 'A', loads: [], billing: { ANTHROPIC_API_KEY: key } });

  it('each token counts by the mode in force when it was spent, across a resume that changes it', () => {
    const events = [start(0, true), usage(1, 't1', 1000, { basis: 'unpriced' }), start(2, false), usage(3, 't2', 10, { basis: 'unpriced' })];
    expect(planWindowTokens(events).counted_tokens).toBe(10);
    expect(find(events, 'plan.tokens')?.value).toBe(10);
  });

  it('a spend sum says its basis: reported, or estimated naming its card once any part is', () => {
    const reported = [usage(1, 't1', 1, { basis: 'reported', usd: 0.5 })];
    expect(find(reported, 'spend.usd')?.cost).toEqual({ basis: 'reported', usd: 0.5 });
    const mixed = [...reported, usage(2, 't2', 1, { basis: 'estimated', usd: 0.25, rate_card: 'card' })];
    expect(find(mixed, 'spend.usd')?.cost).toEqual({ basis: 'estimated', usd: 0.75, rate_card: 'card' });
  });

  it('two stops of a turn are one cost row, the turn\'s', () => {
    const events = [usage(1, 't1', 1, { basis: 'reported', usd: 0.5 }), usage(2, 't1', 1, { basis: 'reported', usd: 0.25 })];
    expect(readingsOf(recompute(events)).filter((r) => r.id === 'cost.turn').map((r) => r.value)).toEqual([0.75]);
  });

  it('a message typed mid-turn is no crashed turn; a turn that ends with no usage is, even the last', () => {
    const paid = { basis: 'reported', usd: 0.5 };
    const midTurn = [person(0, 1), person(1, 2), ev('agent.stop', 2, 'A', {}), usage(3, 't1', 1, paid)];
    expect(find(midTurn, 'spend.usd')?.complete).toBe(true);
    const crashed = [...midTurn, person(4, 3)];
    expect(find(crashed, 'spend.usd')?.complete).toBe(false);
    expect(find(crashed, 'tokens.session')?.complete).toBe(false);
  });

  it('a crash then a resume is its own unknown turn, and marks the task it was for', () => {
    const asked = (ts: number, tasks: string[]) => ev('user.ask', ts, 'A', { msg: ts, text: 'go', tasks, from: 'person' });
    const events = [asked(0, ['task:x']), start(1, false), asked(2, ['task:x']), ev('agent.stop', 3, 'A', {}), usage(4, 't', 1, { basis: 'reported', usd: 0.5 })];
    expect(find(events, 'tokens.session')?.complete).toBe(false);
    expect(find(events, 'spend.usd', 'task:x')?.complete).toBe(false);
  });

  it('an unpriced part leaves its turn unpriced, whichever came first', () => {
    const events = [usage(1, 't1', 1, { basis: 'unpriced' }), usage(2, 't1', 1, { basis: 'reported', usd: 0.5 })];
    expect(find(events, 'cost.turn')?.value).toBeNull();
    expect(find(events, 'cost.turn')?.cost).toEqual({ basis: 'unpriced' });
  });

  it('a stale run is outdated by the turn that made the newer claim, not the first ask after the reply', () => {
    const asked = (ts: number, from: string) => ev('user.ask', ts, 'A', { msg: ts, text: 'go', tasks: [], from });
    const events = [
      ev('stop.held', 1000, 'A', { stop: 's', claim: 'claim:c0', total: 0 }),
      asked(6000, 'person'),
      asked(41_000, 'continuation'),
      { ...ev('claim.made', 42_000, 'A', {}), id: 'c1' },
      ev('run.stale', 50_000, 'A', { run: 'run:r', check: 'j', claim: 'claim:c0', newer_claim: 'claim:c1' }),
    ];
    expect(staleRuns(events).sessions[0]?.runs[0]).toMatchObject({ outdated_by: 'continuation', after_ms: 40_000 });
  });
});

describe('the baseline', () => {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const line = JSON.stringify({ type: 'assistant', timestamp: '2026-09-01T00:00:00.000Z', message: { id: 'm', usage: { input_tokens: 5, output_tokens: 1 } } });
  const read = (window: { from: number; to: number }) => recomputeBaseline({ baseline_sha256: 'b', measures: [{ id: 'x', kind: 'tokens.total', window, transcripts: [{ sha256: sha(line) }] }], archive: () => Buffer.from(line) }).measures[0];

  it('a window that catches nothing is missing, never a measured zero', () => {
    expect(read({ from: 0, to: 1 })).toMatchObject({ value: null, status: 'missing' });
    const summary = `{"type":"summary"}\n${line}`;
    expect(recomputeBaseline({ baseline_sha256: 'b', measures: [{ id: 'x', kind: 'tokens.total', window: { from: 0, to: 1 }, transcripts: [{ sha256: sha(summary) }] }], archive: () => Buffer.from(summary) }).measures[0], 'a line with no time doesn\'t rescue it').toMatchObject({ status: 'missing' });
    expect(read({ from: 0, to: Date.UTC(2027, 0) })).toMatchObject({ value: 6, status: 'recomputed' });
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
