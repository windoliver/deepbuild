// #45 AC17: a turn whose input is at least 50,000 tokens with cache hits under 20% of it is a reading outside its band,
// "cache hit rate low: most of the context was billed again", listed with the other readings outside their band; a turn
// whose cost is unknown says so and never shows $0 (the issue's Scope, last bullet). Written blind, after the first suite,
// when the criterion was added to the issue.
//
// How the criterion's numbers map to turn.usage@1: its "120,000 input tokens" is the turn's whole input context, and its
// "9,000 cache hits" are the share of that context read from the cache ("under 20% of it"). The event splits the context
// into `tokens.input` (what was not read from the cache: uncached input plus cache writes) and `tokens.cached` (the hits),
// so a 120,000/9,000 turn is `{ input: 111_000, cached: 9000 }`, a 120,000/100,000 turn `{ input: 20_000, cached: 100_000 }`,
// and a turn under 50,000 any split whose sum is under 50,000.
//
// Surface (README, SURFACE): the reading's id is `cache.low`, its subject the turn (the turn.usage's `turn`), its basis
// observed (the record's own counts), its source non-empty, its `band` 'over' (outside its band), and its value the hit
// rate in percent of the context (`unit: '%'`), so a reader sees how low it was. `panelRows` lists rows with `band: 'over'`
// before every row that is inside its band or has none. A turn under 50,000 input tokens, or with hits at 20% or more,
// has no `cache.low` reading at all.
import { describe, expect, it } from 'vitest';
import { panelRows, readingsOf, recompute, type Reading } from '../../../packages/readings/src/index.ts';
import { ask, held, HOUR, T0, usage } from './events.ts';

const NOW = T0 + HOUR;
const REPORTED = { basis: 'reported' as const, usd: 0.4 };

/** The criterion's three turns, in one session beside a held stop, so the panel has rows inside their band too. */
const world = () => [
  ask('S17', T0),
  held('S17', T0 + 3000, { fast: 3000 }),
  usage('S17', T0 + 4000, 'msg_low', { input: 111_000, cached: 9000, output: 500 }, REPORTED),
  usage('S17', T0 + 5000, 'msg_hits', { input: 20_000, cached: 100_000, output: 500 }, REPORTED),
  usage('S17', T0 + 6000, 'msg_small', { input: 40_000, cached: 0, output: 500 }, REPORTED),
];
const cacheLow = (readings: Reading[], turn: string) => readings.find((r) => r.id === 'cache.low' && r.subject === turn);

describe('AC17 the low cache reading', () => {
  it('#45.bad9c34a AC17 a turn with 120,000 input tokens and 9,000 cache hits shows the low cache reading: 7.5% of its context, observed, with a source, outside its band', () => {
    const readings = readingsOf(recompute(world()));
    const low = cacheLow(readings, 'msg_low');
    expect(low, 'the reading is there for the 120,000/9,000 turn').toBeDefined();
    expect(low?.band, 'outside its band').toBe('over');
    expect(low?.basis, 'counted from the record').toBe('observed');
    expect(typeof low?.source === 'string' && low.source.length > 0, 'it names its source').toBe(true);
    expect(low?.unit).toBe('%');
    expect(low?.value, '9,000 of 120,000').toBeCloseTo(7.5, 6);
    expect(low?.as_of, 'as of the turn it reads').toBe(T0 + 4000);
  });

  it('#45.bad9c34a AC17 one with 120,000 and 100,000 hits doesn\'t, and a turn under 50,000 input tokens never does, even at 0 hits', () => {
    const readings = readingsOf(recompute(world()));
    expect(cacheLow(readings, 'msg_hits'), '100,000 of 120,000 were hits').toBeUndefined();
    expect(cacheLow(readings, 'msg_small'), '40,000 tokens with no hits is under the floor').toBeUndefined();
    const edge = readingsOf(recompute([
      ask('S17e', T0),
      usage('S17e', T0 + 1000, 'msg_49999', { input: 49_999, cached: 0, output: 1 }, REPORTED),
      usage('S17e', T0 + 2000, 'msg_fifth', { input: 96_000, cached: 24_000, output: 1 }, REPORTED),
    ]));
    expect(cacheLow(edge, 'msg_49999'), 'one token under 50,000, no hits').toBeUndefined();
    expect(cacheLow(edge, 'msg_fifth'), 'exactly 20% is not under 20%').toBeUndefined();
    expect(readings.filter((r) => r.id === 'cache.low').map((r) => r.subject), 'only the one turn').toEqual(['msg_low']);
  });

  it('#45.bad9c34a AC17 it is listed with the other readings outside their band: in the Numbers panel its row comes before every row inside its band', () => {
    const rows = panelRows(readingsOf(recompute(world())), { now: NOW, fresh_for: {} });
    const at = rows.findIndex((r) => r.id === 'cache.low' && r.subject === 'msg_low');
    expect(at, 'the panel has the row').toBeGreaterThanOrEqual(0);
    expect(rows[at]?.band).toBe('over');
    const inside = rows.filter((r) => r.band !== 'over');
    expect(inside.length, 'the held time and the costs are inside their band or have none').toBeGreaterThan(0);
    for (const row of inside) expect(rows.indexOf(row), `${row.id} for ${row.subject} is listed after the reading outside its band`).toBeGreaterThan(at);
  });

  it('#45.bad9c34a AC17 a turn whose cost is unknown says so and never shows $0, and its low cache reading still shows', () => {
    const readings = readingsOf(recompute([
      ask('S17u', T0),
      usage('S17u', T0 + 1000, 'msg_unpriced', { input: 111_000, cached: 9000, output: 500 }, { basis: 'unpriced' }),
    ]));
    const cost = readings.find((r) => r.id === 'cost.turn' && r.subject === 'msg_unpriced');
    expect(cost?.cost).toEqual({ basis: 'unpriced' });
    expect(cost?.value, 'unknown, never 0').toBeNull();
    expect(cacheLow(readings, 'msg_unpriced')?.value).toBeCloseTo(7.5, 6);
    const row = panelRows(readings, { now: NOW, fresh_for: {} }).find((r) => r.id === 'cost.turn' && r.subject === 'msg_unpriced');
    expect(row?.value, 'the panel shows no amount either').toBeNull();
  });
});
