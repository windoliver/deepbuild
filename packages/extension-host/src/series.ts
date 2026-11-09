// Series sources (#262). A call returns up to 10,000 named values; the hub keeps them in one evidence file named by
// one reading.batch event, never one event per value. A file holds the hash of the names it indexes and, per value,
// that name's index and the value (12 bytes); the names live in their own file, stored once for each set of names.
// Each file also holds its as-of time or its window's start, so two calls or windows with the same values never share
// a content-addressed file, and each ages from its own put. A value belongs to the minute and the hour of its as-of time. A window closes once its end plus the source's timeout
// has passed, and each closed window's rollup (min, max, mean, last and count per series, 40 bytes a series) is one
// more evidence file, named by a reading.rollup event. An hour's mean is over its values, never over minute means.

import { createHash } from 'node:crypto';
import { EvidenceError, type EvidenceStore, type Writer } from '@deepbuild/evidence';
import { ulid, type Connection, type EventInput, type RecordStore } from '@deepbuild/record';
import type { Batch } from './sources.js';

/** The most named values one call of a series source may return. */
export const SERIES_MAX = 10_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

const BATCH = 0x31425344; // "DSB1"
const ROLLUP = 0x31525344; // "DSR1"
const HEAD = 4 + 32 + 8 + 4;

/** One series' rollup over a window. */
export interface Rollup { min: number; max: number; mean: number; last: number; count: number }
export type Span = 'minute' | 'hour';

/** The names file: one name a line, in the order a batch's and a rollup's indexes count. */
const namesFile = (names: readonly string[]): Uint8Array => Buffer.from(names.join('\n'), 'utf8');
const readNames = (bytes: Uint8Array): string[] => (bytes.length ? Buffer.from(bytes).toString('utf8').split('\n') : []);

function head(magic: number, names: string, at: number, n: number, size: number): Buffer {
  const out = Buffer.alloc(HEAD + size);
  out.writeUInt32LE(magic, 0);
  out.write(names, 4, 32, 'hex');
  out.writeDoubleLE(at, 36);
  out.writeUInt32LE(n, 44);
  return out;
}
function opened(bytes: Uint8Array, magic: number, what: string): { buf: Buffer; names: string; n: number } {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < HEAD || buf.readUInt32LE(0) !== magic) throw Error(`it isn't a ${what} file`);
  return { buf, names: buf.toString('hex', 4, 36), n: buf.readUInt32LE(44) };
}

/** A batch file: the names file's hash and the call's as-of time, then each value as its name's index and the number. */
function batchFile(names: string, asOf: number, values: readonly number[]): Uint8Array {
  const out = head(BATCH, names, asOf, values.length, values.length * 12);
  for (let i = 0; i < values.length; i++) {
    out.writeUInt32LE(i, HEAD + i * 12);
    out.writeDoubleLE(values[i]!, HEAD + i * 12 + 4);
  }
  return out;
}
function readBatch(bytes: Uint8Array): { names: string; values: Map<number, number> } {
  const { buf, names, n } = opened(bytes, BATCH, 'batch');
  if (buf.length !== HEAD + n * 12) throw Error('its length isn\'t its values\'');
  const values = new Map<number, number>();
  for (let i = 0; i < n; i++) values.set(buf.readUInt32LE(HEAD + i * 12), buf.readDoubleLE(HEAD + i * 12 + 4));
  return { names, values };
}

/** A rollup file: the names file's hash and the window's start, then each series' min, max, mean, last and count, in the names' order. */
function rollupFile(names: string, start: number, rollups: readonly Rollup[]): Uint8Array {
  const out = head(ROLLUP, names, start, rollups.length, rollups.length * 40);
  rollups.forEach((r, i) => [r.min, r.max, r.mean, r.last, r.count].forEach((v, j) => out.writeDoubleLE(v, HEAD + i * 40 + j * 8)));
  return out;
}
function readRollup(bytes: Uint8Array): { names: string; rollups: Rollup[] } {
  const { buf, names, n } = opened(bytes, ROLLUP, 'rollup');
  if (buf.length !== HEAD + n * 40) throw Error('its length isn\'t its series\'');
  const at = (i: number, j: number) => buf.readDoubleLE(HEAD + i * 40 + j * 8);
  return { names, rollups: Array.from({ length: n }, (_, i) => ({ min: at(i, 0), max: at(i, 1), mean: at(i, 2), last: at(i, 3), count: at(i, 4) })) };
}

