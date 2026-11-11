// The log as its readers get it: pages of events as JSON text, the next page built ahead, and the stream of each
// event appended. Taken out of the core as one seam with its own state and four things it asks of the core, as
// spool.ts, holds.ts and stacks.ts are.
import type { RecordStore } from '@deepbuild/record';
import type { Scope } from './wire.js';

type Obj = Record<string, unknown>;

/** The events a flush sends one subscriber in its turn (#1575): one reader's backlog never holds another's frames. */
const TURN = 128;
/** A scoped subscribe further behind than this is told to read a fresh snapshot, never replayed (#1575). */
const REPLAY_EVENTS = 128;
const REPLAY_BYTES = 1 << 20;

/**
 * One subscription: the log_pos it was sent up to, its scope as SQL, and the head its reply named until it reaches it;
 * `replying` while its reply is on its way, since no frame goes before the reply.
 */
interface Subscriber { last: number; scope?: { sql: string; values: string[] }; head?: number; replying?: true }

/**
 * An event's JSON text, built by SQLite from the stored row: the record's toJson fields, seq as its decimal string, and
 * `verified` for the unverified mark. `data` and `evidence` are stored as JSON text already, and json_quote writes a
 * string as JSON.stringify does.
 */
const EVENT_TEXT = `'{"v":' || v || ',"id":' || json_quote(id) || ',"kind":' || json_quote(kind) || ',"writer":' || json_quote(writer)
  || ',"actor":' || json_quote(actor) || ',"scope":' || json_quote(scope) || ',"ts":' || ts || ',"log_pos":' || log_pos
  || ',"data":' || data || ',"evidence":' || coalesce(evidence, '[]') || iif(subject IS NULL, '', ',"subject":' || json_quote(subject))
  || iif(seq IS NULL, '', ',"seq":"' || CAST(seq AS TEXT) || '"') || iif(session_id IS NULL, '', ',"session":' || json_quote(session_id))
  || iif(project_id IS NULL, '', ',"project":' || json_quote(project_id)) || iif(agent IS NULL, '', ',"agent":' || json_quote(agent))
  || ',"verified":' || iif(unverified, 'false', 'true') || '}'`;

interface LogReadsOptions {
  /** The record's raw reads, parameters bound. */
  raw: RecordStore['raw'];
  /** Settles once the appends handed to the record have: a read waits for them, so it sees every hook acknowledged before it. */
  settled(): Promise<unknown>;
  /** The events the owner may see, as SQL (#1337): only the owner subscribes. */
  ownerSeen(): string;
  /** Sends one event's JSON text to a subscriber; or, `caught` set, the frame marking that it reached its head. */
  emit(sub: string, json: string, caught?: boolean): void;
}

export class LogReads {
  private readonly subscribers = new Map<string, Subscriber>();
  private streaming = false;
  private restream = false;
  /** The full page after the last one read, built ahead for a reader paging in order. */
  private ahead: { after: number; limit: number; seen: string; log_pos: number; events: string } | undefined;

  constructor(private readonly o: LogReadsOptions) {}

