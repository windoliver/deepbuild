// The projections: every table but `events`, each a function of the events alone, in log_pos order. A
// projection reads no clock, setting, file or evidence bytes; a state that comes from time, such as a
// stale lease or a defaulted ask, comes from an event that says so. Dropping every table here and
// replaying the log rebuilds them all (design: One event log, with tables built from it).
import type { JsonValue } from '@deepbuild/contracts';
import type { Statement } from 'better-sqlite3';
import type { Db } from './storage.js';

/** One event as the projections read it: the stored row, with its data parsed and migrated. */
export interface Projected {
  id: string;
  v: number;
  kind: string;
  ts: number;
  seq: bigint | null;
  log_pos: number;
  session: string | null;
  project: string | null;
  agent: string | null;
  writer: string;
  actor: string;
  scope: string;
  subject: string | null;
  data: JsonValue;
  evidence: string[];
}

interface TableDef { name: string; pk: string[]; columns: string }
type Row = Record<string, unknown>;
type Obj = { [key: string]: JsonValue };

const T = (name: string, pk: string[], columns: string): TableDef => ({ name, pk, columns });
/** Every projection, with the columns the design's data model names (and the ones the record adds). */
export const TABLES: readonly TableDef[] = [
  T('sessions', ['id'], 'id TEXT, thread_id TEXT, parent_id TEXT, agent TEXT, project_id TEXT, worktree TEXT, branch TEXT, pid INTEGER, status TEXT NOT NULL DEFAULT \'running\', last_seen INTEGER, ended_log_pos INTEGER, transcript TEXT'),
  T('claims', ['id'], 'id TEXT, session_id TEXT, kind TEXT, subject_ref TEXT, text TEXT, created INTEGER, verdict_id TEXT, attempt INTEGER, commit_sha TEXT, round INTEGER, stalled_rule TEXT'),
  T('definitions', ['task_ref'], 'task_ref TEXT, id TEXT, thread_id TEXT, issue_rev TEXT, base_commit TEXT, requirements TEXT, budget TEXT, hash TEXT, locked_at INTEGER, state TEXT, dispute_ask TEXT'),
  T('attempts', ['task_ref', 'attempt'], 'task_ref TEXT, attempt INTEGER, session_id TEXT, child_id TEXT, worktree TEXT, base TEXT'),
  T('checks', ['id'], 'id TEXT, project_id TEXT, name TEXT, type TEXT, spec_hash TEXT, lane TEXT, min_runs INTEGER, owner TEXT, protected INTEGER'),
  T('runs', ['id'], 'id TEXT, check_id TEXT, claim_id TEXT, host TEXT, needs TEXT, commit_sha TEXT, env_fingerprint TEXT, started INTEGER, ended INTEGER, outcome TEXT, tests_run INTEGER, passed INTEGER, evidence TEXT, assertion TEXT, expected TEXT, actual TEXT, step TEXT, points_to TEXT'),
  T('verdicts', ['id'], 'id TEXT, handle TEXT, claim_id TEXT, outcome TEXT, reasons TEXT, requirements TEXT, smallest TEXT, points_to TEXT, commit_sha TEXT, key TEXT, created INTEGER, stale INTEGER NOT NULL DEFAULT 0, because TEXT'),
  T('asks', ['id'], 'id TEXT, kind TEXT, key TEXT, question TEXT, options TEXT, recommended TEXT, default_option TEXT, provisional INTEGER, session_id TEXT, owner TEXT, fallback TEXT, deadline INTEGER, later_until INTEGER, pinned_to TEXT, status TEXT NOT NULL DEFAULT \'open\', outcome TEXT NOT NULL DEFAULT \'unanswered\', batch_id TEXT, created INTEGER, answered INTEGER, answer TEXT, decision TEXT'),
  T('decisions', ['id'], 'id TEXT, key TEXT, scope TEXT, answer TEXT, by TEXT, ask_id TEXT, state TEXT, created INTEGER, overruled_by TEXT, applied INTEGER NOT NULL DEFAULT 0'),
  T('leases', ['kind', 'key'], 'kind TEXT, key TEXT, host TEXT, mode TEXT, holder TEXT, expires INTEGER, state TEXT'),
  T('evidence', ['hash'], 'hash TEXT, kind TEXT, type TEXT, size INTEGER, source TEXT, origin TEXT, redaction TEXT, license TEXT, step_times TEXT, derived_from TEXT'),
  T('commits', ['sha'], 'sha TEXT, session_id TEXT, worktree TEXT, created INTEGER'),
  T('rollups', ['source', 'span', 'start'], 'source TEXT, span TEXT, start INTEGER, evidence TEXT'),
  T('layer_rows', ['layer', 'project', 'parent', 'level'], 'layer TEXT, project TEXT, parent TEXT, level INTEGER, evidence TEXT, log_pos INTEGER'),
  T('tasks', ['task_ref'], 'task_ref TEXT, thread TEXT, state TEXT, owner TEXT, title TEXT, round INTEGER, created INTEGER, closed INTEGER, by_verdict TEXT'),
  T('open_items', ['task_ref', 'text'], 'task_ref TEXT, text TEXT, opened INTEGER, closed INTEGER'),
  T('notices', ['kind', 'key'], 'kind TEXT, key TEXT, id TEXT, subscribed_by TEXT, created INTEGER, sent INTEGER, cites TEXT'),
  T('readings', ['reading'], 'reading TEXT, value TEXT, unit TEXT, as_of INTEGER, source TEXT, n INTEGER, outside INTEGER'),
  T('plans', ['ask'], 'ask TEXT, steps TEXT, hash TEXT, diff TEXT, answered_hash TEXT'),
  T('deliveries', ['delivery'], 'delivery TEXT, via TEXT, outcome TEXT, recipient TEXT'),
  T('dry_merges', ['a', 'b'], 'a TEXT, b TEXT, conflicts TEXT, as_of INTEGER'),
  T('session_files', ['session', 'path'], 'session TEXT, path TEXT, kind TEXT, last INTEGER'),
  T('documents', ['doc'], 'doc TEXT, rev INTEGER, writer TEXT, hash TEXT'),
  T('notes', ['note'], 'note TEXT, doc TEXT, item TEXT, rev INTEGER, region TEXT, text TEXT, state TEXT, opened INTEGER, closed INTEGER, by TEXT'),
  T('suggestions', ['suggestion'], 'suggestion TEXT, doc TEXT, item TEXT, writer TEXT, base INTEGER, filed INTEGER, outcome TEXT, rev INTEGER'),
  T('returns', ['id'], 'id TEXT, session TEXT, turn INTEGER, did_work INTEGER, at INTEGER'),
  T('learned_layer', ['id'], 'id TEXT, kind TEXT, layer TEXT, target TEXT, scope TEXT, created INTEGER'),
  // The record's reading of each session's turns: which turn each event belongs to and its place in it.
  T('turns', ['session_id', 'idx'], 'session_id TEXT, idx INTEGER, number INTEGER, start_seq INTEGER, start_id TEXT, stop_seq INTEGER, stopped INTEGER NOT NULL DEFAULT 0, last_seq INTEGER, last_id TEXT'),
  T('turn_events', ['event_id'], 'event_id TEXT, session_id TEXT, turn_idx INTEGER, eff_seq INTEGER, eff_id TEXT, log_pos INTEGER'),
  T('session_readings', ['session_id', 'reading'], 'session_id TEXT, reading TEXT, since INTEGER'),
];
/** The record's reading of turns is keyed by event IDs; it serves `session()` and is not a listed projection. */
const INTERNAL = new Set(['turns', 'turn_events']);
export const PROJECTIONS: readonly string[] = TABLES.filter((t) => !INTERNAL.has(t.name)).map((t) => t.name);
const byName = new Map(TABLES.map((t) => [t.name, t]));
export const tableDef = (name: string): TableDef | undefined => byName.get(name);