/** A window's running rollup per series: the sum keeps an hour's mean over its values. */
interface Acc { min: number; max: number; sum: number; last: number; lastAt: number; count: number }
interface Window { span: Span; start: number; series: Map<string, Acc> }

/** The open minute and hour windows of one source, and the ones that closed. */
class Rollups {
  private readonly open = new Map<string, Window>();

  constructor(private readonly timeout: number) {}

  /** A call's values, at its as-of time, into its minute and its hour, or only the spans named. */
  add(asOf: number, values: ReadonlyMap<string, number>, spans: readonly Span[] = ['minute', 'hour']): void {
    for (const span of spans) {
      const size = span === 'minute' ? MINUTE_MS : HOUR_MS;
      const start = asOf - (asOf % size);
      const key = `${span}:${start}`;
      const w = this.open.get(key) ?? this.open.set(key, { span, start, series: new Map() }).get(key)!;
      for (const [name, v] of values) {
        const a = w.series.get(name);
        if (!a) w.series.set(name, { min: v, max: v, sum: v, last: v, lastAt: asOf, count: 1 });
        else {
          a.min = Math.min(a.min, v);
          a.max = Math.max(a.max, v);
          a.sum += v;
          a.count++;
          if (asOf >= a.lastAt) { a.last = v; a.lastAt = asOf; }
        }
      }
    }
  }

  /** The windows whose end plus the timeout has passed by `now`, minutes before hours, each taken out. */
  close(now: number): { span: Span; start: number; series: Map<string, Rollup> }[] {
    const closed: Window[] = [];
    for (const [key, w] of this.open) {
      if (now >= w.start + (w.span === 'minute' ? MINUTE_MS : HOUR_MS) + this.timeout) { closed.push(w); this.open.delete(key); }
    }
    const end = (w: Window) => w.start + (w.span === 'minute' ? MINUTE_MS : HOUR_MS);
    closed.sort((a, b) => end(a) - end(b) || (a.span === b.span ? 0 : a.span === 'minute' ? -1 : 1));
    return closed.map((w) => ({
      span: w.span, start: w.start,
      series: new Map([...w.series].map(([name, a]) => [name, { min: a.min, max: a.max, mean: a.sum / a.count, last: a.last, count: a.count }])),
    }));
  }
}

/** A bound value as a frame draws it: live, or as of the log position the frame pins. */
export interface BoundValue {
  handle: string;
  status: 'reading' | 'rollup' | 'quota' | 'missing';
  value: number | null;
  as_of: number | null;
  /** What is drawn: the number, or a dash when missing, never zero. */
  shown: string;
  /** With status rollup: the window the value resolved to, whose `last` it shows. */
  span?: Span;
  /** With status quota: when the call can run. */
  until?: number;
  /** With status missing: why, naming the batch and, for a file that fails its hash, the mismatch. */
  cause?: string;
}
export const missing = (handle: string, cause: string): BoundValue => ({ handle, status: 'missing', value: null, as_of: null, shown: '—', cause });
export const shownValue = (handle: string, value: number, asOf: number, more: Partial<BoundValue> = {}): BoundValue => ({ handle, status: 'reading', value, as_of: asOf, shown: String(value), ...more });

/** One landed batch, as the record holds it. */
interface Landed { log_pos: number; as_of: number; handle: string; file: string }
/** The evidence kinds a series' files are kept as: the rollups' kinds name their span, for retention. */
const SERIES_KINDS: ReadonlySet<string> = new Set(['reading.batch', 'reading.rollup.minute', 'reading.rollup.hour']);
const NAMES_KIND = 'reading.names';
/** How often a names file in use is stored again, which keeps it as long as what names it. */
const NAMES_REPUT_MS = 86_400_000;
/** How often the series' own retention pass runs, on the hub's timer. */
const RETAIN_EVERY_MS = HOUR_MS;
const DAY_MS = 86_400_000;

