// Planted wrong program (#45): an unpriced cost reads $0, and an estimate names no rate card.
export * from './impl.js';
import { readingsOf as realReadingsOf, countUsage as realCountUsage } from './impl.js';

export function readingsOf(...args: Parameters<typeof realReadingsOf>): ReturnType<typeof realReadingsOf> {
  const read = realReadingsOf(...args);
  return read.map((r) => (r.cost?.basis === 'unpriced' ? { ...r, value: 0, cost: { basis: 'reported' as const, usd: 0 } } : r.cost?.basis === 'estimated' ? { ...r, cost: { basis: 'reported' as const, usd: r.cost.usd } } : r));
}

export function countUsage(...args: Parameters<typeof realCountUsage>): ReturnType<typeof realCountUsage> {
  const read = realCountUsage(...args);
  return { ...read, cost: read.cost.basis === 'estimated' ? { basis: 'estimated' as const, usd: read.cost.usd, rate_card: 'unnamed' } : { basis: 'reported' as const, usd: 0 } };
}
