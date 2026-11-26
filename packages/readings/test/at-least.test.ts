// #3250's scope item the blind suite leaves open: a task's spend.usd that sums an "at least" cost reads "at least",
// as do the turn's two stops summed into one cost.turn; one whose parts are all exact never does.
import { describe, expect, it } from 'vitest';
import { readingsOf, recompute, type RecordEvent } from '../src/index.js';

let n = 0;
const ev = (kind: string, ts: number, data: Record<string, unknown>, v = 1): RecordEvent => ({ id: `e${n++}`, kind, v, ts, session: 'A', subject: null, data });
const ask = (ts: number, tasks: string[]) => ev('user.ask', ts, { msg: ts, text: 'go', tasks, from: 'person' });
const used = (ts: number, turn: string, usd: number, at_least: boolean) =>
  ev('turn.usage', ts, { turn, model: 'm', covers: 'turn', tokens: { input: 10, cached: 0, output: 0, exact: true, cache_write_5m: 0, cache_write_1h: 0 }, cost: { basis: 'estimated', usd, rate_card: 'card', ...(at_least ? { at_least: true } : {}) } }, 2);
const read = (events: RecordEvent[], id: string, subject: string) => readingsOf(recompute(events)).find((r) => r.id === id && r.subject === subject);

describe('"at least" carried through the record\'s readings', () => {
  it('a task\'s spend and a turn\'s two stops read "at least" once any part does, and never when none does', () => {
    const a = ask(0, ['issue:7']);
    const mixed = [a, used(1, a.id, 1, false), used(2, a.id, 2, true)];
    expect(read(mixed, 'spend.usd', 'issue:7')?.cost).toEqual({ basis: 'estimated', usd: 3, rate_card: 'card', at_least: true });
    expect(read(mixed, 'cost.turn', a.id)?.cost).toEqual({ basis: 'estimated', usd: 3, rate_card: 'card', at_least: true });
    const b = ask(0, ['issue:8']);
    const exact = [b, used(1, b.id, 1, false), used(2, b.id, 2, false)];
    expect(read(exact, 'spend.usd', 'issue:8')?.cost).toEqual({ basis: 'estimated', usd: 3, rate_card: 'card' });
    expect(read(exact, 'cost.turn', b.id)?.cost).toEqual({ basis: 'estimated', usd: 3, rate_card: 'card' });
  });
});