interface Turn { idx: number; number: number | null; startSeq: bigint | null; startId: string; stopSeq: bigint | null; stopped: boolean; lastSeq: bigint | null; lastId: string }

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Whether key (seq, id) sorts after key (seq2, id2): by stamp, a null stamp first, ties by ID. */
const after = (seq: bigint | null, id: string, seq2: bigint | null, id2: string): boolean =>
  seq === seq2 ? id > id2 : seq2 === null ? true : seq === null ? false : seq > seq2;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : v === null || v === undefined ? null : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : typeof v === 'boolean' ? Number(v) : null);
const json = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v));
/** A handle's ID: `claim:01K…` reads as `01K…`. */
const bare = (v: unknown): string | null => (typeof v === 'string' ? v.replace(/^[a-z_]+:/, '') : null);
/** The session a handle names: session:<id>, or session:<id>#<message> for a message of it. */
const sessionOf = (v: unknown): string | null => (typeof v === 'string' && v.startsWith('session:') ? v.slice(8).split('#')[0]! : null);
const TOOL = new Set(['tool.before', 'tool.after']);
const ENDED = new Set(['finished', 'failed']);

export class Projector {
  private readonly statements = new Map<string, Statement<unknown[]>>();
  private readonly turns = new Map<string, Turn[]>();

