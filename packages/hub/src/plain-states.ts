// What a person reads for a state on a plain surface (#3495): contracts/plain-states.json, the one closed table, a row
// for each word of States people see. A state that comes from a verdict has a sentence there, which a row leads with
// before its word; the others read as they are. The app reads the same file (crates/deep-app/src/states.rs), so no
// surface writes a sentence of its own, and nothing reads a state from one: the word stays the state's code.
import { readFileSync } from 'node:fs';

let table: Record<string, string | null> | undefined;

/** The sentence a row in the state `word` leads with on a plain surface; none for a state that reads as it is. */
export function sentenceOf(word: string): string | undefined {
  // Read at the first row printed, so a command that prints no row reads nothing.
  table ??= (JSON.parse(readFileSync(new URL('../../../contracts/plain-states.json', import.meta.url), 'utf8')) as { states: Record<string, string | null> }).states;
  return table[word] ?? undefined;
}
