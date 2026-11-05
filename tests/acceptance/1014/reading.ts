// What both suites read the same way: the criteria's IDs, the plant's name, and the record's reading of one turn. The
// reading is a list of findings, so criterion 6 can ask of a planted program what criterion 2 asks of the real one.

/** `#1014.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes it. */
export const AC = {
  working: '#1014.95b12f36',
  oneTurn: '#1014.020f9ec0',
  oneReturn: '#1014.1eafe8b1',
  status: '#1014.fe476679',
  rebuild: '#1014.55bb9354',
  plant: '#1014.179e8e0c',
} as const;

/** The planted wrong program (README, The plant): the projection closes the open turn at a child's stop. */
export const PLANT = 'turn-closes-at-child-stop';

export type Row = Record<string, unknown>;
/** A session's rows of the record's reading of turns. */
export interface TurnRows { turns: Row[]; turnEvents: Row[] }
/** The turn the session ran. `stop` is set once the session's own stop is in the record, and the turn must be open until it is. */
export interface Walk { prompt: string; calls: string[]; stop?: { id: string; seq: string; turn: number } }

/**
 * Where the rows put the turn's boundary wrong, each finding naming it; empty when they show one turn from the prompt,
 * open until the session's own stop, closed there, with every one of `calls` in it.
 */
export function turnBoundary({ turns, turnEvents }: TurnRows, walk: Walk): string[] {
  const shown = JSON.stringify(turns);
  const out: string[] = [];
  if (turns.length !== 1) out.push(`turn boundary: ${turns.length} rows in turns where the session ran one turn: ${shown}`);
  const turn = turns.find((t) => t.start_id === walk.prompt);
  if (!turn) return [...out, `turn boundary: no turn starts at the prompt ${walk.prompt}: ${shown}`];
  if (walk.stop) {
    if (Number(turn.stopped) !== 1 || String(turn.stop_seq) !== walk.stop.seq) out.push(`turn boundary: the turn from the prompt doesn't end at the session's own stop (seq ${walk.stop.seq}): ${shown}`);
    if (Number(turn.number) !== walk.stop.turn) out.push(`turn boundary: the turn's number isn't that of the session's own stop, ${walk.stop.turn}: ${shown}`);
  } else if (Number(turn.stopped) !== 0 || turn.stop_seq !== null) out.push(`turn boundary: the turn closed before the session's own stop: ${shown}`);
  for (const call of walk.calls) {
    const placed = turnEvents.find((e) => e.event_id === call);
    if (placed?.turn_idx === undefined || Number(placed.turn_idx) !== Number(turn.idx)) out.push(`turn boundary: tool event ${call} isn't in the turn from the prompt (turn_events: ${JSON.stringify(placed ?? null)})`);
  }
  return out;
}

/** Rows of every table, in one order whatever order they were written in, with bigints as text. */
export function sameOrder(tables: Record<string, Row[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(tables).map(([name, rows]) =>
    [name, rows.map((r) => JSON.stringify(r, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).sort()]));
}