  constructor(private readonly db: Db) {}

  /** Creates each table that is missing. */
  ensure(): void {
    for (const t of TABLES) this.db.exec(`CREATE TABLE IF NOT EXISTS ${t.name} (${t.columns}, PRIMARY KEY (${t.pk.join(', ')})) STRICT`);
  }
  /** Drops every projection, so a replay starts from nothing. */
  drop(): void {
    for (const t of TABLES) this.db.exec(`DROP TABLE IF EXISTS ${t.name}`);
    this.statements.clear();
    this.turns.clear();
    this.ensure();
  }
  /** Forgets cached state, so the next event reads the tables as they are. */
  forget(): void {
    this.turns.clear();
  }

  private stmt(sql: string) {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }
  /** Inserts the row, or updates the named columns of the row with its key. */
  private up(table: string, row: Row): void {
    const def = byName.get(table)!;
    const cols = Object.keys(row);
    const rest = cols.filter((c) => !def.pk.includes(c));
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT (${def.pk.join(', ')}) DO ${rest.length ? `UPDATE SET ${rest.map((c) => `${c} = excluded.${c}`).join(', ')}` : 'NOTHING'}`;
    this.stmt(sql).run(...cols.map((c) => row[c] ?? null));
  }
  /** Inserts the row only when none has its key. */
  private add(table: string, row: Row): void {
    const cols = Object.keys(row);
    this.stmt(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`).run(...cols.map((c) => row[c] ?? null));
  }
  /** Updates the named columns of the rows the where clause names; a row that isn't there stays absent. */
  private set(table: string, values: Row, where: Row): void {
    const cols = Object.keys(values);
    const keys = Object.keys(where);
    this.stmt(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')}`).run(...cols.map((c) => values[c] ?? null), ...keys.map((k) => where[k] ?? null));
  }

  apply(e: Projected): void {
    const d: Obj = isObj(e.data) ? e.data : {};
    if (e.session) {
      this.up('sessions', { id: e.session, last_seen: e.ts });
      // A new prompt resumes a session that had finished: it is active again until its next end.
      if (e.kind === 'user.ask') this.stmt("UPDATE sessions SET status = 'running', ended_log_pos = NULL WHERE id = ? AND status IN ('finished', 'failed')").run(e.session);
      this.turn(e, d);
    }
    switch (e.kind) {
      case 'session.start':
        if (e.session) this.up('sessions', { id: e.session, agent: str(d.agent), worktree: str(d.worktree), branch: str(d.branch), thread_id: str(d.thread), project_id: e.project });
        break;
      case 'session.attention': {
        // A hook speaks only for its own session; the app and the core may name another.
        const id = e.writer === 'hook' ? e.session : sessionOf(e.subject) ?? e.session;
        const state = str(d.state);
        if (id) this.up('sessions', { id, status: state, ended_log_pos: state && ENDED.has(state) ? e.log_pos : null });
        break;
      }
      case 'session.child_started': {
        const child = bare(d.child);
        if (child) this.up('sessions', { id: child, parent_id: bare(d.parent) });
        break;
      }
      case 'worktree.created': {
        const owner = sessionOf(d.owner);
        if (owner) this.up('sessions', { id: owner, worktree: str(d.path), branch: str(d.branch) });
        break;
      }
      case 'worktree.removed': {
        // Only the worktree it names: the session may have moved to another since.
        const owner = sessionOf(d.owner);
        if (owner) this.stmt('UPDATE sessions SET worktree = NULL, branch = NULL WHERE id = ? AND worktree = ?').run(owner, str(d.path));
        break;
      }
      case 'transcript.archived': {
        const session = bare(d.session);
        if (session) this.up('sessions', { id: session, transcript: str(d.evidence) });
        this.up('evidence', { hash: str(d.evidence), kind: 'transcript' });
        break;
      }
      case 'agent.stop':
        this.up('returns', { id: e.id, session: e.session, turn: int(d.turn), did_work: int(d.did_work), at: e.ts });
        break;
      case 'tool.before':
      case 'tool.after':
        if (e.session && Array.isArray(d.paths)) for (const path of d.paths) if (typeof path === 'string') this.up('session_files', { session: e.session, path, kind: str(d.kind), last: e.ts });
        break;
      case 'claim.made': {
        const commit = str(d.commit);
        this.up('claims', { id: e.id, session_id: e.session, kind: str(d.scope), subject_ref: str(d.task_ref), created: e.ts, attempt: int(d.attempt), commit_sha: commit });
        const attempt = int(d.attempt);
        if (attempt !== null && typeof d.task_ref === 'string') this.up('attempts', { task_ref: d.task_ref, attempt, session_id: e.session, base: commit });
        if (commit) this.up('commits', { sha: commit, session_id: e.session, created: e.ts });
        break;
      }
      case 'claim.sent_back':
        this.set('claims', { round: int(d.round) }, { id: bare(d.claim) });
        break;
      case 'claim.stalled':
        this.set('claims', { stalled_rule: str(d.rule) }, { id: bare(d.claim) });
        break;
      case 'verdict.made': {
        const claim = bare(d.claim);
        this.up('verdicts', { id: e.id, handle: str(d.verdict), claim_id: claim, outcome: str(d.outcome), reasons: json(d.reasons), requirements: json(d.requirements), smallest: str(d.smallest), points_to: str(d.points_to), commit_sha: str(d.commit), key: json(d.key), created: e.ts });
        // An upsert: a verdict commits FULL at once and can land before the queued claim it judges.
        this.up('claims', { id: claim, verdict_id: e.id });
        break;
      }
      case 'verdict.stale':
        this.stmt('UPDATE verdicts SET stale = 1, because = ? WHERE handle = ? OR id = ?').run(str(d.because), str(d.verdict), bare(d.verdict));
        break;
      case 'ask.created':
        this.up('asks', { id: e.id, kind: str(d.kind), key: str(d.key), question: str(d.question), options: json(d.options), recommended: str(d.recommended), default_option: json(d.default), provisional: int(d.provisional), session_id: e.session, owner: str(d.owner), fallback: json(d.fallback), deadline: int(d.deadline), pinned_to: json(d.pinned_to), created: e.ts });
        break;
      case 'ask.answered':
      case 'ask.defaulted': {
        // Only the core appends these: the answer and its decision come from them alone.
        const status = e.kind.slice(4);
        const ask = bare(e.subject);
        this.up('asks', { id: ask, status, outcome: status, answered: e.ts, answer: json(d.answer), decision: str(d.decision) });
        // The plan digest your yes bound, for the plan this ask showed.
        if (e.kind === 'ask.answered' && typeof d.plan_hash === 'string') this.up('plans', { ask, answered_hash: d.plan_hash });
        break;
      }
      case 'ask.escalated':
      case 'ask.cancelled':
      case 'ask.moot':
      case 'ask.superseded': {
        // An ask closed without an answer is never asked again; one already decided keeps its answer.
        const status = e.kind.slice(4);
        this.stmt("UPDATE asks SET status = ?, outcome = ? WHERE id = ? AND status NOT IN ('answered', 'defaulted', 'decided')").run(status, status, bare(e.subject));
        break;
      }
      case 'ask.later':
        // Only an ask still waiting can wait longer.
        this.stmt("UPDATE asks SET status = 'later', later_until = ? WHERE id = ? AND status IN ('open', 'later')").run(int(d.until), bare(e.subject));
        break;
      case 'ask.batched':
        if (Array.isArray(d.asks)) for (const a of d.asks) if (isObj(a)) this.set('asks', { batch_id: str(d.batch) }, { id: bare(a.ask) });
        break;
      case 'decision.created':
        this.up('decisions', { id: e.id, key: str(d.key), scope: json(d.scope), answer: json(d.answer), by: e.actor, ask_id: bare(d.ask), state: 'active', created: e.ts });
        break;
      case 'decision.applied':
        this.up('asks', { id: bare(d.ask), status: 'decided', outcome: 'decided_for_you', answered: e.ts });
        this.stmt('UPDATE decisions SET applied = applied + 1 WHERE id = ?').run(bare(d.decision));
        break;
      case 'definition.drafted':
        this.add('definitions', this.definition(d, 'drafted', null));
        break;
      case 'definition.locked': {
        // One per ask, shared by every attempt: the first lock stands, and a draft is what it locks.
        const row = this.stmt('SELECT state FROM definitions WHERE task_ref = ?').get(str(d.task_ref)) as { state: string } | undefined;
        if (!row || row.state === 'drafted') this.up('definitions', this.definition(d, 'locked', e.ts));
        break;
      }
      case 'definition.revised':
        this.up('definitions', { ...this.definition(d, 'revised', e.ts), dispute_ask: str(d.dispute_ask) });
        break;
      case 'run.started':
        // A run's claim, check and commit are fixed by its first start: a later start of the same run changes nothing.
        this.add('runs', { id: bare(d.run), check_id: str(d.check), claim_id: bare(d.claim), commit_sha: str(d.commit), started: e.ts });
        this.up('checks', { id: str(d.check), name: str(d.check) });
        break;
      case 'run.finished':
        this.up('runs', { id: bare(d.run), check_id: str(d.check), ended: e.ts, outcome: str(d.outcome), tests_run: int(d.tests_run), passed: int(d.passed), evidence: json(d.evidence), assertion: str(d.assertion), expected: str(d.expected), actual: str(d.actual), step: str(d.step), points_to: str(d.points_to) });
        this.up('checks', { id: str(d.check), name: str(d.check) });
        break;
      case 'task.created':
        this.up('tasks', { task_ref: str(d.task_ref), thread: str(d.thread), owner: str(d.owner), title: str(d.title), state: 'queued', created: e.ts });
        break;
      case 'task.closed':
        this.set('tasks', { state: 'closed', closed: e.ts, by_verdict: str(d.by_verdict) }, { task_ref: e.subject });
        break;
      case 'pr.merged':
        this.up('commits', { sha: str(d.merge_sha), session_id: e.session, created: e.ts });
        break;
      case 'open_item.opened':
        this.up('open_items', { task_ref: str(d.task_ref), text: str(d.text), opened: e.ts, closed: null });
        break;
      case 'open_item.closed':
        this.set('open_items', { closed: e.ts }, { task_ref: str(d.task_ref), text: str(d.text) });
        break;
      case 'notice.subscribed':
        this.up('notices', { kind: str(d.notice_kind), key: str(d.key), id: e.id, subscribed_by: str(d.by), created: e.ts });
        break;
      case 'notice.sent':
        this.set('notices', { sent: e.ts, cites: json(d.cites) }, { id: bare(d.notice) });
        break;
      case 'reading.recorded':
        this.up('readings', { reading: str(d.reading), value: json(d.value), unit: str(d.unit), as_of: int(d.as_of), source: str(d.source), n: int(d.n), outside: int(d.outside) });
        break;
      case 'reading.rollup':
        this.up('rollups', { source: str(d.source), span: str(d.span), start: int(d.start), evidence: str(d.file) });
        break;
      case 'layer.rows':
        this.up('layer_rows', { layer: str(d.layer), project: str(d.project), parent: str(d.parent) ?? '', level: int(d.level), evidence: str(d.file), log_pos: e.log_pos });
        break;
      case 'plan.proposed':
        this.up('plans', { ask: bare(d.ask), steps: json(d.steps), hash: str(d.hash), diff: str(d.diff) });
        break;
      case 'delivery.outcome':
        this.up('deliveries', { delivery: bare(d.delivery), via: str(d.via), outcome: str(d.outcome) });
        break;
      case 'merge.dry_run':
        this.up('dry_merges', { a: str(d.a), b: str(d.b), conflicts: json(d.conflicts), as_of: e.ts });
        break;
      case 'evidence.put':
        // A put never relabels a file already recorded: the core's evidence.stored is the store's own record.
        this.add('evidence', { hash: str(d.sha256), kind: str(d.kind), source: str(d.source), origin: str(d.origin), redaction: str(d.redaction), license: str(d.license), step_times: json(d.step_times) });
        break;
      case 'evidence.stored':
        this.up('evidence', { hash: str(d.sha256), kind: str(d.kind), type: str(d.type), size: int(d.size), origin: str(d.origin), redaction: str(d.redaction), license: str(d.license), step_times: json(d.step_times), derived_from: json(d.derived_from) });
        break;
      case 'evidence.removed':
        this.stmt('DELETE FROM evidence WHERE hash = ?').run(str(d.sha256));
        break;
      case 'doc.patched':
        this.up('documents', { doc: str(d.doc), rev: int(d.rev), writer: str(d.writer) });
        break;
      case 'note.opened':
        this.up('notes', { note: bare(d.note), doc: str(d.doc), item: str(d.item), rev: int(d.rev), region: json(d.region), text: str(d.text), state: 'open', opened: e.ts });
        break;
      case 'note.closed':
        this.set('notes', { state: 'closed', closed: e.ts, by: str(d.by), rev: int(d.rev) }, { note: bare(d.note) });
        break;
      case 'suggestion.filed':
        this.up('suggestions', { suggestion: bare(d.suggestion), doc: str(d.doc), item: str(d.item), writer: str(d.writer), base: int(d.base), filed: e.ts });
        break;
      case 'suggestion.settled':
        this.set('suggestions', { outcome: str(d.outcome), rev: int(d.rev) }, { suggestion: bare(d.suggestion) });
        break;
      case 'lease.acquired':
      case 'lease.released':
      case 'lease.stale':
      case 'lease.denied': {
        const r = isObj(d.resource) ? d.resource : {};
        const state = { 'lease.acquired': 'held', 'lease.released': 'released', 'lease.stale': 'stale', 'lease.denied': 'denied' }[e.kind];
        const row = { kind: str(r.kind), key: str(r.key), host: str(r.host), mode: str(d.mode), holder: str(d.holder), expires: int(d.expires), state };
        if (e.kind !== 'lease.denied') this.up('leases', row);
        else {
          // A denial is not a lease: it takes the key's row only while no one holds it.
          const held = this.stmt("SELECT state FROM leases WHERE kind = ? AND key = ? AND state IN ('held', 'stale')").get(row.kind, row.key);
          if (!held) this.up('leases', row);
        }
        break;
      }
      case 'learn.proposed':
      case 'learn.applied':
      case 'learn.widened':
      case 'learn.rolled_back':
        this.up('learned_layer', { id: e.id, kind: e.kind, layer: str(d.layer), target: json(d.target), scope: json(d.scope), created: e.ts });
        break;
      default:
        break;
    }
  }

  private definition(d: Obj, state: string, lockedAt: number | null): Row {
    return { task_ref: str(d.task_ref), id: bare(d.definition), base_commit: str(d.base_commit), requirements: json(d.requirements), budget: json(d.budget), hash: str(d.hash), state, locked_at: lockedAt };
  }

  // ---- Turns (design: Hooks are evidence, not a state machine: Order).

  private turnsOf(session: string): Turn[] {
    let turns = this.turns.get(session);
    if (!turns) {
      const rows = this.stmt('SELECT idx, number, start_seq, start_id, stop_seq, stopped, last_seq, last_id FROM turns WHERE session_id = ? ORDER BY idx').safeIntegers(true).all(session) as
        { idx: bigint; number: bigint | null; start_seq: bigint | null; start_id: string; stop_seq: bigint | null; stopped: bigint; last_seq: bigint | null; last_id: string }[];
      turns = rows.map((r) => ({ idx: Number(r.idx), number: r.number === null ? null : Number(r.number), startSeq: r.start_seq, startId: r.start_id, stopSeq: r.stop_seq, stopped: r.stopped !== 0n, lastSeq: r.last_seq, lastId: r.last_id }));
      this.turns.set(session, turns);
    }
    return turns;
  }
  private saveTurn(session: string, t: Turn): void {
    this.up('turns', { session_id: session, idx: t.idx, number: t.number, start_seq: t.startSeq, start_id: t.startId, stop_seq: t.stopSeq, stopped: t.stopped ? 1 : 0, last_seq: t.lastSeq, last_id: t.lastId });
  }

  private turn(e: Projected, d: Obj): void {
    const session = e.session!;
    const turns = this.turnsOf(session);
    const open = turns.length && !turns[turns.length - 1]!.stopped ? turns[turns.length - 1]! : undefined;
    const lastStop = turns.reduce<bigint | null>((max, t) => (t.stopSeq !== null && (max === null || t.stopSeq > max) ? t.stopSeq : max), null);
    let turn: Turn | undefined;
    if (e.kind === 'user.ask') {
      if (open) turn = open;
      else {
        turn = { idx: turns.length, number: null, startSeq: e.seq, startId: e.id, stopSeq: null, stopped: false, lastSeq: null, lastId: '' };
        turns.push(turn);
      }
      if (e.seq !== null && lastStop !== null && e.seq < lastStop) this.add('session_readings', { session_id: session, reading: 'clock went back', since: e.log_pos });
    } else if (e.kind === 'agent.stop') {
      if (open) turn = open;
      else {
        turn = { idx: turns.length, number: null, startSeq: e.seq, startId: e.id, stopSeq: null, stopped: false, lastSeq: null, lastId: '' };
        turns.push(turn);
      }
      turn.stopped = true;
      turn.stopSeq = e.seq;
      turn.number = int(d.turn);
      if (e.seq !== null && lastStop !== null && e.seq < lastStop) this.add('session_readings', { session_id: session, reading: 'clock went back', since: e.log_pos });
    } else if (TOOL.has(e.kind) && e.seq !== null) {
      // The turn its call began in: the open turn when its stamp is in it, else the stopped turn whose
      // span holds the stamp, newest first; a late PostToolUse joins its stopped turn and reopens nothing.
      if (open && open.startSeq !== null && e.seq >= open.startSeq) turn = open;
      else {
        for (let i = turns.length - 1; i >= 0 && !turn; i--) {
          const t = turns[i]!;
          if (t.stopped && t.startSeq !== null && t.stopSeq !== null && e.seq >= t.startSeq && e.seq <= t.stopSeq) turn = t;
        }
        // A PostToolUse stamped after its turn's stop, with no turn open since: that turn's, still stopped.
        const newest = turns[turns.length - 1];
        turn ??= open ?? (newest?.stopped && newest.stopSeq !== null && e.seq > newest.stopSeq ? newest : undefined);
      }
    } else turn = open;
    if (!turn) return;
    // Its place: by stamp, ties by ID; a stamp before the turn's start reads as the greatest key of the
    // turn's events so far, so it sorts after every one that arrived before it, and after the one whose key
    // it took by log_pos.
    let effSeq = e.seq, effId = e.id;
    if (turn.lastId && (e.seq === null || (turn.startSeq !== null && e.seq < turn.startSeq))) {
      effSeq = turn.lastSeq;
      effId = turn.lastId;
    }
    if (!turn.lastId || after(effSeq, effId, turn.lastSeq, turn.lastId)) {
      turn.lastSeq = effSeq;
      turn.lastId = effId;
    }
    this.up('turn_events', { event_id: e.id, session_id: session, turn_idx: turn.idx, eff_seq: effSeq, eff_id: effId, log_pos: e.log_pos });
    this.saveTurn(session, turn);
  }
}
