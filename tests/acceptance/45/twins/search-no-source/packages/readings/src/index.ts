// Planted wrong program (#45): a reading hit loses its source and as-of time, and every reading matches.
export * from './impl.js';
import { searchReadings as realSearchReadings, type ReadingHit } from './impl.js';

export function searchReadings(...args: Parameters<typeof realSearchReadings>): ReturnType<typeof realSearchReadings> {
  return args[0].map((reading) => ({ reading, source: '', as_of: null as unknown as number } as ReadingHit));
}
