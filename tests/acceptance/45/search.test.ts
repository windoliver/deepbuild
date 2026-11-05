// #45 AC11, the logic: what deep_search gets from the readings. Over MCP, through a real hub, in hub.test.ts.
import { describe, expect, it } from 'vitest';
import { readingsOf, recompute, searchReadings } from '../../../packages/readings/src/index.ts';
import { ask, T0, usage } from './events.ts';

const TASK = 'task:01K74FX2B4D6F8H0K2M4P6R8T0';
const SPENT_AT = T0 + 5;
const readings = () => readingsOf(recompute([
  ask('S11', T0, 'person', [TASK]),
  usage('S11', SPENT_AT, 'msg_a', { input: 10, output: 5 }, { basis: 'reported', usd: 0.25 }),
]));

describe('AC11 readings for deep_search', () => {
  it('#45.eb25cf40 AC11 a search for spend returns the task\'s spend, $0.25, with its source and as-of time', () => {
    const hits = searchReadings(readings(), 'spend');
    const task = hits.find((h) => h.reading.id === 'spend.usd' && h.reading.subject === TASK);
    expect(task?.reading.value).toBeCloseTo(0.25, 10);
    expect(typeof task?.source === 'string' && task.source.length > 0, 'the hit names its source').toBe(true);
    expect(task?.as_of, 'as of the usage it sums').toBe(SPENT_AT);
    for (const h of hits) {
      expect(h.source.length, `${h.reading.id} names its source`).toBeGreaterThan(0);
      expect(typeof h.as_of, `${h.reading.id} says when`).toBe('number');
    }
  });

  it('#45.eb25cf40 AC11 a search for a word no reading holds returns none', () => {
    expect(searchReadings(readings(), 'spend').length).toBeGreaterThan(0);
    expect(searchReadings(readings(), 'zebra')).toEqual([]);
  });
});