  /**
   * A page of the log as each event's JSON text, the record's own JSON with `verified` for its unverified mark,
   * built by SQLite from the stored text without parsing it again: the reads and the stream page through many events.
   */
  private async page(after: number, limit: number, kinds?: string[], seen = ''): Promise<{ log_pos: number; json: string }[]> {
    const only = kinds ? ` AND kind IN (${kinds.map((k) => `'${k.replace(/'/g, "''")}'`).join(',')})` : '';
    // The position and the page size bound, so every page is the one statement the record keeps compiled.
    return (await this.o.raw(`SELECT log_pos, ${EVENT_TEXT} AS json FROM events WHERE log_pos > ?${only}${seen} ORDER BY log_pos LIMIT ?`, [after, limit])) as { log_pos: number; json: string }[];
  }
  /**
   * The log's committed end, read in the same step as `read` starts, before anything else can append: a read
   * reflects at least that log_pos, so a consumer that subscribes after it misses nothing.
   */
  async reflecting(read: () => Promise<Obj>): Promise<Obj> {
    await this.o.settled();
    const end = this.o.raw('SELECT coalesce(max(log_pos), 0) AS log_pos FROM events');
    const result = read();
    result.catch(() => undefined);
    return { log_pos: Number(((await end) as { log_pos: number }[])[0]!.log_pos), ...(await result) };
  }
  /**
   * A page of the log, of the events `seen` lets its reader see: a full one reflects its last event, a short one the
   * log's end, so an empty gap is crossed once. Its events go back as one JSON array's text, which the server writes
   * as it is.
   */
  async read(params: Obj, seen: string): Promise<Obj> {
    const after = Number.isSafeInteger(params.after) && (params.after as number) >= 0 ? (params.after as number) : 0;
    const limit = Number.isSafeInteger(params.limit) && (params.limit as number) > 0 ? Math.min(params.limit as number, 1000) : 1000;
    const kinds = Array.isArray(params.kinds) && params.kinds.every((k) => typeof k === 'string') ? (params.kinds as string[]) : undefined;
    const ahead = !kinds && this.ahead?.after === after && this.ahead.limit === limit && this.ahead.seen === seen ? this.ahead : undefined;
    this.ahead = undefined;
    let out: { log_pos: number; events: string };
    if (ahead) {
      await this.o.settled();
      out = { log_pos: ahead.log_pos, events: ahead.events };
    } else {
      const read = await this.reflecting(async () => ({ events: await this.page(after, limit, kinds, seen) }));
      const events = read.events as { log_pos: number; json: string }[];
      out = { log_pos: events.length === limit ? events[limit - 1]!.log_pos : Math.max(after, read.log_pos as number), events: `[${events.map((e) => e.json).join(',')}]` };
    }
    // History is paged in order: the next full page is built while the reader takes this one. A full page never
    // changes once committed, since log positions only grow and a gap never fills.
    if (!kinds && out.events !== '[]') {
      setImmediate(() => void this.page(out.log_pos, limit, undefined, seen).then((next) => {
        if (next.length === limit) this.ahead = { after: out.log_pos, limit, seen, log_pos: next[limit - 1]!.log_pos, events: `[${next.map((e) => e.json).join(',')}]` };
      }));
    }
    return out;
  }

  /**
   * Streams every event after `after` to the subscriber, then each one appended from then on. A scoped subscribe
   * (#1575) gets only its scope's events and a reply naming the head: its replay up to the head, one frame marking it,
   * then live frames. One more than 128 events or 1 MiB behind is told to read a fresh snapshot, and isn't subscribed.
   */
  async subscribe(sub: string, after: number, scope?: Scope): Promise<{ head?: number; snapshot?: true }> {
    // Held from the first, so an unsubscribe that comes while the head is read removes it; served once its reply is out.
    const s: Subscriber = { last: after, replying: true };
    this.subscribers.set(sub, s);
    const serve = () => setImmediate(() => {
      delete s.replying;
      this.stream();
    });
    if (!scope) {
      serve();
      return {};
    }
    const where = scope.kind === 'list' ? { sql: ` AND kind = 'row.set'`, values: [] } : { sql: ' AND session_id = ?', values: [scope.session] };
    // Every event at or before the head is replay, and every one after it live: one committed after this read takes a
    // later log_pos, so it is live however soon it lands.
    await this.o.settled();
    const head = Number(((await this.o.raw('SELECT coalesce(max(log_pos), 0) AS head FROM events')) as { head: number }[])[0]!.head);
    const [behind] = (await this.o.raw(`SELECT count(*) AS n, coalesce(sum(octet_length(json)), 0) AS bytes FROM (SELECT ${EVENT_TEXT} AS json FROM events WHERE log_pos > ? AND log_pos <= ?${where.sql}${this.o.ownerSeen()} ORDER BY log_pos LIMIT ?)`, [after, head, ...where.values, REPLAY_EVENTS + 1])) as { n: number; bytes: number }[];
    if (behind!.n > REPLAY_EVENTS || behind!.bytes > REPLAY_BYTES) {
      if (this.subscribers.get(sub) === s) this.subscribers.delete(sub);
      return { head, snapshot: true };
    }
    s.scope = where;
    s.head = head;
    serve();
    return { head };
  }
  unsubscribe(sub: string): void {
    this.subscribers.delete(sub);
  }
  /** An event was appended: each subscriber's frames are flushed. */
  stream(): void {
    if (!this.subscribers.size) return;
    // An append during a flush flushes again after it, so its frame never waits for the next append.
    if (this.streaming) {
      this.restream = true;
      return;
    }
    this.streaming = true;
    setImmediate(() => void this.flushStream().finally(() => {
      this.streaming = false;
      if (this.restream) {
        this.restream = false;
        this.stream();
      }
    }));
  }
  /**
   * One page for each subscriber in turn, until each has every event (#1575): a reader replaying a long backlog holds
   * no other reader's frames, and the core takes hooks between turns.
   */
  private async flushStream(): Promise<void> {
    for (let more = true; more;) {
      more = false;
      for (const [sub, s] of this.subscribers) {
        if (s.replying) continue;
        const events = await this.turn(s);
        if (this.subscribers.get(sub) !== s) continue;
        for (const event of events) this.o.emit(sub, event.json);
        if (events.length) s.last = events[events.length - 1]!.log_pos;
        if (events.length === TURN) more = true;
        else if (s.head !== undefined) {
          // Its replay reached the head its reply named: one frame marks it, and every frame after it is live.
          this.o.emit(sub, String(s.head), true);
          s.last = Math.max(s.last, s.head);
          delete s.head;
          more = true;
        }
      }
      if (more) await new Promise((done) => setImmediate(done));
    }
  }
  /** A subscriber's next page: its scope's events after its last, up to the head its reply named while it replays. */
  private async turn(s: Subscriber): Promise<{ log_pos: number; json: string }[]> {
    const upTo = s.head === undefined ? [] : [s.head];
    // Only the owner subscribes, and reads what the owner may see (#1337).
    return (await this.o.raw(`SELECT log_pos, ${EVENT_TEXT} AS json FROM events WHERE log_pos > ?${upTo.length ? ' AND log_pos <= ?' : ''}${s.scope?.sql ?? ''}${this.o.ownerSeen()} ORDER BY log_pos LIMIT ?`, [s.last, ...upTo, ...(s.scope?.values ?? []), TURN])) as { log_pos: number; json: string }[];
  }
}
