// The words for each closed-set code the core records (#2029): code-words.json, the one list the hub and the app read,
// so no view draws a code as itself. A code the list has no words for is the caller's to say with the core's text.
import { readFileSync } from 'node:fs';

const WORDS = JSON.parse(readFileSync(new URL('../code-words.json', import.meta.url), 'utf8')) as Record<string, Record<string, string>>;

/** The words for `code` of the closed set `set` (ask.outcome, stop.cause or verdict.reason); undefined when the list has none. */
export const codeWords = (set: string, code: string): string | undefined => {
  const words = Object.hasOwn(WORDS, set) ? WORDS[set]! : {};
  return Object.hasOwn(words, code) ? words[code] : undefined;
};
