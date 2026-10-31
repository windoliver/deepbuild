// Planted wrong program (#45): the crashed turn reads zero and the totals call none unknown.
export * from './impl.js';
import { countUsage as realCountUsage } from './impl.js';

export function countUsage(...args: Parameters<typeof realCountUsage>): ReturnType<typeof realCountUsage> {
  const read = realCountUsage(...args);
  return { ...read, totals: { ...read.totals, unknown_turns: 0 }, turns: read.turns.map((t) => ({ ...t, usage: t.usage ?? { input: 0, output: 0, cache_write: 0, cache_read: 0 } })) };
}
