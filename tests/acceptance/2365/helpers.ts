// Test-side tools for the #2365 acceptance tests. They build on #20's (tests/acceptance/20/helpers.ts: the world, the
// transcripts written as each agent writes them, the archive from its public entry), and add the one reading this
// issue needs and leaves to the implementer: "the session's archived transcript is its parts in order".
//
// How a part is recorded is the implementer's (Scope: "as a new version of `transcript.archived` or beside it"), so
// nothing here reads a new event shape. A session's parts are read from the record and the evidence store only:
//
//   - its events: every event of a `transcript.*` kind whose `data.session` (or `subject`) is the session's handle,
//     in log order (the base's `transcript.archived@2`, a new version of it, or a kind beside it);
//   - each event's evidence, in order: its `evidence` list as the record keeps it, or `data.evidence` when that
//     list is empty;
//   - a reading of the archived copy: the concatenation of the evidence of a run of events up to the newest one
//     (a copy and the parts added since), or a suffix of the newest event's own list (an event that lists every
//     part of the current copy). The base's one whole copy per event is the reading "the newest event alone".
//
// The copy holds when some reading's bytes, read back from the store, equal the transcript scrubbed. When none does,
// the failure names the closest reading (the one agreeing longest), its parts, and the first line that differs.
// Handles are read through the record's own public readers, `resolve` and `transcript`, which is what "the
// session's handles resolve" means whatever the shape (design: Reading by reference).

import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scrubText } from '../../../packages/evidence/src/index.ts';
import type { Event } from '../../../packages/record/src/index.ts';
import { allEvents, dataOf, evidenceOf, handle, letters, toJsonAll, type World } from '../20/helpers.ts';

export * from '../20/helpers.ts';
export { scrubText };

export const MB = 1_000_000;
const HEX64 = /^[0-9a-f]{64}$/;

// ---- The session's parts, read from the record.

/** The events that may record a session's copy: any `transcript.*` kind naming its handle, in log order. */
export async function copyEvents(w: World, id: string): Promise<Event[]> {
  const h = handle(id);
  return (await allEvents(w.record)).filter((e) => /^transcript\./.test(e.kind) && (dataOf(e).session === h || e.subject === h));
}
/** An event's evidence, in order: its evidence list, or `data.evidence` when the list is empty. */
export function evidenceListOf(e: Event): string[] {
  const listed = (e.evidence ?? []).filter((s) => HEX64.test(s));
  if (listed.length) return listed;
  const d = dataOf(e).evidence;
  return typeof d === 'string' && HEX64.test(d) ? [d] : [];
}
/** The readings of a session's archived copy (see the top of this file), newest-first and shortest-first. */
export function readingsOf(lists: readonly string[][]): { parts: string[]; from: string }[] {
  const out: { parts: string[]; from: string }[] = [];
  const seen = new Set<string>();
  const add = (parts: string[], from: string) => {
    const key = parts.join(',');
    if (parts.length && !seen.has(key)) { seen.add(key); out.push({ parts, from }); }
  };
  for (let k = lists.length - 1; k >= 0; k--) add(lists.slice(k).flat(), `the evidence of events ${k + 1}…${lists.length} of ${lists.length}`);
  const last = lists[lists.length - 1] ?? [];
  for (let j = 1; j < last.length; j++) add(last.slice(j), `the newest event's evidence from its item ${j + 1}`);
  return out;
}

// ---- Byte streams, compared a chunk at a time so a 600 MB copy never sits in this process whole.

export type Bytes = AsyncIterable<Uint8Array>;
const asBuffer = (u: Uint8Array): Buffer => Buffer.from(u.buffer, u.byteOffset, u.byteLength);
export async function* bytesOf(...chunks: (Uint8Array | string)[]): Bytes {
  for (const c of chunks) yield typeof c === 'string' ? Buffer.from(c, 'utf8') : c;
}
/** A list of parts, each read back from the store in turn. */
export async function* partsBytes(w: World, parts: readonly string[]): Bytes {
  for (const sha of parts) yield await w.store.read(sha);
}
/** A file's lines, each with its `\n`, read a chunk at a time; the last without one if the file ends without one. */
export async function* linesOf(path: string, end = Infinity): AsyncGenerator<Buffer> {
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20, ...(Number.isFinite(end) ? { end: end - 1 } : {}) })) {
    let buf = carry.length ? Buffer.concat([carry, chunk as Buffer]) : (chunk as Buffer);
    let at = 0;
    for (let nl = buf.indexOf(10, at); nl >= 0; nl = buf.indexOf(10, at)) {
      yield buf.subarray(at, nl + 1);
      at = nl + 1;
    }
    carry = Buffer.from(buf.subarray(at));
    buf = Buffer.alloc(0);
  }
  if (carry.length) yield carry;
}
/** A file scrubbed a line at a time, as the store's ingestion scrubs text (design: Privacy), up to byte `end`. */
export async function* scrubbedByLine(path: string, held: readonly string[] = [], end = Infinity): Bytes {
  for await (const line of linesOf(path, end)) yield Buffer.from(scrubText(line.toString('utf8'), { held: [...held] }), 'utf8');
}

