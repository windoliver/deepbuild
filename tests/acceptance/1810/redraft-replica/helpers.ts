// Test-side tools for #1810's first criterion, the app's part (README). The world is #1463's: a real hub in a temp HOME
// takes one session's hooks, the record and asks core raise its three asks with that hub stopped, and a real hub starts
// on it again, with the OS confirmation stubbed `confirmed`. Two asks are then answered through the real
// `deep inbox answer`. The readers are the real ones: `deep` and `deep status --json` from the built CLI, and the app's
// list as the real `deep-drive` reads it over a copy of the same hub's record (#1463's appList).
//
// Safety: every process gets a temp HOME under /tmp; a process is stopped only by the PID it was started with; nothing
// touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { countsIn, type Row, type SessionSpec } from '../../1463/helpers.ts';

/** The criterion, by `#1810.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = '#1810.eebcb4a2';

const DAY = 86_400_000;
/** One session, three asks, each due days from now, so none takes its default while the test runs. */
export const ONE_SESSION: SessionSpec[] = [
  { key: 'cart', repo: 'shop', title: 'Cart totals', calls: 2, stop: true, asks: [
    { kind: 'choice', question: 'Ship the cart page today?', options: [['yes', 'Yes'], ['no', 'No']], default: 'no', deadline: (at) => at + 3 * DAY },
    { kind: 'choice', question: 'Keep the changelog as a list or as prose?', options: [['list', 'A list'], ['prose', 'Prose']], default: 'list', deadline: (at) => at + 3 * DAY },
    { kind: 'taste', question: 'Which header colour on the login page?', options: [['blue', 'Blue header'], ['green', 'Green header']], default: 'blue', deadline: (at) => at + 3 * DAY },
  ] },
];
/** The two asks answered through `deep inbox answer`, and the one left open. */
export const ANSWERED = ['Ship the cart page today?', 'Keep the changelog as a list or as prose?'];
export const OPEN = 'Which header colour on the login page?';
/** The option the test answers an ask with: the one that isn't its default. */
export function otherOption(question: string): string {
  const spec = ONE_SESSION.flatMap((s) => s.asks ?? []).find((a) => a.question === question)!;
  return spec.options.find(([id]) => id !== spec.default)![0];
}

/** What one reader says: where in the log it read, its count sentences, and the ask rows it lists (undefined: it lists none as rows). */
export interface Reading { who: string; log_pos: number | undefined; counts: number[] | undefined; asks: string[] | undefined }
export const askIds = (rows: readonly Row[]): string[] => rows.filter((r) => r.id.startsWith('ask:')).map((r) => r.id);
export { countsIn };

/**
 * The criterion's judge: every reader read at one log position; each count sentence it prints says 1 and it prints at
 * least one; each list of ask rows is the open ask's row alone. Each failure names the reader and the count or ask.
 */
export function oneFailures(readings: readonly Reading[], open: string, answered: readonly string[]): string[] {
  const out: string[] = [];
  const at = readings.filter((r) => r.log_pos !== undefined).map((r) => r.log_pos!);
  for (const r of readings) if (r.log_pos === undefined) out.push(`${r.who} gives no log position, so it can't be held to the others'`);
  if (new Set(at).size > 1) out.push(`the readers read at different log positions: ${readings.map((r) => `${r.who} at ${String(r.log_pos)}`).join(', ')}`);
  for (const r of readings) {
    if (r.counts !== undefined) {
      if (!r.counts.length) out.push(`${r.who} says no count of what needs you ("1 ask needs you")`);
      for (const n of new Set(r.counts)) if (n !== 1) out.push(`${r.who} counts ${n} (says "${n} ask${n === 1 ? ' needs' : 's need'} you"), not 1: two asks are answered and one is open`);
    }
    if (r.asks !== undefined) {
      if (!r.asks.includes(open)) out.push(`${r.who} lacks the open ask's row ${open}`);
      for (const a of answered) if (r.asks.includes(a)) out.push(`${r.who} still lists the answered ask ${a}`);
      const others = r.asks.filter((a) => a !== open && !answered.includes(a));
      if (others.length) out.push(`${r.who} lists ask rows the fixture never raised: ${others.join(', ')}`);
      if (r.asks.filter((a) => a === open).length > 1) out.push(`${r.who} lists the open ask ${open} more than once`);
    }
  }
  return out;
}
