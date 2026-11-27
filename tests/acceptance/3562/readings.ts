// What #3562's second and third criteria read from the record, as functions of plain data (README): which check
// started out of turn, and whether the record's queue shows a place replaced. They import nothing that runs, so a
// plain script can load them and try each against a well-formed record and against a wrong one.
import type { Ev } from '../965/helpers.ts';

const ORDINAL = ['first', 'second', 'third'];
const short = (commit: string): string => commit.slice(0, 7);

/**
 * AC3's reading at one start. `stopped` are the three waiting checks in the order their sessions stopped, each with
 * its stop's claim; `started` are their runs that have started, in log order. The n-th to start (from 0) must be the
 * check whose session stopped n-th. Says what is wrong, naming the check that started out of turn, or nothing when
 * the freed slot went to the check whose turn it was. A slot that freed with nothing started is named too.
 */
export function outOfTurn(stopped: readonly { journey: string; claim: string }[], started: readonly Ev[], n: number): string | undefined {
  const due = stopped[n]!;
  const next = started[n];
  const order = stopped.map((s) => s.journey).join(', ');
  if (!next) return `none of the waiting checks (${stopped.slice(n).map((s) => s.journey).join(', ')}) started when the ${ORDINAL[n]} slot freed. The three must start in the order they stopped: ${order}`;
  if (next.data.claim === due.claim) return undefined;
  const turnOf = stopped.findIndex((s) => s.claim === next.data.claim);
  return `${String(next.data.check)} started out of turn. ${turnOf < 0 ? 'It is none of the three waiting checks' : `Its session stopped ${ORDINAL[turnOf]} of the three`}, and it took the ${ORDINAL[n]} slot to free, ahead of ${due.journey}, whose session stopped ${ORDINAL[n]} and still waited. The three must start in the order they stopped: ${order}; they started: ${started.slice(0, n + 1).map((x) => String(x.data.check)).join(', ')}`;
}

/** A place as the record holds it (`check.held`): what this suite reads of it. */
export interface Place { replaced_by: string | null; started_at: number | null }
/**
 * AC2's reading of the record's queue. `place` is the place `check` took on the `older` snapshot, read as #965's suite
 * reads a place (the newest `check.held` for the check and the snapshot), or undefined when the record holds none. It
 * must show the `newer` snapshot as what replaced it, and it never started. Says what is wrong, or nothing.
 */
export function notReplaced(place: Place | undefined, check: string, older: string, newer: string): string[] {
  const where = `the place of ${check} on ${short(older)}`;
  if (!place) return [`the record's queue holds no place of ${check} on ${short(older)}: no check.held names the check and the snapshot`];
  return [
    ...(place.replaced_by === newer ? [] : [`the record's queue shows ${where} replaced by ${place.replaced_by === null ? 'nothing' : short(String(place.replaced_by))}, not by ${short(newer)}`]),
    ...(place.started_at === null ? [] : [`the record's queue shows ${where} started at ${String(place.started_at)}: a place a newer snapshot took never starts`]),
  ];
}