class Reader {
  buf = Buffer.alloc(0);
  pos = 0;
  constructor(private it: AsyncIterator<Uint8Array>) {}
  async fill(): Promise<boolean> {
    while (this.pos >= this.buf.length) {
      const next = await this.it.next();
      if (next.done) return false;
      this.buf = asBuffer(next.value);
      this.pos = 0;
    }
    return true;
  }
  /** The rest of the current line, at most `cap` bytes. */
  async restOfLine(cap = 65_536): Promise<Buffer> {
    const got: Buffer[] = [];
    let size = 0;
    while (size < cap && (await this.fill())) {
      const nl = this.buf.indexOf(10, this.pos);
      const stop = Math.min(nl < 0 ? this.buf.length : nl, this.pos + cap - size);
      got.push(this.buf.subarray(this.pos, stop));
      size += stop - this.pos;
      this.pos = stop;
      if (nl >= 0 && stop === nl) break;
    }
    return Buffer.concat(got);
  }
}
export interface Diff {
  equal: boolean;
  /** Bytes the two agree on from the start. */
  matched: number;
  /** The 1-based line the first difference is on. */
  line: number;
  expectedLine?: string;
  actualLine?: string;
  /** The `uuid` of the transcript's line there, when it has one: the message `session:<id>#<uuid>` names. */
  uuid?: string;
  ended?: 'actual' | 'expected';
}
const HEAD = 240;
const UUID = /"uuid":"([^"]+)"/;
/** Compares two byte streams; where they differ, the line and both sides of it. */
export async function compareBytes(actual: Bytes, expected: Bytes): Promise<Diff> {
  const a = new Reader(actual[Symbol.asyncIterator]());
  const b = new Reader(expected[Symbol.asyncIterator]());
  let matched = 0;
  let line = 1;
  let head = Buffer.alloc(0);
  // The current line's `uuid`, once the bytes matched on it hold one, and the last bytes matched on it until then:
  // `head` keeps only the line's start, so a `uuid` past it and before the first difference would be lost.
  let uuid: string | undefined;
  let tail = Buffer.alloc(0);
  const differ = async (ended?: 'actual' | 'expected'): Promise<Diff> => {
    const rest = await b.restOfLine();
    const exp = Buffer.concat([head, rest]).toString('utf8');
    const act = Buffer.concat([head, await a.restOfLine()]).toString('utf8');
    uuid ??= UUID.exec(Buffer.concat([tail, rest]).toString('utf8'))?.[1];
    return { equal: false, matched, line, expectedLine: exp, actualLine: act, ...(uuid ? { uuid } : {}), ...(ended ? { ended } : {}) };
  };
  for (;;) {
    const ha = await a.fill();
    const hb = await b.fill();
    if (!ha && !hb) return { equal: true, matched, line };
    if (!ha) return differ('actual');
    if (!hb) return differ('expected');
    const n = Math.min(a.buf.length - a.pos, b.buf.length - b.pos);
    const sa = a.buf.subarray(a.pos, a.pos + n);
    const sb = b.buf.subarray(b.pos, b.pos + n);
    let k = n;
    if (!sa.equals(sb)) for (k = 0; k < n && sa[k] === sb[k]; k++);
    const same = sa.subarray(0, k);
    let last = -1;
    for (let nl = same.indexOf(10); nl >= 0; nl = same.indexOf(10, nl + 1)) { line++; last = nl; }
    head = last >= 0 ? Buffer.from(same.subarray(last + 1, last + 1 + HEAD)) : head.length < HEAD ? Buffer.concat([head, same.subarray(0, HEAD - head.length)]) : head;
    if (last >= 0) { uuid = undefined; tail = Buffer.alloc(0); }
    if (uuid === undefined) {
      const seen = Buffer.concat([tail, same.subarray(last + 1)]);
      uuid = UUID.exec(seen.toString('utf8'))?.[1];
      tail = Buffer.from(seen.subarray(-HEAD));
    }
    matched += k;
    a.pos += k;
    b.pos += k;
    if (k < n) return differ();
  }
}
const clip = (s: string | undefined, n = 160): string => {
  if (s === undefined) return '';
  return s.length > n ? `${s.slice(0, n)}… (${s.length} chars)` : s;
};
export const short = (sha: string): string => sha.slice(0, 12);

export interface Copy { events: Event[]; parts: string[]; from: string }
/**
 * Asserts the session's archived copy, read from its parts (the top of this file), equals `expected()`: a fresh
 * stream of the transcript scrubbed each time it is called. Fails naming the closest reading and its first
 * differing line.
 */
