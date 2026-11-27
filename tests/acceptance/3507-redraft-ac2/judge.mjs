// The judges of #3507's second criterion as the owner reworded it on 2026-11-26 (#3507.056af128): "On each class's
// fixture, where no bar hides another, the count is from 1 to 2 a covered pixel in every one of the 300 frames, and
// the report gives each fixture's count". Each decides one clause from what the test read, and returns its findings
// as sentences that start with one of the four states (FAIL: the program or its report says otherwise; BLOCKED: a
// reading is missing or unrun; INCONCLUSIVE: what was read can't decide; INVALID: not in the shape the README gives).
// No judge draws, reads a file or starts a process.
//
// Nothing here is a value from a run. The numbers are the issue's: 1 and 2 a covered pixel, and the 300 frames. A
// frame's reading, the six classes, the 300 frames and a fixture's count over them are the first suite's
// (../3507/judge.mjs: readingOf, CLASSES, FRAMES, countOf), read here as they are there.
import { CLASSES, FRAMES, stateOf, timeOf } from '../3507/judge.mjs';

/** The criterion's two ends, in fragments a covered pixel; both are in ("from 1 to 2"). */
export const FROM = 1;
export const TO = 2;
/** The report (../3507/README.md: The report), where a change keeps its report and its evidence. */
const REPORT = 'docs/evidence/3507/README.md';

const fixed = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

// ---------------------------------------------------------------------------------------------------------------------
// The first clause: from 1 to 2 a covered pixel, in every one of the 300 frames

/**
 * `readings[k]` is frame k's reading of one class's fixture (readingOf), k from 0 to 299. In every frame: the mode's
 * own count is 2 at most, a bar's front and its back with depth ignored, so no pixel holds two bars and no bar hides
 * another (the criterion's "where", and why 2 is the most a pixel can take; a frame where one does can't be judged,
 * and is never a pass); a bar is in view; and the frame's fragments are at least its covered pixels and at most twice
 * them, held in whole numbers, so no rounding decides an end.
 */
export function rangeProblems(name, readings) {
  const problems = [];
  for (let k = 0; k < FRAMES; k++) {
    const r = readings?.[k];
    const where = `${name}, frame ${k} (${timeOf(k)})`;
    if (!r) { problems.push(`BLOCKED: ${where}: not counted; the criterion is every one of the ${FRAMES} frames`); continue; }
    if (!r.ok) { problems.push(`${r.state}: ${where}: ${r.why}`); continue; }
    if (r.max !== 2) {
      problems.push(`INCONCLUSIVE: ${where}: the mode's own count is at most ${r.max} a pixel, where a bar alone takes 2 (its front and its back, depth ignored): ${r.max > 2 ? 'a bar hides another here' : 'no bar is whole in view'}, and the criterion states the count for a frame where no bar hides another`);
      continue;
    }
    if (r.covered === 0) { problems.push(`FAIL: ${where}: the count says no opaque solid covers a pixel, and the mode's own count drew the bars`); continue; }
    if (r.shaded < FROM * r.covered || r.shaded > TO * r.covered) {
      problems.push(`FAIL: ${where}: the count is ${fixed(r.shaded / r.covered)} a covered pixel (${r.shaded} fragments over ${r.covered} covered pixels), ${r.shaded < FROM * r.covered ? `under ${FROM}` : `over ${TO}`}: it is from ${FROM} to ${TO}`);
    }
  }
  return problems;
}

/**
 * One class's findings as a failure shows them: the first `keep` of each state as they are, and one line for that
 * state's others, so 300 frames that fail alike don't crowd the other classes and the report out of the text. Every
 * state among the findings is still among what comes back.
 */
