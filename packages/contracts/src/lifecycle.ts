// The lifecycle tables (design: Lifecycles): every record object with a lifecycle has one table beside the
// schemas, schemas/<object>.machine@<n>.json, naming its states, the events that move it, each move's guard and
// its final states. The record moves an object only through its table, and a table's frozen digest sits in
// digests.json with the schemas', so changing one is a contract change.
import { readdirSync, readFileSync } from 'node:fs';

const SCHEMAS = new URL('../schemas/', import.meta.url);
/** A lifecycle table's file name: <object>.machine@<n>.json. */
export const MACHINE_FILE = /^([a-z_]+)\.machine@(\d+)\.json$/;

export interface MachineMove { from: string; event: string; guard?: string; to: string }
/** A pair of events whose two arrival orders may end an object in different states, named so the order is chosen. */
interface MachineConflict { name: string; events: [string, string] }
export interface Machine {
  id: string;
  description?: string;
  states: string[];
  initial: string;
  final: string[];
  moves: MachineMove[];
  conflicts?: MachineConflict[];
}

/** The record objects with a lifecycle (the degrade level's table lands with the meter, #379). */
export const LIFECYCLE_OBJECTS: readonly string[] = ['ask', 'ask_task', 'lease', 'claim', 'attempt', 'waiver', 'open_item', 'session_binding'];

/**
 * The guards a move may name, each what the record and the enumerator's world both read it as. A guard outside
 * this list has no meaning, so the contract test refuses a table that names one.
 */
const LIFECYCLE_GUARDS: Readonly<Record<string, string>> = {
  core: 'the core wrote the event',
  not_agent: 'no agent wrote it: neither a hook nor an MCP connection',
  trusted_path: 'you wrote it on your trusted path: the app or the CLI',
  past_deadline: "the deadline passed: in the world its clock says so, in the record the core's own event does, since no projection reads a clock",
  proven_ended: "its end is proven: every event its proof cites, the holder's end or its processes' ends, is earlier in the log; with none cited, only the core or the holder itself ends it",
  newer_attempt: 'it starts a newer attempt at the same task',
  own_session: "it ends the attempt's own session",
};

/**
 * Every lifecycle table, parsed as its file holds it, in file-name order: each one digests.json freezes and any new one
 * in schemas/. A frozen table missing from schemas/, as from an install missing a file (#41), fails naming its file.
 */
export function machines(): Machine[] {
  const frozen = Object.keys(JSON.parse(readFileSync(new URL('../digests.json', import.meta.url), 'utf8')) as object).map((id) => `${id}.json`);
  return [...new Set([...frozen, ...readdirSync(SCHEMAS)])].filter((file) => MACHINE_FILE.test(file)).sort()
    .map((file) => JSON.parse(readFileSync(new URL(file, SCHEMAS), 'utf8')) as Machine);
}

/** One problem per object with no table among `tables`, naming it; none when every object has one. */
export function lifecycleGaps(objects: readonly string[], tables: readonly Machine[]): string[] {
  const have = new Set(tables.map((t) => /^([a-z_]+)\.machine@\d+$/.exec(t.id)?.[1]));
  return objects.filter((o) => !have.has(o)).map((o) => `${o} is a record object with a lifecycle and has no table (schemas/${o}.machine@<n>.json)`);
}

/** What is wrong with one table's shape: states, moves and guards that don't hold together, and events no schema publishes. */
export function machineProblems(table: Machine, published: (kind: string) => boolean): string[] {
  const at = table.id;
  const states = new Set(table.states);
  const problems: string[] = [];
  if (states.size !== table.states.length) problems.push(`${at}: a state is listed twice`);
  if (!states.has(table.initial)) problems.push(`${at}: its initial state ${table.initial} is not one of its states`);
  if (!table.final.length) problems.push(`${at}: it names no final state`);
  // A life that starts ended passes every check with any moves at all.
  if (table.final.includes(table.initial)) problems.push(`${at}: its initial state ${table.initial} is final`);
  for (const f of table.final) if (!states.has(f)) problems.push(`${at}: final state ${f} is not one of its states`);
  for (const m of table.moves) {
    const row = `${m.from} --${m.event}${m.guard ? `[${m.guard}]` : ''}--> ${m.to}`;
    if (!states.has(m.from) || !states.has(m.to)) problems.push(`${at}: ${row} names a state it doesn't list`);
    if (!published(m.event)) problems.push(`${at}: ${row} moves on ${m.event}, which no schema publishes`);
    if (m.guard !== undefined && !Object.hasOwn(LIFECYCLE_GUARDS, m.guard)) problems.push(`${at}: ${row} names the guard ${m.guard}, which has no meaning`);
  }
  for (const c of table.conflicts ?? []) for (const kind of c.events) if (!table.moves.some((m) => m.event === kind)) problems.push(`${at}: conflict ${c.name} names ${kind}, which moves nothing in it`);
  return problems;
}
