// One plain sentence on every change, verdict and open item (#1999; design: the view's "each change is one line, led
// by a plain sentence", States people see). Each is filled from a template with the record's fields alone, never by a
// model and never from the agent's own words, so one record reads as the same sentence on every surface and every
// replay. The return card (#367) leads with the change's. The words are the plain ones (contracts/plain-words.json),
// and a state is named with its word from States people see.

/** The most characters of one record field a sentence quotes. */
const QUOTED = 200;
/** How many files a change's sentence names before it counts the rest. */
const NAMED = 3;
/** The most send-backs a claim gets before it stalls (design: Stalled claims). */
const ROUNDS = 3;

/**
 * A record field as a sentence holds it: on one line, with no sentence end inside it or at its end, so the sentence
 * stays one, and cut to QUOTED characters.
 */
function field(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim().replace(/[.!?]+(["'”’)\]]*)(?=\s)/g, ';$1').replace(/[\s.!?;:,]+$/, '');
  const chars = [...one];
  return chars.length > QUOTED ? `${chars.slice(0, QUOTED - 1).join('').trimEnd()}…` : one;
}
/** `a`, `a and b`, `a, b and c`. */
function list(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** What a change wrote: each file as its name in the change's folder. */
export function changeSentence(files: readonly string[]): string {
  const names = files.map(field).filter(Boolean);
  if (!names.length) return 'Changed no files.';
  if (names.length <= NAMED) return `Changed ${list(names)}.`;
  return `Changed ${names.length} files: ${list([...names.slice(0, NAMED), `${names.length - NAMED} more`])}.`;
}

/** A verdict as the record keeps it: its outcome, its requirements, its own smallest case, whether its commit moved, and its send-back's round. */
export interface VerdictFields {
  outcome: string;
  requirements: readonly { req: string; outcome: string; smallest: string | null; points_to: string | null }[];
  smallest: string | null;
  stale: boolean;
  round: number | null;
}
/** The state's word (States people see), how many requirements it met, and the first cause the record gives. */
export function verdictSentence(v: VerdictFields): string {
  const word = v.outcome === 'FAIL' ? `Sent back${v.round ? `, round ${v.round} of ${ROUNDS}` : ''}` : v.outcome;
  const met = v.requirements.filter((r) => r.outcome === 'PASS').length;
  const head = `${word}${v.stale ? ', now stale' : ''}: ${met} of ${v.requirements.length} requirement${v.requirements.length === 1 ? '' : 's'} met`;
  if (v.outcome === 'PASS') return `${head}.`;
  const failing = v.requirements.find((r) => r.outcome === v.outcome && r.smallest) ?? v.requirements.find((r) => r.outcome !== 'PASS' && r.smallest);
  const smallest = failing?.smallest ?? v.smallest;
  if (!smallest) return `${head}.`;
  const who = failing && failing.req.includes('#') ? `${field(failing.req.slice(failing.req.indexOf('#') + 1))}'s check` : 'its check';
  const at = failing?.points_to ? ` at ${field(failing.points_to)}` : '';
  return `${head}; ${who} found "${field(smallest)}"${at}.`;
}

/** An open item: what is open, in its words as the record holds them. */
export function openItemSentence(text: string): string {
  return `Still open: "${field(text)}".`;
}