/**
 * The evidence a check, notice or decision cites, which retention keeps (#262): every file a decision or verdict
 * cites, and, for 30 days, each batch file a notice cites by its handle. The hub's own retention pass reads it too.
 */
export async function citedEvidence(record: RecordStore, now: number): Promise<Set<string>> {
  const rows = (await record.raw("SELECT evidence FROM events WHERE kind IN ('decision.created', 'decision.applied', 'verdict.made') AND evidence IS NOT NULL")) as { evidence: string }[];
  const cited = new Set(rows.flatMap((r) => JSON.parse(r.evidence) as string[]));
  const notices = (await record.raw(`SELECT json_extract(b.data, '$.file') AS file FROM events n, json_each(n.data, '$.cites') c JOIN events b ON b.id = substr(c.value, 9)
    WHERE n.kind = 'notice.sent' AND n.ts > ? AND c.value LIKE 'reading:%' AND b.kind = 'reading.batch'`, [now - 30 * DAY_MS])) as { file: string }[];
  for (const r of notices) cited.add(r.file);
  return cited;
}

/**
 * The hub's series (#262): each call landed as one batch file and one reading.batch event; each closed window's
 * rollups as one file and one reading.rollup event; a bound value resolved live or through the batch at a pinned log
 * position, falling back to its minute and then its hour rollup once retention took the batch's file.
 */
export class SeriesStore {
  /** Each source's newest batch, its values by name, for live bound values. */
  private readonly latest = new Map<string, { as_of: number; values: Map<string, number> }>();
  /** Each source's batches by log position, read from the record the first time one is resolved. */
  private readonly landed = new Map<string, Landed[]>();
  private readonly windows = new Map<string, Rollups>();
  /** Names files read and checked, by hash. */
  private readonly names = new Map<string, Map<string, number>>();
  private readonly namesPut = new Map<string, number>();
  private readonly writer: Writer;
  private retained = -Infinity;
  private reopened: Promise<void> | undefined;

  constructor(private readonly o: { record: RecordStore; evidence: EvidenceStore; now: () => number; connection: Connection; timeoutOf?: (source: string) => number | undefined }) {
    this.writer = o.evidence.connect({ role: 'deepbuild', via: 'job' });
  }

  private async put(bytes: Uint8Array, kind: string, source: string): Promise<string> {
    const put = await this.writer.put({ bytes, kind, source, redaction: 'complete', license: { name: 'own', allows: [] } });
    if (put.status !== 'stored') throw Error(`the evidence store refused ${source}'s ${kind}: ${put.reason}`);
    return put.evidence.sha256;
  }
  /** The names file for these names, stored again once a day while in use, so it outlives the files that index it. */
  private async namesOf(names: readonly string[], source: string): Promise<string> {
    const bytes = namesFile(names);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (this.o.now() - (this.namesPut.get(sha) ?? -Infinity) >= NAMES_REPUT_MS) {
      await this.put(bytes, NAMES_KIND, source);
      this.namesPut.set(sha, this.o.now());
      this.names.set(sha, new Map(names.map((n, i) => [n, i])));
    }
    return sha;
  }

  /** A series call's values: one batch file, one reading.batch event, its values into their minute and hour. */
  async land(source: { name: string; timeout: number }, asOf: number, values: Map<string, number>): Promise<Batch> {
    await (this.reopened ??= this.reopen());
    const order = [...values.keys()];
    const names = await this.namesOf(order, source.name);
    const file = await this.put(batchFile(names, asOf, order.map((n) => values.get(n)!)), 'reading.batch', source.name);
    // The event holds only the source, the as-of time and the file's hash; its handle is its ID, so it needs no subject.
    const id = ulid(this.o.now());
    const handle = `reading:${id}`;
    const { log_pos } = await this.o.record.append(this.o.connection, { v: 1, id, kind: 'reading.batch', ts: this.o.now(), data: { source: source.name, as_of: asOf, file } } as EventInput);
    this.landed.get(source.name)?.push({ log_pos, as_of: asOf, handle, file });
    this.latest.set(source.name, { as_of: asOf, values });
    this.windowsOf(source.name, source.timeout).add(asOf, values);
    return { handle, source: source.name, as_of: asOf, file, count: values.size };
  }

