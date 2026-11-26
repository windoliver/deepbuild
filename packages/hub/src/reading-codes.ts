// A session reading's code (#1456): what a reading is, which its session's state and row read, carried beside its words
// (session.reading@2), so a reading can be reworded and no state moves. A reading recorded before codes, session.reading@1,
// has only its words: the one table below reads those words as the code they meant, and is kept here alone, so restored
// history keeps its states and no other module reads a reading's words as logic.
import { CAN_RUN, CANT_RUN } from './hook-programs.js';
import { MODS_GONE, MODS_WATCH } from './mods.js';
import { activePlant } from './plant.js';

/** The closed set of codes (session.reading@2's `code`). */
export type ReadingCode =
  | 'hooks_cant_run' | 'hooks_run_again' | 'watch_only' | 'denied_ran_anyway' | 'mods_watch' | 'mods_gone' | 'ran_unleased'
  | 'stop_not_held' | 'monitor_waiting' | 'monitor_ended' | 'interrupted' | 'older_set' | 'newer_set' | 'other';

/** The codes that put a line on the session's row saying why its holds don't apply (status.ts: noted). */
export const NOTED: readonly ReadingCode[] = ['hooks_cant_run', 'hooks_run_again', 'watch_only', 'denied_ran_anyway', 'mods_watch', 'mods_gone', 'ran_unleased', 'stop_not_held'];

/** The words that begin the older and the current synced set's readings (#148). */
export const OLDER_SET = 'Runs the older set:';
export const NEWER_SET = 'Runs the current set:';

/** SQL: the words `t` begin with `words`, case and all, as `startsWith` read them. */
const starts = (t: string, words: string): string => `substr(${t}, 1, ${words.length}) = '${words.replaceAll("'", "''")}'`;
/** SQL: the words `t` are LIKE `pattern`, case ignored, as status.ts's `LIKE` read them. */
const like = (t: string, pattern: string): string => `${t} LIKE '${pattern.replaceAll("'", "''")}'`;

/**
 * Earlier records' words, each family with the code it meant, first match wins: the prefixes and patterns status.ts
 * read before #1456, as SQL over the reading's words `t`.
 */
const LEGACY: readonly [(t: string) => string, ReadingCode][] = [
  [(t) => `${like(t, '%watch-only%')} AND ${starts(t, CANT_RUN)}`, 'hooks_cant_run'],
  [(t) => `${like(t, '%watch-only%')} AND ${starts(t, MODS_WATCH)}`, 'mods_watch'],
  [(t) => starts(t, CAN_RUN), 'hooks_run_again'],
  [(t) => starts(t, MODS_GONE), 'mods_gone'],
  [(t) => like(t, 'DeepBuild denied % and it ran anyway%'), 'denied_ran_anyway'],
  [(t) => like(t, '% ran unleased: %'), 'ran_unleased'],
  // The rest of the words that set the row's note, though they began no family above.
  [(t) => `${like(t, '%watch-only%')} OR ${like(t, `${MODS_GONE}%`)} OR ${like(t, `${CAN_RUN}%`)}`, 'watch_only'],
  [(t) => like(t, "This stop isn't held%"), 'stop_not_held'],
  [(t) => like(t, 'Waiting on its monitor%'), 'monitor_waiting'],
  [(t) => like(t, 'Its monitor%'), 'monitor_ended'],
  // Codex's Interrupt before #3430, and after it any hook's interrupted turn: the words right after the hook's name.
  [(t) => `${like(t, 'Interrupt:%')} OR (instr(${t}, ': you interrupted this turn') > 0 AND instr(${t}, ': you interrupted this turn') = instr(${t}, ': '))`, 'interrupted'],
  [(t) => starts(t, OLDER_SET), 'older_set'],
  [(t) => starts(t, NEWER_SET), 'newer_set'],
];

/**
 * The SQL for the code of the session.reading row `alias`: its own code, or for a reading recorded with none, the code
 * its words meant (LEGACY). The planted `legacy-readings-unread` and `legacy-table-skipped` (tests/acceptance/1456 and
 * its redraft) skip LEGACY, so a reading with no code reads as no reading.
 */
export function readingCode(alias: string): string {
  const own = `json_extract(${alias}.data, '$.code')`;
  const plant = activePlant();
  if (plant === 'legacy-readings-unread' || plant === 'legacy-table-skipped') return own;
  const t = `json_extract(${alias}.data, '$.reading')`;
  return `COALESCE(${own}, CASE ${LEGACY.map(([when, code]) => `WHEN ${when(t)} THEN '${code}'`).join(' ')} ELSE 'other' END)`;
}
