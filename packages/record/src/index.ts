// @deepbuild/record: the append-only SQLite event log and the projections built from it (#14).
//
// The `events` table is the source of truth. Every other table is a projection the record rebuilds by
// replaying it. An event's ID is its identity; its `seq` is its order within its session; its `log_pos`
// is its position in the log, assigned here at append inside the commit that writes it.
import { randomBytes } from 'node:crypto';
import { canonicalize, listSchemas, registry, sha256Hex } from '@deepbuild/contracts';
import type { JsonValue, Registry, SchemaEntry } from '@deepbuild/contracts';
import { scrubText } from '@deepbuild/evidence';
import type { EvidenceStore, Writer as EvidenceWriter } from '@deepbuild/evidence';
import { CHECKED, readEvidence, ROLLERS, startSlice, toRollBack, transcriptsCited, type LearnedChange, type SliceEntry, type Transcripts } from './learned.js';
import { PROJECTIONS, Projector, tableDef, type Projected } from './projections.js';
import { fileStorage, isBackend, testStorage, type Backend, type Db, type Durability, type Storage, type SyncCall, type TestStorage } from './storage.js';

export { PROJECTIONS, testStorage };
export type { SliceEntry, Storage, SyncCall, TestStorage };

/** What the hub's socket proved about a writer's connection (#16 proves it; the record only reads it). */
export interface Connection {
  writer: string;
  actor: string;
  scope: string;
  session?: string;
  project?: string;
  agent?: string;
  run?: { env?: Readonly<Record<string, string>>; held?: readonly string[] };
}
/** The payload: an event without what the connection supplies. */
export interface EventInput {
  v: number;
  id: string;
  kind: string;
  subject?: string;
  ts: number;
  seq?: string;
  data: JsonValue;
  evidence?: readonly string[];
}
/** An event read back from the log. */
export interface Event {
  v: number;
  id: string;
  kind: string;
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos: number;
  data: JsonValue;
  evidence: string[];
  session?: string;
  project?: string;
  agent?: string;
}
export interface Appended { log_pos: number; existing: boolean }
export type RecordErrorCode = 'schema' | 'forged' | 'writer' | 'conflict' | 'storage' | 'closed';

export class RecordError extends Error {
  readonly code: RecordErrorCode;
  readonly path?: string;
  readonly kind?: string;
  readonly id?: string;
  constructor(code: RecordErrorCode, message: string, named: { path?: string; kind?: string; id?: string } = {}) {
    super(message);
    this.name = 'RecordError';
    this.code = code;
    if (named.path !== undefined) this.path = named.path;
    if (named.kind !== undefined) this.kind = named.kind;
    if (named.id !== undefined) this.id = named.id;
  }
}

/** A forward-only migration of one kind's data from one schema version to the next. */
export interface Migration { kind: string; from: number; to: number; up(data: JsonValue): JsonValue }

export interface RecordOptions {
  path: string;
  now: () => number;
  storage?: Storage;
  evidence?: EvidenceStore;
  contentFree?: boolean;
  schemas?: readonly SchemaEntry[];
  migrations?: readonly Migration[];
}
export interface Row { [column: string]: unknown }
export interface Table { name: string; primaryKey: string[]; rows: Row[] }
export interface TurnView { turn: number | null; stopped: boolean; events: string[] }
export interface SessionView { id: string; status: string; readings: string[]; turns: TurnView[] }

export interface RecordStore {
  append(connection: Connection, event: EventInput): Promise<Appended>;
  read(query: { after: number; limit?: number }): Promise<Event[]>;
  table(name: string): Promise<Table>;
  session(id: string): Promise<SessionView | undefined>;
  rebuild(): Promise<void>;
  raw(sql: string): Promise<unknown[]>;
  /** What a session reads at its start, and, for the rules you typed, at its next prompt (#62). */
  startSlice(session: string): Promise<SliceEntry[]>;
  /**
   * Rolls back one learned change, by its event's ID, or every learned change in force since a time: one
   * learn.rolled_back each, newest first, through the connection; nothing is deleted. Resolves with the
   * compensated changes' IDs, in that order.
   */
  rollBack(connection: Connection, what: { change: string } | { since: number }): Promise<string[]>;
  close(): Promise<void>;
}