  /** The hub's timer: each window that closed gets its rollup file and event; once an hour, the series' retention. */
  async tick(): Promise<void> {
    await (this.reopened ??= this.reopen());
    const now = this.o.now();
    for (const [source, windows] of this.windows) {
      for (const w of windows.close(now)) {
        const order = [...w.series.keys()].sort();
        const names = await this.namesOf(order, source);
        const file = await this.put(rollupFile(names, w.start, order.map((n) => w.series.get(n)!)), `reading.rollup.${w.span}`, source);
        await this.o.record.append(this.o.connection, { v: 1, id: ulid(now), kind: 'reading.rollup', ts: now, data: { source, span: w.span, start: w.start, file } } as EventInput);
      }
    }
    if (now - this.retained >= RETAIN_EVERY_MS) {
      this.retained = now;
      await this.o.evidence.retain({ cited: await citedEvidence(this.o.record, now), archived: new Set(), kinds: SERIES_KINDS });
    }
  }

  private windowsOf(source: string, timeout: number): Rollups {
    return this.windows.get(source) ?? this.windows.set(source, new Rollups(timeout)).get(source)!;
  }

  /**
   * After a restart, the windows the last process left open, rebuilt from the batches still kept: each one closes
   * with a rollup over every value it holds, landed before the restart or after, even if its source is never called again.
   */
  private async reopen(): Promise<void> {
    const closed = new Map<string, number>();
    for (const r of (await this.o.record.raw('SELECT source, span, MAX(start) AS start FROM rollups GROUP BY source, span')) as { source: string; span: Span; start: number }[]) {
      closed.set(`${r.source}\n${r.span}`, Number(r.start) + (r.span === 'minute' ? MINUTE_MS : HOUR_MS));
    }
    const rows = (await this.o.record.raw("SELECT data FROM events WHERE kind = 'reading.batch' AND json_extract(data, '$.as_of') >= ? ORDER BY log_pos", [this.o.now() - DAY_MS])) as { data: string }[];
    for (const row of rows) {
      const d = JSON.parse(row.data) as { source: string; as_of: number; file: string };
      const spans = (['minute', 'hour'] as const).filter((span) => d.as_of >= (closed.get(`${d.source}\n${span}`) ?? -Infinity));
      if (spans.length === 0) continue;
      const got = await this.bytes(d.file);
      if (got === 'gone' || 'bad' in got) continue;
      let batch: ReturnType<typeof readBatch>;
      try { batch = readBatch(got); } catch { continue; }
      const index = await this.indexOf(batch.names);
      if (typeof index === 'string') continue;
      const names = new Map([...index].map(([name, i]) => [i, name]));
      this.windowsOf(d.source, this.o.timeoutOf?.(d.source) ?? 0).add(d.as_of, new Map([...batch.values].map(([i, v]) => [names.get(i)!, v])), spans);
    }
  }

  /** One series' newest value, live. */
  live(source: string, series: string): { value: number; as_of: number } | undefined {
    const l = this.latest.get(source);
    const v = l?.values.get(series);
    return v === undefined ? undefined : { value: v, as_of: l!.as_of };
  }

  /** A batch the record holds, by its handle. */
  async batch(handle: string): Promise<{ source: string; file: string; as_of: number; log_pos: number } | undefined> {
    if (!handle.startsWith('reading:')) return undefined;
    const [row] = (await this.o.record.raw("SELECT log_pos, data FROM events WHERE id = ? AND kind = 'reading.batch'", [handle.slice('reading:'.length)])) as { log_pos: number; data: string }[];
    return row ? { ...(JSON.parse(row.data) as { source: string; file: string; as_of: number }), log_pos: row.log_pos } : undefined;
  }

