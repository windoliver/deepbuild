// The record moves an object only through its lifecycle table (#570; design: Lifecycles). Before an event's
// projection writes an object's state, the gate finds the object, reads the state its table holds now, and looks
// for a row from that state on the event whose guard holds. With none, the move is refused: the event stays in
// the log, its move never lands, and the record appends a move.refused naming the object, the state, the event
// and the table. The gate reads the projections and the log only as they stand at the event's log position, so a
// rebuild refuses the same moves again without recording them twice.
//
// It gates the objects whose state the record holds in a column: asks, ask-tasks, leases, claims and open items.
// An attempt, a waiver and a session binding have no state column here; their tables are walked by the
// enumerator and recorded logs are read back against them (scripts/lifecycle.mjs).
import { machines, type JsonValue, type Machine, type MachineMove } from '@deepbuild/contracts';

type Obj = { [key: string]: JsonValue };
/** The event as the gate reads it. */
interface Moving { id: string; kind: string; ts: number; log_pos: number; writer: string; subject: string | null; data: JsonValue }
/** One refused move: what move.refused@1 records. */
export interface Refusal { object: string; table: string; state: string; event: string; event_id: string; guard?: string }
/** Reads one row of a projection, or undefined. */
type ReadRow = (sql: string, ...params: unknown[]) => Record<string, unknown> | undefined;

/** An object an event would move: its table, its ID, the state it is in, and what its guards read. */
interface Target { table: string; object: string; state: string; row: Record<string, unknown> }

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const bare = (v: unknown): string | null => (typeof v === 'string' ? v.replace(/^[a-z_]+:/, '') : null);
const isAgent = (writer: string): boolean => writer === 'hook' || writer.startsWith('mcp:');
/** move.refused@1's bound on a name: an object named by long text is cut, never left to fail its commit. */
const cap = (text: string): string => (text.length > 8192 ? text.slice(0, 8192) : text);

const TABLES = new Map<string, Machine>(machines().map((t) => [t.id.replace(/\.machine@\d+$/, ''), t]));
const table = (object: string): Machine => {
  const t = TABLES.get(object);
  if (!t) throw Error(`no lifecycle table for ${object}`);
  return t;
};

/** What each guard reads in the record: the event, the object's row, and the log. */
const GUARDS: Readonly<Record<string, (e: Moving, row: Record<string, unknown>, read: ReadRow) => boolean>> = {
  core: (e) => e.writer === 'core',
  not_agent: (e) => !isAgent(e.writer),
  trusted_path: (e) => e.writer === 'app' || e.writer === 'cli',
  past_deadline: (e, row) => typeof row.deadline !== 'number' || e.ts >= row.deadline,
  // The leases kernel proves the end before it releases; the record holds it to events already in the log.
  proven_ended: (e, _row, read) => {
    const proof = isObj(e.data) && Array.isArray(e.data.proof) ? e.data.proof : [];
    return proof.every((id) => typeof id === 'string' && read('SELECT 1 AS found FROM events WHERE id = ? AND log_pos < ?', id, e.log_pos) !== undefined);
  },
};
// Every guard of a table the record gates means something here.
for (const object of ['ask', 'ask_task', 'lease', 'claim', 'open_item']) {
  for (const m of table(object).moves) if (m.guard !== undefined && !(m.guard in GUARDS)) throw Error(`${table(object).id}: the record reads no guard ${m.guard}`);
}

const ASK_KINDS = new Set(table('ask').moves.map((m) => m.event));