/** The record's JSON for one event: seq as its decimal string. */
export const toJson = (event: Event): string => JSON.stringify(event, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

/** A field longer than this is scrubbed whole, then cut; the whole scrubbed text is evidence by hash. */
const CUT = 8192;
/** Log positions are handed out from a block recorded durably before any of it is used. */
const BLOCK = 1024;
const SCHEMA_VERSION = 1;
/** Events a replay reads at a time. */
const REPLAY_PAGE = 5000;
/** The kinds that record a decision: only the core appends them, and each commits FULL, in its own commit. */
const CORE_ONLY = new Set(['verdict.made', 'verdict.stale', 'definition.locked', 'definition.revised', 'decision.created', 'decision.applied', 'ask.answered', 'ask.defaulted']);
/** The evidence store's own events: only the core, which runs the store, appends them; they stream. */
const STORE_ONLY = new Set(['evidence.stored', 'evidence.removed']);
/** The core's check of a learned change: only the core appends it, in the change's own batch. */
const LEARN_CHECK = 'learn_check.made';
/** Parsed transcripts kept for the next learned change's reading, newest last. */
const TRANSCRIPTS_KEPT = 4;
/** The text field each kind keeps of a hook payload: scrubbed, then cut. */
const TEXT_FIELD: Readonly<Record<string, string>> = { 'tool.before': 'command', 'tool.after': 'command', 'permission.request': 'command', 'user.ask': 'text', 'task.completed': 'title' };
/** What content-free mode keeps of each text field: nothing its schema allows. */
const BLANK: Readonly<Record<string, string | null>> = { command: null, text: '', title: '-' };

const DDL = `
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  log_pos     INTEGER NOT NULL UNIQUE,
  v           INTEGER NOT NULL,
  ts          INTEGER NOT NULL,
  project_id  TEXT,
  session_id  TEXT,
  seq         INTEGER,
  agent       TEXT,
  writer      TEXT NOT NULL,
  actor       TEXT NOT NULL,
  scope       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  subject     TEXT,
  data        TEXT NOT NULL,
  evidence    TEXT,
  hash        TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS events_session ON events (session_id, log_pos);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events is append-only: no UPDATE'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events is append-only: no DELETE'); END;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS lost_sessions (session TEXT PRIMARY KEY) STRICT;
`;

type Obj = { [key: string]: JsonValue };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID minted now: 48 bits of time, 80 of randomness. */
function ulid(ms: number): string {
  let out = '';
  let time = BigInt(ms);
  for (let i = 0; i < 10; i++) { out = CROCKFORD[Number(time & 31n)] + out; time >>= 5n; }
  let random = BigInt(`0x${randomBytes(10).toString('hex')}`);
  let tail = '';
  for (let i = 0; i < 16; i++) { tail = CROCKFORD[Number(random & 31n)] + tail; random >>= 5n; }
  return out + tail;
}
/** A string cut to at most `max` UTF-16 units without splitting a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = text.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
  return kept;
}

/** One event ready to commit: validated, scrubbed, with what the connection supplies. */
interface Prepared {
  input: EventInput;
  writer: string;
  actor: string;
  scope: string;
  session: string | null;
  project: string | null;
  agent: string | null;
  seq: bigint | null;
  data: JsonValue;
  evidence: string[];
  hash: string;
  /** The whole scrubbed text when the event keeps only its first part. */
  whole?: string;
}
interface Pending { prepared: Prepared; resolve(appended: Appended): void; reject(error: Error): void }
type Outcome = { ok: true; appended: Appended; prepared: Prepared; log_pos: number } | { ok: false; error: RecordError; prepared: Prepared };

class SqliteRecord implements RecordStore {
  private readonly db: Db;
  private readonly backend: Backend;
  private readonly projector: Projector;
  private readonly registry: Registry;
  private readonly versions = new Map<string, number[]>();
  private readonly migrations = new Map<string, Migration>();
  private readonly evidenceWriter: EvidenceWriter | undefined;
  private readonly queue: Pending[] = [];
  private scheduled = false;
  /** The one stop every close waits for, once a close began. */
  private closing: Promise<void> | undefined;
  private inFlight = 0;
  /** Sessions whose events this run failed to append: their next claims read INVALID, cause events lost. */
  private readonly lost = new Set<string>();
  /** The append still running for each event ID: the next one for that ID waits for it, so it finds it in the log. */
  private readonly byId = new Map<string, Promise<unknown>>();
  /** Set after a start with no clean stop: a session this record never kept may have lost its events. */
  private unclean = false;
  private next = 1;
  private blockEnd = 1;
  private readonly transcripts: Transcripts = new Map();
  /** The rollback running now, which the next one waits for. */
  private rolling: Promise<unknown> = Promise.resolve();
  /** Set when a projection an older version made had other columns: the open replays the log before any read. */
  readonly stale: boolean;

  constructor(private readonly options: RecordOptions, backend: Backend) {
    this.backend = backend;
    this.db = backend.open(options.path);
    // The version first, before any DDL: a record a newer version wrote is refused as it was found.
    const hasMeta = this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'meta'").get();
    const schema = hasMeta ? Number((this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined)?.value ?? SCHEMA_VERSION) : SCHEMA_VERSION;
    if (schema > SCHEMA_VERSION) {
      backend.close(this.db);
      throw new RecordError('storage', `the record is at schema ${schema}, newer than this version's ${SCHEMA_VERSION}; migrations only move forward`);
    }
    this.db.exec(DDL);
    this.projector = new Projector(this.db);
    this.stale = this.projector.ensure();
    const entries = [...listSchemas(), ...(options.schemas ?? [])];
    this.registry = registry(entries);
    for (const { schema } of entries) {
      const properties = isObj(schema.properties) ? schema.properties : {};
      const kind = isObj(properties.kind) ? properties.kind.const : undefined;
      const version = isObj(properties.v) ? properties.v.const : undefined;
      if (typeof kind === 'string' && typeof version === 'number') this.versions.set(kind, [...(this.versions.get(kind) ?? []), version].sort((a, b) => a - b));
    }
    for (const m of options.migrations ?? []) {
      // Forward only, one step per version, so a replay through them always ends.
      if (!(m.to > m.from)) throw new RecordError('schema', `migration ${m.kind}@${m.from} must move forward, not to ${m.to}`, { kind: m.kind, path: '/migrations' });
      if (this.migrations.has(`${m.kind}@${m.from}`)) throw new RecordError('schema', `two migrations start at ${m.kind}@${m.from}`, { kind: m.kind, path: '/migrations' });
      this.migrations.set(`${m.kind}@${m.from}`, m);
    }
    this.evidenceWriter = options.evidence?.connect({ role: 'deepbuild', via: 'job' });
  }

  /** Reads the record's state, marks this run as started, and finds the events a cut lost. */
  start(): void {
    const meta = new Map((this.db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    this.next = Number(meta.get('log_block_end') ?? 1);
    for (const row of this.db.prepare('SELECT session FROM lost_sessions').all() as { session: string }[]) this.lost.add(row.session);
    this.blockEnd = this.next;
    const wasRunning = meta.get('state') === 'running';
    const durable = Number(meta.get('durable') ?? 0);
    // A cut's fact outlives clean restarts: a session whose start it lost is judged at its claim, whenever that comes.
    this.unclean = wasRunning || meta.get('cut') === '1';
    // A FULL commit: a cut after this open that loses it would read the earlier clean stop as this run's.
    this.commitMeta({ schema: String(SCHEMA_VERSION), state: 'running', ...(this.unclean ? { cut: '1' } : {}) });
    if (wasRunning) this.recover(durable);
  }

  /** Runs `work` in one synchronous=FULL commit, which also records how far the log is durable. */
  private full(work: () => void): void {
    this.backend.commit(this.db, 'full', () => {
      work();
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('durable', (SELECT coalesce(max(log_pos), 0) FROM events)) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run();
    });
  }
  private commitMeta(values: Record<string, string>): void {
    const put = this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    this.full(() => {
      for (const [key, value] of Object.entries(values)) put.run(key, value);
    });
  }
  /** Reserves log positions durably before any of them is handed out, so a cut skips but never repeats one. */
  private reserve(count: number): void {
    if (this.next + count <= this.blockEnd) return;
    const end = Math.max(this.blockEnd, this.next) + Math.max(BLOCK, count);
    this.commitMeta({ log_block_end: String(end) });
    this.blockEnd = end;
  }

  /**
   * After a start with no clean stop recorded, every claim still open is INVALID, cause events lost,
   * unless its session had ended before the last synchronous=FULL commit, whatever that commit wrote:
   * `lastFull` is the log position that commit recorded as durable.
   */
  private recover(lastFull: number): void {
    // Every session still active at that commit may have lost its tail, a claim of its own included: its
    // next claim, surviving here or replayed from a spool, reads INVALID.
    // Ended means nothing of the session reached the log after its end and no turn of it is open: a finish
    // that landed late, after it resumed, exempts nothing.
    const active = this.db.prepare("SELECT id FROM sessions s WHERE NOT (status IN ('finished', 'failed') AND ended_log_pos IS NOT NULL AND ended_log_pos <= ? AND NOT EXISTS (SELECT 1 FROM events e WHERE e.session_id = s.id AND e.log_pos > s.ended_log_pos) AND NOT EXISTS (SELECT 1 FROM turns t WHERE t.session_id = s.id AND t.stopped = 0))").all(lastFull) as { id: string }[];
    const mark = this.db.prepare('INSERT OR IGNORE INTO lost_sessions (session) VALUES (?)');
    this.backend.commit(this.db, 'normal', () => { for (const { id } of active) mark.run(id); });
    for (const { id } of active) this.lost.add(id);
    const open = this.db.prepare('SELECT id, session_id FROM claims WHERE verdict_id IS NULL ORDER BY created, id').all() as { id: string; session_id: string | null }[];
    // Chosen before any verdict: a verdict clears its session's mark, and every open claim of a lost session is INVALID.
    const judged = open.filter((claim) => !claim.session_id || this.lost.has(claim.session_id));
    for (const claim of judged) this.invalidate(claim.id);
  }
  /** The record, as the core, appends the verdict that a claim's stream events were lost. */
  private invalidate(claimId: string): void {
    const claim = this.db.prepare('SELECT actor, scope, session_id, data FROM events WHERE id = ?').get(claimId) as { actor: string; scope: string; session_id: string | null; data: string } | undefined;
    if (!claim) return;
    const data = JSON.parse(claim.data) as Obj;
    const commit = typeof data.commit === 'string' ? data.commit : '0'.repeat(40);
    const ts = this.options.now();
    const id = ulid(ts);
    const connection: Connection = { writer: 'core', actor: claim.actor, scope: claim.scope, ...(claim.session_id ? { session: claim.session_id } : {}) };
    const input: EventInput = {
      v: 1, id, kind: 'verdict.made', ts, subject: `claim:${claimId}`,
      data: {
        outcome: 'INVALID', verdict: `verdict:${id}`, claim: `claim:${claimId}`, reasons: ['events lost'], requirements: [],
        smallest: 'events lost: stream events of the session were not appended', points_to: null, commit,
        key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: 'deepbuild-record', tools: [] },
      },
    };
    // The loss is answered in the verdict's own commit: a later claim of the session stands on its own.
    const session = claim.session_id;
    const forget = this.db.prepare('DELETE FROM lost_sessions WHERE session = ?');
    const [outcome] = this.commit([this.sealed(this.prepare(connection, input))], 'full', () => { if (session) forget.run(session); });
    if (!outcome!.ok) throw outcome!.error;
    if (session) this.lost.delete(session);
  }

  /**
   * After an unclean start, a session whose start isn't in the log lost it in the cut, with no durable
   * trace: an acknowledged event is never respooled. Asked at its claim, whatever order its hooks arrived in.
   */
  private startCut(session: string): boolean {
    // Judged once: after the record's own loss verdict on one of its claims, the next stands on its own.
    return this.unclean && !this.db.prepare("SELECT 1 FROM events WHERE session_id = ? AND kind = 'session.start' LIMIT 1").get(session)
      && !this.db.prepare("SELECT 1 FROM verdicts v JOIN claims c ON c.id = v.claim_id WHERE c.session_id = ? AND v.reasons LIKE '%events lost%' LIMIT 1").get(session);
  }

  /** A session's event failed to reach the log: its next claim reads INVALID, across a clean stop too. */
  private markLost(session: string): void {
    this.lost.add(session);
    try {
      this.backend.commit(this.db, 'normal', () => this.db.prepare('INSERT OR IGNORE INTO lost_sessions (session) VALUES (?)').run(session));
    } catch {
      // The storage is refusing writes; the set remembers until the stop, which writes it again.
    }
  }

  // ---- Append.

  /** The synchronous part of an append: what the connection supplies, the forged fields, the writer rule and the schema. */
  private prepare(connection: Connection, input: EventInput): Prepared {
    for (const field of ['actor', 'scope', 'log_pos'] as const) {
      if (Object.hasOwn(input, field)) throw new RecordError('forged', `the payload carries ${field}, which only the connection or the hub supplies`, { path: `/${field}` });
    }
    const kind = typeof input.kind === 'string' ? input.kind : '';
    if ((CORE_ONLY.has(kind) || STORE_ONLY.has(kind) || kind === LEARN_CHECK) && connection.writer !== 'core') throw new RecordError('writer', `${kind} is appended only by the core, not by ${connection.writer}`, { kind });
    const versions = this.versions.get(kind);
    if (!versions) throw new RecordError('schema', `no event kind ${kind} is catalogued`, { path: '/kind' });
    if (!versions.includes(input.v)) throw new RecordError('schema', `${kind} has no schema at version ${String(input.v)}`, { path: '/v' });
    // The text field is scrubbed, then cut, before the schema sees it: the bound is on what the record keeps.
    const data = structuredClone(input.data);
    let whole: string | undefined;
    const field = TEXT_FIELD[kind];
    if (field && isObj(data)) {
      if (this.options.contentFree) data[field] = BLANK[field] ?? null;
      else if (typeof data[field] === 'string') {
        const scrubbed = scrubText(data[field], connection.run);
        data[field] = cut(scrubbed, CUT);
        if (scrubbed.length > CUT) whole = scrubbed;
      }
    }
    const { writer: _ignored, ...payload } = input as EventInput & { writer?: unknown };
    const event: Obj = { ...(payload as unknown as Obj), data, writer: connection.writer, actor: connection.actor, scope: connection.scope };
    const result = this.registry.validate(`${kind}@${input.v}`, event);
    if (!result.ok) {
      const issue = result.issues[0]!;
      throw new RecordError('schema', `${issue.code} at ${issue.path || '/'}: ${issue.remediation}`, { path: issue.path });
    }
    const prepared: Prepared = {
      input, writer: connection.writer, actor: connection.actor, scope: connection.scope,
      session: connection.session ?? null, project: connection.project ?? null, agent: connection.agent ?? null,
      seq: input.seq === undefined ? null : BigInt(input.seq), data, evidence: [...(input.evidence ?? [])], hash: '',
    };
    if (whole !== undefined) prepared.whole = whole;
    return prepared;
  }
  /** The content hash that tells a repeated append of the same event from a conflicting one. */
  private sealed(p: Prepared): Prepared {
    // Everything the log stores but log_pos: what the connection proved is content too.
    p.hash = sha256Hex(canonicalize({
      v: p.input.v, kind: p.input.kind, subject: p.input.subject ?? null, ts: p.input.ts, seq: p.input.seq ?? null, data: p.data, evidence: p.evidence,
      writer: p.writer, actor: p.actor, scope: p.scope, session: p.session, project: p.project, agent: p.agent,
    }));
    return p;
  }

  async append(connection: Connection, input: EventInput): Promise<Appended> {
    if (this.closing) throw new RecordError('closed', 'the record is closed');
    // Counted from here until it is in the log or refused, so a close waits for it.
    this.inFlight++;
    try {
      const key = String(input.id);
      const before = this.byId.get(key);
      const run = (before ? before.catch(() => undefined) : Promise.resolve()).then(() => this.appendNow(connection, input));
      this.byId.set(key, run);
      try {
        return await run;
      } finally {
        if (this.byId.get(key) === run) this.byId.delete(key);
      }
    } finally {
      this.inFlight--;
    }
  }
  private async appendNow(connection: Connection, input: EventInput): Promise<Appended> {
    const prepared = this.prepare(connection, input);
    if (prepared.whole !== undefined) {
      const bytes = Buffer.from(prepared.whole, 'utf8');
      // An event the log already holds needs no store: its retry is the same event, or a conflict.
      const found = this.db.prepare('SELECT log_pos, hash FROM events WHERE id = ?').get(input.id) as { log_pos: number; hash: string } | undefined;
      if (found) {
        prepared.evidence.push(sha256Hex(bytes));
        this.sealed(prepared);
        if (found.hash === prepared.hash) return { log_pos: found.log_pos, existing: true };
        throw new RecordError('conflict', `event ${input.id} is already in the log with other content`, { id: input.id });
      }
      // The whole scrubbed text is evidence, by hash, when the event keeps only its first part; an event
      // whose whole text can't be kept isn't appended, and its session has lost an event.
      let failure: string | undefined;
      try {
        if (!this.evidenceWriter) throw Error('the record was opened without an evidence store');
        const put = await this.evidenceWriter.put({ bytes: new Uint8Array(bytes), kind: `${input.kind}.${TEXT_FIELD[input.kind]}`, source: `event:${input.id}`, redaction: 'complete', license: { name: 'record', allows: [] } });
        if (put.status === 'stored') {
          prepared.evidence.push(put.evidence.sha256);
          // The record runs this put as the core, so the file is an event too, ahead of the event citing it.
          const ev = put.evidence;
          const ts = this.options.now();
          // Straight to appendNow: this append is already counted in flight, so a close waits for both.
          await this.appendNow({ writer: 'core', actor: connection.actor, scope: connection.scope, ...(connection.session ? { session: connection.session } : {}) }, {
            v: 1, id: ulid(ts), kind: 'evidence.stored', ts,
            data: { sha256: ev.sha256, kind: ev.kind, type: ev.type, size: ev.size, origin: ev.origin, redaction: ev.redaction, license: ev.license.name, derived_from: [...ev.derivedFrom], step_times: [] },
          });
        } else failure = put.reason;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      if (failure !== undefined) {
        if (prepared.session) this.markLost(prepared.session);
        throw new RecordError('storage', `the evidence store refused the whole text of ${input.id}: ${failure}`, { id: input.id });
      }
    }
    this.sealed(prepared);
    if (CORE_ONLY.has(input.kind)) {
      const [outcome] = this.commit([prepared], 'full');
      if (!outcome!.ok) throw outcome!.error;
      return outcome!.appended;
    }
    // The core reads what a learned change cites in the evidence store before it is in force; a refusal is its
    // event, queued right behind the change so both land in one commit, and the projection never reads bytes.
    // A retry of a change already in the log isn't read again.
    let checked: Prepared | undefined;
    if (CHECKED.has(input.kind) && !this.db.prepare('SELECT 1 FROM events WHERE id = ?').get(input.id)) {
      const change = prepared.data as unknown as LearnedChange;
      // The reading must be of what the change's handles name at its place in the log: while anything is queued
      // (a transcript link, a change it cites), or a link moved during the read, it waits for the queue and reads again.
      let found;
      for (;;) {
        if (this.queue.length) { await this.settle(); continue; }
        const before = transcriptsCited(this.db, change);
        found = await readEvidence(this.db, this.options.evidence, change, this.transcripts).catch((error: unknown) => {
          throw new RecordError('storage', `the evidence ${input.id} cites could not be read, so it isn't appended: ${error instanceof Error ? error.message : String(error)}`, { id: input.id });
        });
        if (!this.queue.length && transcriptsCited(this.db, change) === before) break;
      }
      while (this.transcripts.size > TRANSCRIPTS_KEPT) this.transcripts.delete(this.transcripts.keys().next().value!);
      if (found) {
        const ts = this.options.now();
        checked = this.sealed(this.prepare({ writer: 'core', actor: connection.actor, scope: connection.scope }, { v: 1, id: ulid(ts), kind: LEARN_CHECK, ts, data: { change: `doc:${input.id}`, reason: found.reason } }));
      }
    }
    return new Promise<Appended>((resolve, reject) => {
      this.queue.push({ prepared, resolve, reject });
      if (checked) this.queue.push({ prepared: checked, resolve: () => undefined, reject: () => undefined });
      if (!this.scheduled) {
        this.scheduled = true;
        setImmediate(() => this.flush());
      }
    });
  }

  /** Commits the queued stream events in one NORMAL batch, each taking its log_pos inside the commit. */
  private flush(): void {
    this.scheduled = false;
    const batch = this.queue.splice(0);
    if (!batch.length) return;
    let outcomes: Outcome[];
    try {
      // A prompt that resumes an ended session commits FULL: recovery then sees the session active again,
      // though every event after it is lost in a cut.
      const ended = this.db.prepare("SELECT 1 FROM sessions WHERE id = ? AND status IN ('finished', 'failed')");
      const resumes = batch.some(({ prepared: p }) => p.input.kind === 'user.ask' && p.session !== null && p.session !== undefined && ended.get(p.session));
      outcomes = this.commit(batch.map((p) => p.prepared), resumes ? 'full' : 'normal');
    } catch (error) {
      for (const p of batch) p.reject(error as Error);
      return;
    }
    for (const [i, outcome] of outcomes.entries()) {
      const pending = batch[i]!;
      if (outcome.ok) pending.resolve(outcome.appended);
      else pending.reject(outcome.error);
    }
  }

  /** Writes the events in one commit of the durability asked for; a claim from a session that lost events gets its verdict at once. */
  private commit(items: Prepared[], mode: Durability, also?: () => void): Outcome[] {
    const outcomes: Outcome[] = [];
    try {
      this.reserve(items.length);
      const existing = this.db.prepare('SELECT log_pos, hash FROM events WHERE id = ?');
      const insert = this.db.prepare('INSERT INTO events (id, log_pos, v, ts, project_id, session_id, seq, agent, writer, actor, scope, kind, subject, data, evidence, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const write = (work: () => void) => (mode === 'full' ? this.full(work) : this.backend.commit(this.db, 'normal', work));
      write(() => {
        for (const p of items) {
          const found = existing.get(p.input.id) as { log_pos: number; hash: string } | undefined;
          if (found) {
            if (found.hash === p.hash) outcomes.push({ ok: true, appended: { log_pos: found.log_pos, existing: true }, prepared: p, log_pos: found.log_pos });
            else outcomes.push({ ok: false, error: new RecordError('conflict', `event ${p.input.id} is already in the log with other content`, { id: p.input.id }), prepared: p });
            continue;
          }
          const log_pos = this.next++;
          insert.run(p.input.id, log_pos, p.input.v, p.input.ts, p.project, p.session, p.seq, p.agent, p.writer, p.actor, p.scope, p.input.kind, p.input.subject ?? null, JSON.stringify(p.data), p.evidence.length ? JSON.stringify(p.evidence) : null, p.hash);
          this.projector.apply(this.projected(p, log_pos));
          outcomes.push({ ok: true, appended: { log_pos, existing: false }, prepared: p, log_pos });
        }
        also?.();
      });
    } catch (error) {
      // Nothing of the batch is in the log: the sessions it came from have lost events, and what the
      // projector cached while applying it is forgotten, so live state stays a function of the log.
      this.projector.forget();
      for (const p of items) if (p.session) this.markLost(p.session);
      const message = error instanceof Error ? error.message : String(error);
      throw error instanceof RecordError ? error : new RecordError('storage', `the storage refused the write: ${message}`);
    }
    for (const outcome of outcomes) {
      if (outcome.ok && !outcome.appended.existing && outcome.prepared.input.kind === 'claim.made' && outcome.prepared.session
        && (this.lost.has(outcome.prepared.session) || this.startCut(outcome.prepared.session))) this.invalidate(outcome.prepared.input.id);
    }
    return outcomes;
  }

  private projected(p: Prepared, log_pos: number): Projected {
    return {
      id: p.input.id, v: p.input.v, kind: p.input.kind, ts: p.input.ts, seq: p.seq, log_pos, session: p.session, project: p.project, agent: p.agent,
      writer: p.writer, actor: p.actor, scope: p.scope, subject: p.input.subject ?? null, data: this.migrate(p.input.kind, p.input.v, p.data), evidence: p.evidence,
    };
  }
  /** The data at the newest registered version of its kind, through the forward migrations. */
  private migrate(kind: string, v: number, data: JsonValue): JsonValue {
    let migration = this.migrations.get(`${kind}@${v}`);
    while (migration) {
      data = migration.up(data);
      migration = this.migrations.get(`${kind}@${migration.to}`);
    }
    return data;
  }

  // ---- Reads.

  async read({ after, limit = 1000 }: { after: number; limit?: number }): Promise<Event[]> {
    const rows = this.db.prepare('SELECT * FROM events WHERE log_pos > ? ORDER BY log_pos LIMIT ?').safeIntegers(true).all(after, limit) as StoredRow[];
    return rows.map(toEvent);
  }

  async table(name: string): Promise<Table> {
    const def = tableDef(name);
    if (!def) throw new RecordError('schema', `no projection ${name}`, { path: '/name' });
    // SQLite's own order for stored values: numbers as numbers, text by its bytes.
    const order = def.pk.map((k) => `"${k}"`).join(', ');
    const rows = this.db.prepare(`SELECT * FROM ${name} ORDER BY ${order}`).safeIntegers(true).all() as Row[];
    return { name, primaryKey: [...def.pk], rows };
  }

  async session(id: string): Promise<SessionView | undefined> {
    const row = this.db.prepare('SELECT status FROM sessions WHERE id = ?').get(id) as { status: string } | undefined;
    if (!row) return undefined;
    const turns = this.db.prepare('SELECT idx, number, stopped FROM turns WHERE session_id = ? ORDER BY idx').all(id) as { idx: number; number: number | null; stopped: number }[];
    const events = this.db.prepare('SELECT event_id, turn_idx FROM turn_events WHERE session_id = ? ORDER BY turn_idx, eff_seq, eff_id, log_pos').all(id) as { event_id: string; turn_idx: number }[];
    const readings = (this.db.prepare('SELECT reading FROM session_readings WHERE session_id = ? ORDER BY since').all(id) as { reading: string }[]).map((r) => r.reading);
    return {
      id, status: row.status, readings,
      turns: turns.map((t) => ({ turn: t.number, stopped: t.stopped !== 0, events: events.filter((e) => e.turn_idx === t.idx).map((e) => e.event_id) })),
    };
  }

  /** Drops every projection and replays the log in log_pos order, migrating each event first. */
  async rebuild(): Promise<void> {
    await this.settle();
    // A page at a time, read whole before it is applied: SQLite refuses writes while a cursor on the same
    // connection is open, and a million-event log must not be held in memory at once.
    const page = this.db.prepare('SELECT * FROM events WHERE log_pos > ? ORDER BY log_pos LIMIT ?').safeIntegers(true);
    try {
      this.backend.commit(this.db, 'normal', () => {
        this.projector.drop();
        let after = 0;
        for (;;) {
          const rows = page.all(after, REPLAY_PAGE) as StoredRow[];
          for (const row of rows) {
            const e = toEvent(row);
            this.projector.apply({
              id: e.id, v: e.v, kind: e.kind, ts: e.ts, seq: e.seq ?? null, log_pos: e.log_pos, session: e.session ?? null, project: e.project ?? null, agent: e.agent ?? null,
              writer: e.writer, actor: e.actor, scope: e.scope, subject: e.subject ?? null, data: this.migrate(e.kind, e.v, e.data), evidence: e.evidence,
            });
            after = e.log_pos;
          }
          if (rows.length < REPLAY_PAGE) break;
        }
      });
    } finally {
      this.projector.forget();
    }
  }

  /** Reads only: a statement that would write, the log's triggers and tables included, is refused. */
  async raw(sql: string): Promise<unknown[]> {
    // Refused before it is prepared: SQLite runs a PRAGMA while compiling it, so a check after prepare is too late.
    if (!/^\s*(SELECT|WITH)\b/i.test(sql) || /;\s*\S/.test(sql)) throw new RecordError('storage', 'raw SQL reads the record with one SELECT; it never writes it');
    const statement = this.db.prepare(sql);
    if (!statement.readonly || !statement.reader) throw new RecordError('storage', 'raw SQL reads the record; it never writes it');
    return statement.all();
  }

  async startSlice(session: string): Promise<SliceEntry[]> {
    await this.settle();
    return startSlice(this.db, session);
  }

  rollBack(connection: Connection, what: { change: string } | { since: number }): Promise<string[]> {
    // Only you, through the app or the CLI, and the core roll back: the projection honors no one else's.
    if (!ROLLERS.has(connection.writer)) return Promise.reject(new RecordError('writer', `learn.rolled_back takes a change out of force only from the app, the CLI or the core, not ${connection.writer}`, { kind: 'learn.rolled_back' }));
    // One rollback at a time: each picks what is in force after the one before it committed, so none is compensated twice.
    const run = this.rolling.catch(() => undefined).then(() => this.rollBackNow(connection, what));
    this.rolling = run;
    return run;
  }
  private async rollBackNow(connection: Connection, what: { change: string } | { since: number }): Promise<string[]> {
    await this.settle();
    const rolled: string[] = [];
    for (const change of toRollBack(this.db, what)) {
      const ts = this.options.now();
      // The compensating change: the same target and scope, its diff inverted, naming the change it undoes.
      const diff = change.diff.split('\n').map((l) => (l.startsWith('+') ? `-${l.slice(1)}` : l.startsWith('-') ? `+${l.slice(1)}` : l)).join('\n');
      await this.append(connection, {
        v: 1, id: ulid(ts), kind: 'learn.rolled_back', ts,
        data: { layer: change.layer, target: change.target, diff, evidence: [], scope: change.scope, replay: null, applied_by: 'you', supersedes: change.handle },
      });
      rolled.push(change.id);
    }
    return rolled;
  }

  /** Waits for every queued stream event to commit or be refused. */
  private async settle(): Promise<void> {
    while (this.queue.length || this.scheduled) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  /** A clean stop: no new appends, every one accepted committed or refused, the state recorded FULL. */
  close(): Promise<void> {
    this.closing ??= this.stop();
    return this.closing;
  }
  private async stop(): Promise<void> {
    while (this.inFlight || this.queue.length || this.scheduled) await new Promise<void>((resolve) => setImmediate(resolve));
    const lost = this.db.prepare('INSERT OR IGNORE INTO lost_sessions (session) VALUES (?)');
    const put = this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    this.full(() => {
      for (const session of this.lost) lost.run(session);
      put.run('state', 'stopped');
      put.run('log_block_end', String(this.next));
    });
    this.backend.close(this.db);
  }
}

interface StoredRow {
  id: string; log_pos: bigint; v: bigint; ts: bigint; project_id: string | null; session_id: string | null; seq: bigint | null; agent: string | null;
  writer: string; actor: string; scope: string; kind: string; subject: string | null; data: string; evidence: string | null; hash: string;
}
function toEvent(row: StoredRow): Event {
  const event: Event = {
    v: Number(row.v), id: row.id, kind: row.kind, writer: row.writer, actor: row.actor, scope: row.scope, ts: Number(row.ts), log_pos: Number(row.log_pos),
    data: JSON.parse(row.data) as JsonValue, evidence: row.evidence ? (JSON.parse(row.evidence) as string[]) : [],
  };
  if (row.subject !== null) event.subject = row.subject;
  if (row.seq !== null) event.seq = row.seq;
  if (row.session_id !== null) event.session = row.session_id;
  if (row.project_id !== null) event.project = row.project_id;
  if (row.agent !== null) event.agent = row.agent;
  return event;
}
export async function openRecord(options: RecordOptions): Promise<RecordStore> {
  const storage = options.storage ?? fileStorage();
  if (!isBackend(storage)) throw new RecordError('storage', `storage ${storage.name} is not one the record can write through`);
  const record = new SqliteRecord(options, storage);
  // A projection remade with new columns is filled again from the log, before recovery reads the tables.
  if (record.stale) await record.rebuild();
  record.start();
  return record;
}