export async function expectCopy(w: World, id: string, expected: () => Bytes, why: string): Promise<Copy> {
  const events = await copyEvents(w, id);
  if (!events.length) throw Error(`${why}: no transcript.* event names ${handle(id)}: the session has no archived copy`);
  const lists = events.map(evidenceListOf);
  const readings = readingsOf(lists);
  if (!readings.length) throw Error(`${why}: the ${events.length} transcript.* event(s) naming ${handle(id)} cite no evidence`);
  let best: { parts: string[]; from: string; d: Diff | { error: string; matched: number } } | undefined;
  for (const r of readings) {
    let d: Diff | { error: string; matched: number };
    try {
      d = await compareBytes(partsBytes(w, r.parts), expected());
    } catch (error) {
      d = { error: (error as Error).message, matched: -1 };
    }
    if ('equal' in d && d.equal) return { events, parts: r.parts, from: r.from };
    if (!best || d.matched > best.d.matched) best = { ...r, d };
  }
  const b = best!;
  const where = `parts ${b.parts.map(short).join(', ')} (${b.parts.length} part${b.parts.length === 1 ? '' : 's'}: ${b.from})`;
  if ('error' in b.d) throw Error(`${why}: no reading of ${handle(id)}'s ${events.length} copy event(s) joins to the transcript scrubbed; the closest, ${where}, doesn't read back: ${b.d.error}`);
  const d = b.d;
  const at = `line ${d.line}${d.uuid ? ` (message ${d.uuid})` : ''}, byte ${d.matched}`;
  const said = d.ended === 'actual' ? `the parts end there, where the transcript has «${clip(d.expectedLine)}»`
    : d.ended === 'expected' ? `the transcript ends there, where the parts go on with «${clip(d.actualLine)}»`
      : `the transcript has «${clip(d.expectedLine)}» and the parts have «${clip(d.actualLine)}»`;
  throw Error(`${why}: no reading of ${handle(id)}'s ${events.length} copy event(s) joins to the transcript scrubbed. The closest, ${where}, first differs at ${at}: ${said}`);
}

// ---- Everything the store holds, for "in no part in any form".

/** Every hash the store holds, from its folder (design, Evidence: `evidence/ab/cdef…`). */
export function storedHashes(w: World): string[] {
  const root = evidenceOf(w.root);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const dir of readdirSync(root)) {
    if (!/^[0-9a-f]{2}$/.test(dir)) continue;
    for (const f of readdirSync(join(root, dir))) {
      const m = /^([0-9a-f]{62})/.exec(f);
      if (m) out.push(dir + m[1]);
    }
  }
  return [...new Set(out)];
}
/** Every hash an event cites: its evidence list and any 64-hex string in its data. */
export async function citedHashes(w: World): Promise<Map<string, Event>> {
  const out = new Map<string, Event>();
  const walk = (v: unknown, e: Event): void => {
    if (typeof v === 'string') { if (HEX64.test(v) && !out.has(v)) out.set(v, e); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, e));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, e));
  };
  for (const e of await allEvents(w.record)) { walk(e.evidence, e); walk(e.data, e); }
  return out;
}
/** The 12-character runs of a key's random part: any one found anywhere is the key, or a piece of it, in that form. */
export const windowsOf = (secret: string, size = 12): string[] => Array.from({ length: secret.length - size + 1 }, (_, i) => secret.slice(i, i + size));
/**
 * Asserts no evidence the store holds, cited or not, and nothing in the record, holds any 12-character piece of the
 * key's random part. Fails naming the part (its hash, and the event citing it) and which characters of the key.
 */
export async function expectKeyNowhere(w: World, key: string, randomFrom: number, why: string): Promise<void> {
  const secret = key.slice(randomFrom);
  const windows = windowsOf(secret);
  const cited = await citedHashes(w);
  for (const sha of new Set([...cited.keys(), ...storedHashes(w)])) {
    if (!(await w.store.get(sha))) continue;
    const text = Buffer.from(await w.store.read(sha)).toString('utf8');
    const i = windows.findIndex((win) => text.includes(win));
    if (i >= 0) {
      const e = cited.get(sha);
      const by = e ? `cited by ${e.kind}@${e.v} at log position ${e.log_pos}` : 'cited by no event';
      throw Error(`${why}: the key's characters ${randomFrom + i + 1}–${randomFrom + i + 12} (of ${key.length}) are in part ${sha} (${by}); a key half written when a pass ran must be in no part in any form`);
    }
  }
  const record = await toJsonAll(w);
  const j = windows.findIndex((win) => record.includes(win));
  if (j >= 0) throw Error(`${why}: the key's characters ${randomFrom + j + 1}–${randomFrom + j + 12} are in the record's events`);
}

// ---- Asks and handles, through public readers.

/** The rotate asks raised for a session: ask.created events whose question says rotate, in the session. */
export async function rotateAsksOf(w: World, id: string): Promise<Event[]> {
  return (await allEvents(w.record, ['ask.created'])).filter((e) => /rotat/i.test(String(dataOf(e).question)) && letters(e.session ?? '') === letters(id));
}
/** What `session:<id>#<message>` resolves to through the record, or undefined. */
export async function resolved(w: World, id: string, message: string): Promise<string | undefined> {
  return (await w.record.resolve(`${handle(id)}#${message}`))?.text;
}
