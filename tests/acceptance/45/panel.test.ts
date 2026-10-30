// #45 AC2, AC3, AC8: what each row of the Numbers panel shows, on plain record events. The hub's numbers.read and
// `deep numbers` are tested in hub.test.ts.
import { describe, expect, it } from 'vitest';
import { panelRows, readingsOf, recompute, type Reading } from '../../../packages/readings/src/index.ts';
import { ask, held, HOUR, MINUTE, recorded, T0, usage } from './events.ts';

const NOW = T0 + 10 * HOUR;
const MERGE_AS_OF = NOW - 2 * HOUR;
const HELD_AT = NOW - HOUR;
const world = () => [
  recorded(MERGE_AS_OF, 'reading:mergetime', 7200, 's', 'github', MERGE_AS_OF),
  ask('S2', HELD_AT - MINUTE),
  held('S2', HELD_AT, { fast: 3000 }),
  usage('S2', HELD_AT + 1, 'msg_a', { input: 10, output: 5 }, { basis: 'reported', usd: 0.25 }),
  usage('S2', HELD_AT + 2, 'msg_b', { input: 10, output: 5 }, { basis: 'estimated', usd: 0.5, rate_card: 'card-2026-09' }),
];
const readings = (): Reading[] => readingsOf(recompute(world()));

describe('AC2 every reading in the Numbers panel shows its source and age', () => {
  it('#45.d2d39357 AC2 each row names a source and an age: the merge time from github 2 h old, held time from the record 1 h old', () => {
    const rows = panelRows(readings(), { now: NOW, fresh_for: { github: 24 * HOUR } });
    expect(rows.length, 'the world has at least the merge time and the held readings').toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(typeof row.source === 'string' && row.source.length > 0, `${row.id} names its source`).toBe(true);
      expect(typeof row.age_ms === 'number' && row.age_ms >= 0, `${row.id} shows its age`).toBe(true);
    }
    const merge = rows.find((r) => r.id === 'reading:mergetime');
    expect(merge?.source).toBe('github');
    expect(merge?.age_ms).toBe(2 * HOUR);
    expect(rows.find((r) => r.id === 'held.turn')?.age_ms, 'as of the stop it counts').toBe(HOUR);
  });
});

describe('AC3 a reading from a stale source is marked STALE', () => {
  it('#45.a5d4e1cd AC3 past its source\'s freshness the row reads STALE, keeping its value and age; within it, the same reading is current', () => {
    const stale = panelRows(readings(), { now: NOW, fresh_for: { github: HOUR } }).find((r) => r.id === 'reading:mergetime');
    expect(stale?.status, '2 h old against 1 h').toBe('STALE');
    expect(stale?.value, 'its value stays, marked').toBe(7200);
    expect(stale?.age_ms).toBe(2 * HOUR);
    const fresh = panelRows(readings(), { now: NOW, fresh_for: { github: 3 * HOUR } }).find((r) => r.id === 'reading:mergetime');
    expect(fresh?.status, '2 h old against 3 h').toBe('current');
  });
});

describe('AC8 every reading says whether it was observed or modeled, beside its source', () => {
  it('#45.dfe1cdbe AC8 a reported cost and held time are observed, a cost estimated from a rate card is modeled, and every reading and row says one of the two', () => {
    const all = readings();
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) expect(['observed', 'modeled'], `${r.id} says how it was got`).toContain(r.basis);
    const byTurn = (turn: string) => all.find((r) => r.id === 'cost.turn' && r.subject === turn);
    expect(byTurn('msg_a')?.basis, 'a cost the agent reported').toBe('observed');
    expect(byTurn('msg_b')?.basis, 'a cost estimated from a rate card').toBe('modeled');
    expect(all.find((r) => r.id === 'held.turn')?.basis, 'the hub timed it').toBe('observed');
    const rows = panelRows(all, { now: NOW, fresh_for: {} });
    expect(rows.find((r) => r.id === 'cost.turn' && r.subject === 'msg_b')?.basis, 'the row carries it beside the source').toBe('modeled');
  });
});