/** The objects this event would move, each with the state the record holds for it now. */
function targets(e: Moving, read: ReadRow): Target[] {
  const d: Obj = isObj(e.data) ? e.data : {};
  const ask = (id: string | null): Target[] => {
    const row = id ? read('SELECT status, deadline FROM asks WHERE id = ?', id) : undefined;
    return row ? [{ table: 'ask', object: `ask:${id}`, state: String(row.status), row }] : [];
  };
  const claim = (id: string | null): Target[] => {
    // A verdict or a run can land before the claim it is about: the claim is pending until its claim.made says more.
    const row = id ? read('SELECT state FROM claims WHERE id = ?', id) : undefined;
    return id ? [{ table: 'claim', object: `claim:${id}`, state: typeof row?.state === 'string' ? row.state : table('claim').initial, row: row ?? {} }] : [];
  };
  switch (e.kind) {
    case 'ask.batched':
      return Array.isArray(d.asks) ? d.asks.flatMap((a) => (isObj(a) ? ask(bare(a.ask)) : [])) : [];
    case 'decision.applied':
      return ask(bare(d.ask));
    case 'task.closed':
    case 'task.withdrawn': {
      const row = e.subject ? read('SELECT state FROM tasks WHERE task_ref = ?', e.subject) : undefined;
      return row ? [{ table: 'ask_task', object: e.subject!, state: String(row.state), row }] : [];
    }
    case 'lease.acquired':
    case 'lease.released':
    case 'lease.stale':
    case 'lease.denied': {
      // One holder's lease of one resource. A key no one holds, or held by another holder, is a new lease.
      const r = isObj(d.resource) ? d.resource : {};
      const row = read("SELECT holder, state FROM leases WHERE kind = ? AND key = ? AND state IN ('held', 'stale')", r.kind, r.key);
      const own = row !== undefined && row.holder === d.holder && e.kind !== 'lease.denied';
      return [{ table: 'lease', object: `lease:${String(r.kind)}/${String(r.key)}`, state: own ? String(row.state) : table('lease').initial, row: { holder: d.holder } }];
    }
    case 'open_item.opened':
    case 'open_item.closed': {
      const row = read('SELECT closed FROM open_items WHERE task_ref = ? AND text = ?', d.task_ref, d.text);
      return row ? [{ table: 'open_item', object: `open_item:${String(d.task_ref)}/${String(d.text)}`, state: row.closed === null ? 'open' : 'closed', row }] : [];
    }
    case 'run.started':
    case 'verdict.made':
    case 'claim.sent_back':
    case 'claim.stalled':
      return claim(bare(d.claim));
    default:
      return ASK_KINDS.has(e.kind) ? ask(bare(e.subject)) : [];
  }
}

/** The row that moves an object in `state` on this event, or the reason none does. */
function rowFor(t: Machine, state: string, e: Moving, guard: (m: MachineMove) => boolean): { move: MachineMove } | { guard?: string } {
  const rows = t.moves.filter((m) => m.from === state && m.event === e.kind);
  const move = rows.find((m) => m.guard === undefined || guard(m));
  const failed = rows[0]?.guard;
  return move ? { move } : failed !== undefined ? { guard: failed } : {};
}

/**
 * The moves this event makes, and the ones its tables refuse. An event from before the record had its gate
 * (`gated` false, on a rebuild) keeps the move it made then: a rebuild never changes what an older record held.
 */
export function gate(e: Moving, read: ReadRow, gated = true): { moves: { object: string; to: string }[]; refused: Refusal[] } {
  const moves: { object: string; to: string }[] = [];
  const refused: Refusal[] = [];
  for (const target of targets(e, read)) {
    const t = table(target.table);
    const found = rowFor(t, target.state, e, (m) => GUARDS[m.guard!]!(e, target.row, read));
    if ('move' in found) moves.push({ object: target.object, to: found.move.to });
    else if (!gated) moves.push({ object: target.object, to: target.state });
    else refused.push({ object: cap(target.object), table: t.id, state: cap(target.state), event: e.kind, event_id: e.id, ...(found.guard ? { guard: found.guard } : {}) });
  }
  return { moves, refused };
}

/** The kinds the gate reads: those that move an object whose state the record holds. */
const GATED = new Set([...ASK_KINDS, 'task.closed', 'task.withdrawn', 'lease.acquired', 'lease.released', 'lease.stale', 'lease.denied',
  'open_item.opened', 'open_item.closed', 'run.started', 'verdict.made', 'claim.sent_back', 'claim.stalled']);
/** How many objects an event can move: the log positions its refusals may take. */
export const movable = (kind: string, data: JsonValue): number =>
  !GATED.has(kind) ? 0 : kind === 'ask.batched' && isObj(data) && Array.isArray(data.asks) ? data.asks.length : 1;
