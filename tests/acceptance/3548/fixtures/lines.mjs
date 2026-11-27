// The planted line of #3548's suite (README: The planted line), shared by the writer that runs inside the hub
// (writer.mjs) and by the tests that read the hub's log, the made logs and the bundle back (helpers.ts).
//
// A line is `deep hub: planted line [[3548:<tag>:<number>|<fill>|<number>:3548]]`: the run's tag (8 hex digits), the
// line's number in 9 digits at both ends, and a fill that is the number and a dot, repeated. So any 20 characters of
// a line say which line they are from, and a line cut anywhere is told from a whole one. A line holds letters, digits,
// spaces and `[ ] : | .` only, so no scrub changes it and JSON writes it as it is, one byte a character.

export const HEAD = 'deep hub: planted line ';
export const OPEN = '[[3548:';
export const CLOSE = ':3548]]';
export const pad = (number) => String(number).padStart(9, '0');
export const fillOf = (number, length) => `${pad(number)}.`.repeat(Math.ceil(length / 10)).slice(0, length);
export const textOf = (tag, number, length) => `${OPEN}${tag}:${pad(number)}|${fillOf(number, length)}|${pad(number)}${CLOSE}`;
export const lineOf = (tag, number, length) => `${HEAD}${textOf(tag, number, length)}`;
/** The bytes of a line with its line end, less its fill: 67. */
export const FIXED = HEAD.length + OPEN.length + 8 + 1 + 9 + 1 + 1 + 9 + CLOSE.length + 1;
/** A line's fill length, `least` to `least + 210`: 211 lines in a row each have their own, then the lengths repeat. */
export const fillAt = (number, least = 40) => least + ((number * 112) % 211);

const WHOLE = /\[\[3548:([0-9a-f]{8}):(\d{9})\|([0-9.]*)\|(\d{9}):3548\]\]/g;
const PART = /\[\[3548:|:3548\]\]|\d{9}\.\d{9}\./;
const NONE = { whole: [], part: false };

/**
 * What a stretch of text with no line end in it holds of the run's planted lines: the number of each whole one, and
 * whether a part of one is left beside them, which is what a cut line is. A whole one may stand inside other text, as
 * a log that stamps or wraps its lines writes it.
 */
export function plantedIn(text, tag) {
  if (!PART.test(text)) return NONE;
  const whole = [];
  let rest = '';
  let at = 0;
  for (const match of text.matchAll(WHOLE)) {
    const [all, run, first, fill, last] = match;
    if (run !== tag || first !== last || fill !== fillOf(Number(first), fill.length)) continue;
    whole.push(Number(first));
    rest += `${text.slice(at, match.index)} `;
    at = match.index + all.length;
  }
  return { whole, part: PART.test(rest + text.slice(at)) };
}