  /** A file's bytes, or why there are none: gone, which retention did, or failing its hash. */
  private async bytes(sha: string): Promise<Uint8Array | 'gone' | { bad: string }> {
    if (!(await this.o.evidence.get(sha))) return 'gone';
    try {
      return await this.o.evidence.read(sha);
    } catch (e) {
      return { bad: e instanceof EvidenceError && e.code === 'corrupt' ? `its file ${sha} fails its hash: its bytes no longer match` : `its file ${sha} is gone: ${(e as Error).message}` };
    }
  }
  private async indexOf(names: string): Promise<Map<string, number> | string> {
    const known = this.names.get(names);
    if (known) return known;
    const got = await this.bytes(names);
    if (got === 'gone' || 'bad' in got) return `its names file ${names} is ${got === 'gone' ? 'gone' : 'unreadable'}`;
    const index = new Map(readNames(got).map((n, i) => [n, i]));
    this.names.set(names, index);
    return index;
  }

  /**
   * One series' value through the batch at a pinned log position: the batch's own value while its file is kept, else
   * its minute rollup's `last`, else its hour rollup's; missing, with the cause, when none is left or a file fails its hash.
   */
  async at(handle: string, source: string, series: string, pin: number): Promise<BoundValue> {
    let landed = this.landed.get(source);
    if (!landed) {
      const rows = (await this.o.record.raw("SELECT log_pos, id, data FROM events WHERE kind = 'reading.batch' AND json_extract(data, '$.source') = ? ORDER BY log_pos", [source])) as { log_pos: number; id: string; data: string }[];
      landed = rows.map((r) => { const d = JSON.parse(r.data) as { as_of: number; file: string }; return { log_pos: r.log_pos, as_of: d.as_of, handle: `reading:${r.id}`, file: d.file }; });
      this.landed.set(source, landed);
    }
    let lo = 0;
    let hi = landed.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (landed[mid]!.log_pos <= pin) lo = mid + 1; else hi = mid; }
    const b = landed[lo - 1];
    if (!b) return missing(handle, `no batch of ${source} at or before log position ${pin}`);
    const got = await this.bytes(b.file);
    if (got !== 'gone') {
      if ('bad' in got) return missing(handle, `the batch ${b.handle}: ${got.bad}`);
      let batch: ReturnType<typeof readBatch>;
      try { batch = readBatch(got); } catch (e) { return missing(handle, `the batch ${b.handle} can't be read: ${(e as Error).message}`); }
      const index = await this.indexOf(batch.names);
      if (typeof index === 'string') return missing(handle, `the batch ${b.handle}: ${index}`);
      const at = index.get(series);
      const v = at === undefined ? undefined : batch.values.get(at);
      return v === undefined ? missing(handle, `the batch ${b.handle} holds no ${series}`) : shownValue(handle, v, b.as_of);
    }
    for (const span of ['minute', 'hour'] as const) {
      const start = b.as_of - (b.as_of % (span === 'minute' ? MINUTE_MS : HOUR_MS));
      const r = await this.rollup(source, span, start);
      if (r === null) continue;
      if (typeof r === 'string') return missing(handle, `the batch ${b.handle} is gone, and its ${span} rollup ${r}`);
      const stats = r[series];
      return stats ? shownValue(handle, stats.last, b.as_of, { status: 'rollup', span }) : missing(handle, `the batch ${b.handle} is gone, and its ${span} rollup holds no ${series}`);
    }
    return missing(handle, `the batch ${b.handle}'s file and its minute and hour rollups are gone`);
  }

  /** One window's rollups by series, from the file its reading.rollup names: null when none is kept, or why it can't be read. */
  async rollup(source: string, span: Span, start: number): Promise<Record<string, Rollup> | string | null> {
    const [row] = (await this.o.record.raw('SELECT evidence FROM rollups WHERE source = ? AND span = ? AND start = ?', [source, span, start])) as { evidence: string }[];
    if (!row) return null;
    const got = await this.bytes(row.evidence);
    if (got === 'gone') return null;
    if ('bad' in got) return got.bad;
    let r: ReturnType<typeof readRollup>;
    try { r = readRollup(got); } catch (e) { return `can't be read: ${(e as Error).message}`; }
    const index = await this.indexOf(r.names);
    if (typeof index === 'string') return index;
    const out: Record<string, Rollup> = {};
    for (const [name, i] of index) if (r.rollups[i]) out[name] = r.rollups[i]!;
    return out;
  }
}
