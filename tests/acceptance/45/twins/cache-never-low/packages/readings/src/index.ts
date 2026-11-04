// Planted wrong program (#45): the low cache reading is never shown.
export * from './impl.js';
import { readingsOf as realReadingsOf } from './impl.js';

export function readingsOf(...args: Parameters<typeof realReadingsOf>): ReturnType<typeof realReadingsOf> {
  return realReadingsOf(...args).filter((r) => r.id !== 'cache.low');
}
