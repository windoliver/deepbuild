// The verdict in the chat (#83; design: The verdict in the chat). One line a stop reply carries, no wider than the
// narrowest chat it goes to, in this order: what wasn't verified, if anything; the outcome and its count; the one
// cause, with file and line; the next step's owner; the receipt. A line that would pass the width shortens the cause
// first; "not verified" and the outcome with its count are never dropped.
import type { Outcome, Result } from './types.js';

/** The narrowest chat: 80 columns in a terminal. */
export const LINE_WIDTH = 80;
/** The parts' separator. */
const DOT = ' · ';
/** The most send-backs a claim gets before it stalls (design: Stalled claims). */
const ROUNDS = 3;
/** The cause keeps at least this many characters before any later part gives way. */
const CAUSE_FLOOR = 12;
/** What joins the outcome to its cause, and what ends a cut cause. */
const CAUSE_SEP = ': ';
const ELLIPSIS = '…';

/** One requirement as the line reads it: its handle, its outcome, and for a failing one the smallest case and where it points. */
export interface LineRequirement { req: string; outcome: Result; smallest: string | null; points_to: string | null }
/** The record state a line is written from. */
export interface LineState {
  /** The claim's verdict, or null while none is made yet. */
  outcome: Outcome | null;
  /** The verdict's requirements; with no verdict, what its runs show so far. */
  requirements: LineRequirement[];
  /** For FAIL: which send-back this is, of three. */
  round?: number;
  /** Checks still running, each with the time it is expected to take, in seconds, where known. */
  running: { check: string; about_s: number | null }[];
}
/** Who takes the next step: the agent (a send-back), you (a PASS or something only you can clear) or DeepBuild (checks still to run). */
type Owner = 'agent' | 'you' | 'DeepBuild';

const UNVERIFIED = new Set<Result>(['BLOCKED', 'INVALID', 'INCONCLUSIVE']);
const name = (req: string): string => req.slice(req.indexOf('#') + 1);
const columns = (s: string): number => [...s].length;

/** The next step's owner for a verdict. */
function ownerOf(outcome: Outcome | null): Owner {
  return outcome === 'FAIL' || outcome === 'INVALID' ? 'agent' : outcome === 'PASS' || outcome === 'BLOCKED' ? 'you' : 'DeepBuild';
}
/** "about 4 min", or "about 30 s" under a minute. */
function about(seconds: number): string {
  return seconds >= 60 ? `about ${Math.round(seconds / 60)} min` : `about ${Math.round(seconds)} s`;
}

/** The parts of the line, in order, before any shortening. */
interface Parts { unverified: string; outcome: string; cause: string; points: string; running: string[]; owner: string; receipt: string }
function parts(s: LineState): Parts {
  const unverified = s.requirements.filter((r) => UNVERIFIED.has(r.outcome)).map((r) => name(r.req));
  const passed = s.requirements.filter((r) => r.outcome === 'PASS').length;
  const total = s.requirements.length;
  const count = `${passed}/${total}`;
  let outcome: string;
  const running: string[] = [];
  if (s.outcome === null) {
    outcome = passed ? `says done ${count}` : 'says done';
    if (s.running.length) {
      running.push(`${s.running.length} check${s.running.length === 1 ? '' : 's'} running`);
      const longest = Math.max(...s.running.map((r) => r.about_s ?? -1));
      if (longest >= 0) running.push(about(longest));
    }
  } else if (s.outcome === 'FAIL') outcome = `sent back ${Math.max(1, s.round ?? 1)}/${ROUNDS}`;
  else outcome = `${s.outcome} ${count}`;
  let cause = '';
  let points = '';
  if (s.outcome === 'FAIL' || s.outcome === 'BLOCKED') {
    const failing = s.requirements.find((r) => r.outcome === s.outcome && r.smallest) ?? s.requirements.find((r) => r.outcome === s.outcome);
    cause = failing?.smallest ?? '';
    points = failing?.points_to ?? '';
  }
  return { unverified: unverified.length ? `not verified: ${unverified.join(', ')}` : '', outcome, cause, points, running, owner: `next: ${ownerOf(s.outcome)}`, receipt: 'receipt' };
}

/**
 * The line for a record state, within `width` columns. Over the width, the cause is cut from its end first, marked
 * `…`, down to a floor; then the receipt, the rest of the cause, where it points and the owner give way, in that
 * order; what wasn't verified and the outcome with its count never do.
 */
export function verdictLine(s: LineState, width = LINE_WIDTH): string {
  const p = parts(s);
  width = Number.MAX_SAFE_INTEGER; // Planted wrong program (#83 AC11 twin): the cause is kept whole, past the width.
  const join = (cause: string, keep: { points: boolean; owner: boolean; receipt: boolean }): string =>
    [p.unverified, `${p.outcome}${cause ? `${CAUSE_SEP}${cause}` : ''}`, keep.points ? p.points : '', ...p.running, keep.owner ? p.owner : '', keep.receipt ? p.receipt : ''].filter(Boolean).join(DOT);
  const all = { points: true, owner: true, receipt: true };
  let line = join(p.cause, all);
  if (columns(line) <= width) return line;
  // How many columns the cause may take with the given parts kept, and the line with it cut to that.
  const cut = (keep: typeof all, floor: number): string | undefined => {
    const room = width - columns(join('', keep)) - CAUSE_SEP.length - ELLIPSIS.length;
    if (room < floor) return undefined;
    const kept = [...p.cause].slice(0, room).join('').trimEnd();
    return join(`${kept}${ELLIPSIS}`, keep);
  };
  if (!p.cause) {
    for (const keep of [{ ...all, receipt: false }, { points: false, owner: true, receipt: false }, { points: false, owner: false, receipt: false }]) {
      line = join('', keep);
      if (columns(line) <= width) return line;
    }
    return line;
  }
  return cut(all, CAUSE_FLOOR) ?? cut({ ...all, receipt: false }, 1)
    ?? cut({ points: false, owner: true, receipt: false }, 1) ?? cut({ points: false, owner: false, receipt: false }, 1) ?? join('', { points: false, owner: false, receipt: false });
}
