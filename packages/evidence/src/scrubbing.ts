// The pure text surface, also used by the archive worker without loading the store, zstd or a second worker.
import { patternMatches as matchesOf, scrub, scrubList, type Run } from './scrub.js';
export { scrubPrefix, scrubReach } from './scrub.js';

/** Text scrubbed by held/env values in every printed form, then by pattern, as intake does. */
export function scrubText(text: string, run?: Run): string {
  return scrub(Buffer.from(text, 'utf8'), scrubList(run)).toString('utf8');
}
/** Pattern matches with UTF-8 offsets; field masks alone are not proof of a pasted key. */
export function patternMatches(text: string): { match: string; at: number; field: boolean }[] {
  const bytes = Buffer.from(text, 'utf8');
  return matchesOf(bytes).map(([match, field]) => ({ match: match.toString('utf8'), at: match.byteOffset - bytes.byteOffset, field }));
}
/** The value-only scrub used before a command check's digest. */
export function scrubValues(text: string, run: Run): string {
  return scrub(Buffer.from(text, 'utf8'), scrubList(run), false).toString('utf8');
}
