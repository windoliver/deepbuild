// @deepbuild/record: the append-only SQLite event log and the projections built from it (#14).
//
// The `events` table is the source of truth. Every other table is a projection the record rebuilds by
// replaying it. An event's ID is its identity; its `seq` is its order within its session; its `log_pos`
// is its position in the log, assigned here at append inside the commit that writes it.
import { randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { canonicalize, listSchemas, registry, sha256Hex } from '@deepbuild/contracts';
import type { JsonValue, Registry, SchemaEntry } from '@deepbuild/contracts';
import { scrubText } from '@deepbuild/evidence';
import type { EvidenceStore, Writer as EvidenceWriter } from '@deepbuild/evidence';
import { CHECKED, loadLearned, parseClaimLine, readEvidence, replayCheck, resolveHandle, ROLLERS, YOURS, sessionTranscript, startSlice, toRollBack, dependsOn, type ClaimLine, type Entry as Resolved, type HeldAtLoad, type LearnedChange, type LearnedLoad, type Message, type SliceEntry, type Transcripts } from './learned.js';
import { compareReplay, planHash } from './replay.js';
import { PROJECTIONS, Projector, tableDef, type Projected } from './projections.js';
import type { Statement } from 'better-sqlite3';
import { fileStorage, isBackend, openReadOnly, testStorage, type Backend, type Db, type Durability, type Storage, type SyncCall, type TestStorage } from './storage.js';

export { compareReplay, parseClaimLine, planHash, PROJECTIONS, testStorage };
export type { Comparison, Measure, MeasureResult, ReplayPlan, ReplayResult, ReplayRun, TaskPair, Variant } from './replay.js';
export type { Backend, ClaimLine, HeldAtLoad, LearnedLoad, Message, Resolved, SliceEntry, Storage, SyncCall, TestStorage };

/** What the hub's socket proved about a writer's connection (#16 proves it; the record only reads it). */
export interface Connection {
  writer: string;
  actor: string;
  scope: string;
  session?: string;
  project?: string;
  agent?: string;
  run?: { env?: Readonly<Record<string, string>>; held?: readonly string[] };
  /** False when the event claims a session the hub couldn't check it against; the event keeps that mark. */
  verified?: boolean;
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
  /** Set when the hub recorded the event as unverified: it claims a session it couldn't be checked against. */
  unverified?: true;
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
  /** Commit each stream event in its own commit, in its append call, so the durable write points depend only on the events (the hub, #16). */
  commitEach?: boolean;
  schemas?: readonly SchemaEntry[];
  migrations?: readonly Migration[];
}
export interface Row { [column: string]: unknown }
export interface Table { name: string; primaryKey: string[]; rows: Row[] }
export interface TurnView { turn: number | null; stopped: boolean; events: string[] }
export interface SessionView { id: string; status: string; readings: string[]; turns: TurnView[] }

export interface RecordStore {
  append(connection: Connection, event: EventInput): Promise<Appended>;
  /** Events after a log position, in log order; `kinds`: only those kinds, the rest never decoded. */
  read(query: { after: number; limit?: number; kinds?: readonly string[] }): Promise<Event[]>;
  table(name: string): Promise<Table>;
  session(id: string): Promise<SessionView | undefined>;
  rebuild(): Promise<void>;
  /** Waits for every queued append, then commits synchronous=FULL: everything appended so far is durable. */
  sync(): Promise<void>;
  /** One read-only SELECT; each `?` in it takes the next of `params`, bound, never written into the text. */
  raw(sql: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  /** What a session reads at its start, and, for the rules you typed, at its next prompt (#62). */
  startSlice(session: string): Promise<SliceEntry[]>;
  /**
   * What a session loads of the learned step specs, playbooks and compositions, checked against the guard rules
   * in force now: one a rule denies a command of is held, its reason naming the rule (#723).
   */
  loadLearned(session: string): Promise<LearnedLoad>;
  /**
   * Rolls back one learned change, by its event's ID, or every learned change in force since a time: one
   * learn.rolled_back each, newest first, through the connection; nothing is deleted. Resolves with the
   * compensated changes' IDs, in that order.
   */
  rollBack(connection: Connection, what: { change: string } | { since: number }): Promise<string[]>;
  /**
   * What a record handle names now (#355): a transcript message's text, with its role, the tool whose result it
   * holds and whether it is outside content; a decision's answer; an evidence file's text. Undefined for nothing.
   */
  resolve(handle: string): Promise<Resolved | undefined>;
  /**
   * Keeps a file in the evidence store as the core, recorded as evidence.stored under the connection's project, so
   * a learned change can cite it by its `ev:` handle and reach the repo the file is from (#355).
   */
  keep(connection: Connection, file: { bytes: Uint8Array; kind: string; source: string }): Promise<string>;
  /**
   * A copy of the record written to `path` through SQLite's online backup on this, the writer's, connection (#572):
   * it holds every event committed before it began, while appends go on, and never a commit half landed.
   */
  backup(path: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * The events of `kinds` after `cursor`, in log order, and the cursor to read from next: the log's head read before
 * the first page, so the other kinds are scanned once and never decoded, and what lands after the head is read next
 * time. Every fold that follows the log with a cursor reads it this way.
 */
export async function readSince(record: RecordStore, cursor: number, kinds: readonly string[], each: (event: Event) => void): Promise<number> {
  const [row] = (await record.raw('SELECT max(log_pos) AS head FROM events')) as { head: number | bigint | null }[];
  const head = Number(row?.head ?? 0);
  for (;;) {
    const page = await record.read({ after: cursor, limit: 1000, kinds });
    for (const e of page) each(e);
    if (page.length) cursor = page[page.length - 1]!.log_pos;
    if (page.length < 1000) return Math.max(cursor, head);
  }
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
const CORE_ONLY = new Set(['verdict.made', 'verdict.stale', 'definition.locked', 'definition.revised', 'definition.stood_in', 'decision.created', 'decision.applied', 'decision.revoked', 'decision.overruled', 'ask.answered', 'ask.defaulted', 'default.undone',
  'spend.approved', 'spend.reserved', 'spend.charged', 'spend.asked', 'card_rule.set']);
/** The evidence store's own events: only the core, which runs the store, appends them; they stream. */
const STORE_ONLY = new Set(['evidence.stored', 'evidence.removed']);
/** The core's check of a learned change: only the core appends it, in the change's own batch. */
const LEARN_CHECK = 'learn_check.made';
/** A plug-in's own kind, ext.<plugin>.<name> (#363): an item of its store, held to store.item@1, written only by that plug-in. */
const PLUGIN_KIND = /^ext\.([a-z0-9_-]+)\.[a-z][a-z0-9_]*$/;
const STORE_ITEM = 'store.item@1';
/** The text field each kind keeps of a hook payload: scrubbed, then cut. */
const TEXT_FIELD: Readonly<Record<string, string>> = { 'tool.before': 'command', 'tool.after': 'command', 'permission.request': 'command', 'user.ask': 'text', 'task.completed': 'title' };
/** What content-free mode keeps of each text field: nothing its schema allows. */
const BLANK: Readonly<Record<string, string | null>> = { command: null, text: '', title: '-' };
/** An event's content-free fields only: its text field kept as content-free mode keeps it (#363, a record grant without text). */
export function contentFree(event: Event): Event {
  const field = TEXT_FIELD[event.kind];
  return field && isObj(event.data) ? { ...event, data: { ...event.data, [field]: BLANK[field] ?? null } } : event;
}

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
  hash        TEXT NOT NULL,
  unverified  INTEGER NOT NULL DEFAULT 0
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
/** A ULID minted at `ms`: 48 bits of time, 80 of randomness. */
export function ulid(ms: number): string {
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
  unverified: boolean;
  hash: string;
  /** The whole scrubbed text when the event keeps only its first part. */
  whole?: string;
}
interface Pending { prepared: Prepared; resolve(appended: Appended): void; reject(error: Error): void }
type Outcome = { ok: true; appended: Appended; prepared: Prepared; log_pos: number } | { ok: false; error: RecordError; prepared: Prepared };

class SqliteRecord implements RecordStore {
  private readonly db: Db;
  /** Statements on `events` and `meta`, which no rebuild drops, compiled once: appends run them per event. */
  private readonly statements = new Map<string, Statement<unknown[]>>();
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
    // A record made before events kept the unverified mark gains the column, every event in it unmarked.
    const columns = this.db.prepare("SELECT name FROM pragma_table_info('events')").all() as { name: string }[];
    if (columns.length && !columns.some((c) => c.name === 'unverified')) this.db.exec('ALTER TABLE events ADD COLUMN unverified INTEGER NOT NULL DEFAULT 0');
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

  private stmt(sql: string): Statement<unknown[]> {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  /** Runs `work` in one synchronous=FULL commit, which also records how far the log is durable. */
  private full(work: () => void): void {
    this.backend.commit(this.db, 'full', () => {
      work();
      this.stmt("INSERT INTO meta (key, value) VALUES ('durable', (SELECT coalesce(max(log_pos), 0) FROM events)) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run();
    });
  }
  private commitMeta(values: Record<string, string>): void {
    const put = this.stmt('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
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
    const plugin = this.versions.has(kind) ? undefined : PLUGIN_KIND.exec(kind)?.[1];
    if (plugin !== undefined && /^ext:[^/]+\/(.+)$/.exec(connection.writer)?.[1] !== plugin) throw new RecordError('writer', `${kind} is appended only by the plug-in ${plugin}, not by ${connection.writer}`, { kind });
    const versions = plugin === undefined ? this.versions.get(kind) : [1];
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
    const result = this.registry.validate(plugin === undefined ? `${kind}@${input.v}` : STORE_ITEM, event);
    if (!result.ok) {
      const issue = result.issues[0]!;
      throw new RecordError('schema', `${issue.code} at ${issue.path || '/'}: ${issue.remediation}`, { path: issue.path });
    }
    const prepared: Prepared = {
      input, writer: connection.writer, actor: connection.actor, scope: connection.scope,
      session: connection.session ?? null, project: connection.project ?? null, agent: connection.agent ?? null,
      seq: input.seq === undefined ? null : BigInt(input.seq), data, evidence: [...(input.evidence ?? [])], unverified: connection.verified === false, hash: '',
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
      ...(p.unverified ? { unverified: true } : {}),
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
      const found = this.stmt('SELECT log_pos, hash FROM events WHERE id = ?').get(input.id) as { log_pos: number; hash: string } | undefined;
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
    if (CORE_ONLY.has(input.kind) || this.options.commitEach) {
      const [outcome] = this.commit([prepared], CORE_ONLY.has(input.kind) || this.resumes([prepared]) ? 'full' : 'normal');
      if (!outcome!.ok) throw outcome!.error;
      return outcome!.appended;
    }
    // The core reads what a learned change cites in the evidence store before it is in force; a refusal is its
    // event, queued right behind the change so both land in one commit, and the projection never reads bytes.
    // A retry of a change already in the log isn't read again.
    let checked: Prepared | undefined;
    // A rollback by rule is read too: the replays it cites decide whether it revokes anything (#112).
    const byRule = input.kind === 'learn.rolled_back' && !YOURS.has(connection.writer);
    if ((CHECKED.has(input.kind) || byRule) && !this.stmt('SELECT 1 FROM events WHERE id = ?').get(input.id)) {
      const change = prepared.data as unknown as LearnedChange;
      // The reading must be of what the change's handles name at its place in the log: while anything is queued
      // (a transcript link, a change it cites), or a link moved or a change took effect during the read, it waits
      // for the queue and reads again.
      let found;
      for (;;) {
        if (this.queue.length) { await this.settle(); continue; }
        const before = dependsOn(this.db, change);
        found = await (async () => (CHECKED.has(input.kind) ? await readEvidence(this.db, this.options.evidence, change, this.transcripts) : undefined)
          ?? replayCheck(this.options.evidence, change, this.transcripts, input.kind, connection.writer))().catch((error: unknown) => {
          throw new RecordError('storage', `the evidence ${input.id} cites could not be read, so it isn't appended: ${error instanceof Error ? error.message : String(error)}`, { id: input.id });
        });
        if (!this.queue.length && dependsOn(this.db, change) === before) break;
      }
      if (found) {
        const ts = this.options.now();
        checked = this.sealed(this.prepare({ writer: 'core', actor: connection.actor, scope: connection.scope }, { v: 1, id: ulid(ts), kind: LEARN_CHECK, ts, data: { change: `doc:${input.id}`, reason: found.reason } }));
      }
    }
    return new Promise<Appended>((resolve, reject) => {
      // A rollback's refusal goes first, so the rollback never takes effect, even for a moment.
      if (checked && byRule) this.queue.push({ prepared: checked, resolve: () => undefined, reject: () => undefined });
      this.queue.push({ prepared, resolve, reject });
      if (checked && !byRule) this.queue.push({ prepared: checked, resolve: () => undefined, reject: () => undefined });
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
      const items = batch.map((p) => p.prepared);
      outcomes = this.commit(items, this.resumes(items) ? 'full' : 'normal');
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

  /**
   * Whether a batch holds a prompt that resumes an ended session: it commits FULL, so recovery sees the
   * session active again, though every event after it is lost in a cut.
   */
  private resumes(items: readonly Prepared[]): boolean {
    const ended = this.stmt("SELECT 1 FROM sessions WHERE id = ? AND status IN ('finished', 'failed')");
    return items.some((p) => p.input.kind === 'user.ask' && p.session !== null && ended.get(p.session) !== undefined);
  }

  /** Writes the events in one commit of the durability asked for; a claim from a session that lost events gets its verdict at once. */
  private commit(items: Prepared[], mode: Durability, also?: () => void): Outcome[] {
    const outcomes: Outcome[] = [];
    try {
      this.reserve(items.length);
      const existing = this.stmt('SELECT log_pos, hash FROM events WHERE id = ?');
      const insert = this.stmt('INSERT INTO events (id, log_pos, v, ts, project_id, session_id, seq, agent, writer, actor, scope, kind, subject, data, evidence, hash, unverified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
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
          insert.run(p.input.id, log_pos, p.input.v, p.input.ts, p.project, p.session, p.seq, p.agent, p.writer, p.actor, p.scope, p.input.kind, p.input.subject ?? null, JSON.stringify(p.data), p.evidence.length ? JSON.stringify(p.evidence) : null, p.hash, p.unverified ? 1 : 0);
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

  async read({ after, limit = 1000, kinds }: { after: number; limit?: number; kinds?: readonly string[] }): Promise<Event[]> {
    const only = kinds ? ` AND kind IN (SELECT value FROM json_each(?))` : '';
    const rows = this.stmt(`SELECT * FROM events WHERE log_pos > ?${only} ORDER BY log_pos LIMIT ?`).safeIntegers(true)
      .all(after, ...(kinds ? [JSON.stringify(kinds)] : []), limit) as StoredRow[];
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

  async sync(): Promise<void> {
    if (this.closing) throw new RecordError('closed', 'the record is closed');
    await this.settle();
    try {
      this.full(() => undefined);
    } catch (error) {
      throw new RecordError('storage', `the storage refused the write: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Reads only: a statement that would write, the log's triggers and tables included, is refused. */
  async raw(sql: string, params: readonly (string | number | bigint | null)[] = []): Promise<unknown[]> {
    // Refused before it is prepared: SQLite runs a PRAGMA while compiling it, so a check after prepare is too late.
    if (!/^\s*(SELECT|WITH)\b/i.test(sql) || /;\s*\S/.test(sql)) throw new RecordError('storage', 'raw SQL reads the record with one SELECT; it never writes it');
    const statement = this.db.prepare(sql);
    if (!statement.readonly || !statement.reader) throw new RecordError('storage', 'raw SQL reads the record; it never writes it');
    return statement.all(...params);
  }

  async startSlice(session: string): Promise<SliceEntry[]> {
    await this.settle();
    return startSlice(this.db, session);
  }

  async loadLearned(session: string): Promise<LearnedLoad> {
    await this.settle();
    return loadLearned(this.db, session);
  }

  async resolve(handle: string): Promise<Resolved | undefined> {
    await this.settle();
    return resolveHandle(this.db, this.options.evidence, this.transcripts, handle);
  }

  async keep(connection: Connection, file: { bytes: Uint8Array; kind: string; source: string }): Promise<string> {
    if (!this.evidenceWriter) throw new RecordError('storage', 'the record was opened without an evidence store');
    const put = await this.evidenceWriter.put({ bytes: file.bytes, kind: file.kind, source: file.source, redaction: 'complete', license: { name: 'own', allows: [] } });
    if (put.status !== 'stored') throw new RecordError('storage', `the evidence store refused ${file.source}: ${put.reason}`);
    const ev = put.evidence;
    const ts = this.options.now();
    await this.append({ writer: 'core', actor: connection.actor, scope: connection.scope, ...(connection.project ? { project: connection.project } : {}) }, {
      v: 1, id: ulid(ts), kind: 'evidence.stored', ts,
      data: { sha256: ev.sha256, kind: ev.kind, type: ev.type, size: ev.size, origin: ev.origin, redaction: ev.redaction, license: ev.license.name, derived_from: [...ev.derivedFrom], step_times: [] },
    });
    return `ev:${ev.sha256}`;
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

  async backup(path: string): Promise<void> {
    if (this.closing) throw new RecordError('closed', 'the record is closed');
    await this.db.backup(path);
  }

  /**
   * Closes a record put back from a backup as one after a power cut (#572): its state running and nothing durable,
   * so the next start judges every claim open in it INVALID, cause events lost, at `generation`; its next log
   * position at `next`, above any the replaced record handed out. It closes out of WAL mode, as one file any storage
   * opens; the record's own storage puts it back in WAL at its next open.
   */
  sealRestored(generation: number, next: number): void {
    const put = this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    this.backend.commit(this.db, 'full', () => {
      put.run('generation', String(generation));
      put.run('state', 'running');
      put.run('durable', '0');
      put.run('log_block_end', String(next));
    });
    this.db.pragma('journal_mode = DELETE');
    this.backend.close(this.db);
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
  writer: string; actor: string; scope: string; kind: string; subject: string | null; data: string; evidence: string | null; hash: string; unverified: bigint;
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
  if (row.unverified) event.unverified = true;
  return event;
}
/**
 * The record as a process other than the hub reads it (#63): one read-only connection, so it never writes the log,
 * its projections or its state, and runs beside the hub.
 */
export interface RecordReader {
  resolve(handle: string): Promise<Resolved | undefined>;
  /** A session's archived transcript, through its newest transcript.archived link; undefined for a session none links. */
  transcript(session: string): Promise<Message[] | undefined>;
  /** The sessions a transcript.archived event links, by ID. */
  archived(): Promise<string[]>;
  /** The same sessions with their agent, worktree and branch, and the SHA-256 of the newest transcript copy (#112). */
  sessions(): Promise<{ id: string; agent: string | null; worktree: string | null; branch: string | null; transcript: string }[]>;
  /** Handles `deep find` searches besides transcripts: your decisions in force, and evidence that is neither media nor a transcript. */
  findable(): Promise<string[]>;
  close(): void;
}
export function openRecordReader(options: { path: string; evidence?: EvidenceStore }): RecordReader {
  const db = openReadOnly(options.path);
  const transcripts: Transcripts = new Map();
  return {
    resolve: (handle) => resolveHandle(db, options.evidence, transcripts, handle),
    transcript: (session) => sessionTranscript(db, options.evidence, transcripts, session),
    archived: async () => (db.prepare('SELECT id FROM sessions WHERE transcript IS NOT NULL ORDER BY id').all() as { id: string }[]).map((r) => r.id),
    sessions: async () => db.prepare('SELECT id, agent, worktree, branch, transcript FROM sessions WHERE transcript IS NOT NULL ORDER BY id').all() as Awaited<ReturnType<RecordReader['sessions']>>,
    findable: async () => [
      ...(db.prepare("SELECT id FROM decisions WHERE state = 'active' ORDER BY created, id").all() as { id: string }[]).map((r) => `decision:${r.id}`),
      ...(db.prepare("SELECT hash FROM evidence WHERE type NOT IN ('png', 'jpeg', 'mp4') AND kind != 'transcript' ORDER BY hash").all() as { hash: string }[]).map((r) => `ev:${r.hash}`),
    ],
    close: () => db.close(),
  };
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

/**
 * What a record's meta says (#572): its writer generation, 1 for a record no restore raised, and the first log
 * position it may hand out next. A record whose meta can't be read is an error, never generation 1.
 */
function metaOf(path: string): { generation: number; next: number } {
  const db = openReadOnly(path);
  try {
    const has = (table: string) => db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table) !== undefined;
    const value = (key: string) => (has('meta') ? (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value : undefined);
    const positive = (key: string) => {
      const said = value(key);
      const n = said === undefined ? 1 : Number(said);
      if (!Number.isSafeInteger(n) || n < 1) throw new RecordError('storage', `${path} names ${key} ${said}, not a positive integer`);
      return n;
    };
    const last = has('events') ? Number((db.prepare('SELECT coalesce(max(log_pos), 0) AS last FROM events').get() as { last: number }).last) : 0;
    return { generation: positive('generation'), next: Math.max(positive('log_block_end'), last + 1) };
  } finally {
    db.close();
  }
}

/** The writer generation the record at `path` names (#572): 1 for one that doesn't exist or never named one. */
export function writerGeneration(path: string): number {
  return existsSync(path) ? metaOf(path).generation : 1;
}

/** Syncs a folder, so the names a rename put in it last. */
function syncFolder(dir: string): void {
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** A backup made ready to put in place of the record: `put` swaps it in, `discard` drops it and leaves the record. */
export interface PreparedRestore { generation: number; put(): void; discard(): void }

/**
 * Readies the backup at `from` to take the place of the record at `to` (#572), with the hub stopped and its lock held:
 * the copy checked whole, every projection rebuilt from its log, the generation raised above the backup's and the
 * replaced record's, and log positions kept above any the replaced record handed out. It counts as a record after a
 * power cut, so the next start judges each claim open in it INVALID. Nothing of `to` changes before `put`, and the
 * backup's files are only read.
 */
export async function prepareRestore(from: string, to: string): Promise<PreparedRestore> {
  const tmp = `${to}.restoring`;
  const discard = () => { for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) rmSync(f, { force: true }); };
  discard();
  try {
    let replaced = { generation: 0, next: 1 };
    if (existsSync(to)) {
      try {
        // A crashed hub leaves its last commits in the WAL, which `put` drops: into the file with them first, so a
        // rerun after a cut inside `put` still reads every log position handed out.
        const replacedDb = new Database(to, { fileMustExist: true });
        try {
          replacedDb.pragma('wal_checkpoint(TRUNCATE)');
        } finally {
          replacedDb.close();
        }
        replaced = metaOf(to);
      } catch (error) {
        throw new RecordError('storage', `the record at ${to} can't be read (${error instanceof Error ? error.message : String(error)}), so its generation is unknown: move it aside, then restore again`);
      }
    }
    copyFileSync(from, tmp);
    if (existsSync(`${from}-wal`)) copyFileSync(`${from}-wal`, `${tmp}-wal`);
    const check = new Database(tmp, { fileMustExist: true });
    try {
      const said = (check.pragma('integrity_check') as { integrity_check: string }[]).map((r) => r.integrity_check).join('; ');
      if (said !== 'ok') throw new RecordError('storage', `the backup at ${from} fails PRAGMA integrity_check: ${said.slice(0, 600)}`);
      // A healthy database that isn't a record would open as a new, empty one in its place.
      const tables = check.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name IN ('meta', 'events')").get() as { n: number };
      if (tables.n !== 2) throw new RecordError('storage', `${from} isn't a DeepBuild record: it holds no meta and events tables`);
    } finally {
      check.close();
    }
    const copy = metaOf(tmp);
    const generation = Math.max(copy.generation, replaced.generation) + 1;
    const record = new SqliteRecord({ path: tmp, now: Date.now }, fileStorage());
    await record.rebuild();
    record.sealRestored(generation, Math.max(copy.next, replaced.next));
    return {
      generation,
      put() {
        // The replaced record's WAL would otherwise be read as the restored one's.
        for (const f of [`${to}-wal`, `${to}-shm`]) rmSync(f, { force: true });
        renameSync(tmp, to);
        syncFolder(dirname(to));
      },
      discard,
    };
  } catch (error) {
    discard();
    throw error;
  }
}
