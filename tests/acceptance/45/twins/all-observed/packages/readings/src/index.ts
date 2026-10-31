// Planted wrong program (#45): every reading says observed.
export * from './impl.js';
import { readingsOf as realReadingsOf } from './impl.js';

export function readingsOf(...args: Parameters<typeof realReadingsOf>): ReturnType<typeof realReadingsOf> {
  const read = realReadingsOf(...args);
  return read.map((r) => ({ ...r, basis: 'observed' as const }));
}