export function folded(name, problems, keep = 3) {
  const out = [];
  for (const state of ['FAIL', 'BLOCKED', 'INCONCLUSIVE', 'INVALID']) {
    const mine = problems.filter((p) => stateOf(p) === state);
    out.push(...mine.slice(0, keep));
    if (mine.length > keep) out.push(`${state}: ${name}: ${mine.length - keep} more of its ${FRAMES} frames read ${state} too`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The second clause: the report gives each fixture's count

const NAMES = CLASSES.join('|');
/** A line that gives a class's fixture's count, in the form the first suite's README fixed for the every-pass fixture's. */
const COUNT = RegExp(`Shaded on \`(${NAMES})\`: (\\d+\\.\\d{3,}) a covered pixel, (\\d+\\.\\d{3,}) a pixel, over (\\d+) frames\\b`);
/** A line that names a class's fixture as that form does, whatever follows the colon. */
const NAMED = RegExp(`Shaded on \`(${NAMES})\`:`);
/** The form, as a finding spells it. */
const form = (name) => `"Shaded on \`${name}\`: <n.nnn> a covered pixel, <n.nnn> a pixel, over ${FRAMES} frames"`;

/**
 * What the report's text says of each class's fixture: `{[class]: {read, other}}`. `read` holds a line in the form,
 * as `{aCoveredPixel, aPixel, frames, written}` (`written`, the two numbers as the report writes them); `other`, a
 * line that names the fixture the same way and isn't in the form. A line reads one fixture, the first it names.
 */
export function linesOf(text) {
  const lines = Object.fromEntries(CLASSES.map((name) => [name, { read: [], other: [] }]));
  for (const line of String(text).split('\n')) {
    const named = NAMED.exec(line);
    if (!named) continue;
    const m = COUNT.exec(line);
    if (m && m.index === named.index) lines[m[1]].read.push({ aCoveredPixel: Number(m[2]), aPixel: Number(m[3]), frames: Number(m[4]), written: [m[2], m[3]] });
    else lines[named[1]].other.push(line.trim().slice(0, 200));
  }
  return lines;
}

/** Two counts are one to the report's three decimals: within half of the third, and a float's own rounding. */
const near = (a, b) => Math.abs(a - b) <= 0.0005 + 1e-9;

/**
 * The report against the test's own counts. `text` is the report's text, or null where there is no report; `counts`
 * is `{[class]: countOf(...)}`, each class's fixture's count over the 300 frames this run drew: `{problems,
 * aCoveredPixel, aPixel, frames}`, the mean over the frames of each frame's fragments over its covered pixels and
 * over its pixels. For each of the six classes the report holds one line in the form, over the 300 frames, and its
 * two numbers are this run's to three decimals. A count is never taken from the report: `counts` decides, and a
 * fixture this run has no count of is BLOCKED, never held to the report's word.
 */
export function reportProblems(text, counts) {
  if (typeof text !== 'string') return [`FAIL: the report, ${REPORT}, is not there: nothing gives each class's fixture's count`];
  const lines = linesOf(text);
  const problems = [];
  for (const name of CLASSES) {
    const { read, other } = lines[name];
    for (const line of other) problems.push(`INVALID: the report's line for \`${name}\` isn't in the form ${form(name)}, each number with three decimals or more: ${JSON.stringify(line)}`);
    if (read.length === 0) {
      if (other.length === 0) problems.push(`FAIL: the report gives no count for \`${name}\`: no line ${form(name)}`);
      continue;
    }
    if (read.length > 1) { problems.push(`INVALID: the report has ${read.length} lines "Shaded on \`${name}\`: …"; one is read`); continue; }
    const [given] = read;
    if (given.frames !== FRAMES) problems.push(`FAIL: the report's count for \`${name}\` is over ${given.frames} frames, not the ${FRAMES} #3031 counted`);
    const own = counts?.[name];
    if (!own || !Array.isArray(own.problems) || own.problems.length > 0) {
      problems.push(`BLOCKED: ${name}: this run has no count of the fixture to hold the report's to: ${own?.problems?.length ? `${own.problems.length} of its frames gave none` : 'it was not counted'}`);
      continue;
    }
    if (!near(given.aCoveredPixel, own.aCoveredPixel) || !near(given.aPixel, own.aPixel)) {
      problems.push(`FAIL: the report gives ${given.written[0]} a covered pixel and ${given.written[1]} a pixel for \`${name}\`; the view counts ${fixed(own.aCoveredPixel)} a covered pixel, ${fixed(own.aPixel)} a pixel, over ${own.frames} frames`);
    }
  }
  return problems;
}
