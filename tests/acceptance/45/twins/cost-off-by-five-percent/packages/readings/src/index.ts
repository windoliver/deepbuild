// Planted wrong program (#45): the estimated cost is 5% over.
export * from './impl.js';
import { countUsage as realCountUsage } from './impl.js';

export function countUsage(...args: Parameters<typeof realCountUsage>): ReturnType<typeof realCountUsage> {
  const read = realCountUsage(...args);
  return read.cost.basis === 'estimated' ? { ...read, cost: { ...read.cost, usd: read.cost.usd * 1.05 } } : read;
}
