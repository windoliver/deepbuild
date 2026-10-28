// Slices of what a handle names (design: Reading by reference): `deep read`, `deep find` and a reading job's tools all
// read through here. A `session:` handle resolves through the record, by the evidence its transcript.archived event
// links, never through an agent's or an extension's folder; an `ev:` handle is an evidence file; a `wiki:` handle is a
// claim on the wiki's pages. Every reply holds at most the cap of text, and a cut one says where to continue.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openRecordReader, parseClaimLine, type Message, type RecordReader } from '@deepbuild/record';

/** Output is capped per call, at 8,192 characters by default. */
export const CAP = 8192;

/** reading.slice@1: one slice of what a handle names. */
export interface Slice {
  handle: string;
  /** Which part of its source the slice covers, in words. */
  covers: string;
  text: string;
  /** The cursor that continues it; absent when nothing is left. */
  next?: string;
  /** For a transcript: each message the slice holds, in order, and where its text sits in `text`. */
  messages?: { at: string; role: string; outside: boolean; tool?: string; start: number; end: number }[];
}
/** What `deep find` returns: matching handles, a line of context each. */
export interface Found { hits: { handle: string; context: string }[]; next?: string }

/** A handle that names nothing, or a cursor that leads nowhere; its message names the handle. */
export class NotFound extends Error {}

export interface Slicer {
  read(handle: string, cursor?: string): Promise<Slice>;
  /** Handles whose text holds the query, ignoring case: transcript messages of `sessions` (default: every archived one), and, without `sessions`, your decisions, text evidence and wiki claims. */
  find(query: string, cursor?: string, sessions?: readonly string[]): Promise<Found>;
  /** The sessions a transcript.archived event links, as `session:<id>` handles. */
  archived(): Promise<string[]>;
  /** What a handle names, whole, with how its source knew it; undefined for nothing. For quotes, never shown to an agent. */
  whole(handle: string): Promise<{ text: string; role?: string; tool?: string; outside: boolean } | undefined>;
  close(): void;
}

const SESSION = /^session:([0-9A-Za-z]+)$/;
const MESSAGE = /^session:([0-9A-Za-z]+)#([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const WIKI = /^wiki:([a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*)#([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const SESSION_CURSOR = /^m(\d+)\.(\d+)$/;
const OFFSET_CURSOR = /^c(\d+)$/;

/** The most a find hit's line of context holds. */
const CONTEXT = 400;
/** A character lowercased for matching: a final sigma is a sigma, as the whole word lowercased elsewhere may write it. */
const lowerOf = (ch: string): string => ch.toLowerCase().replace(/\u03C2/g, '\u03C3');
/**
 * Where a lowercase needle is in text, ignoring case, as an index into the text itself: lowercasing can change a
 * character's length ('İ' becomes two), so an index into the lowercased text can point elsewhere. -1 when absent.
 */
function matchAt(text: string, needle: string): number {
  let lower = '';
  const origin: number[] = []; // for each unit of the lowercased text, where its character starts in the text
  let i = 0;
  for (const ch of text) {
    const l = lowerOf(ch);
    for (let k = 0; k < l.length; k++) origin.push(i);
    lower += l;
    i += ch.length;
  }
  const at = lower.indexOf(needle);
  return at < 0 ? -1 : origin[at]!;
}
/** Where to cut text at most `room` characters in, never between a surrogate pair. */
function cutAt(text: string, from: number, room: number): number {
  let end = Math.min(text.length, from + room);
  if (end < text.length && end > from && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
  return end;
}
/**
 * A reply reaches the prompt as JSON, where a control character takes six characters and a quote two, so the cap
 * counts text as JSON writes it. Where to cut text from `from` so it takes at most `room` characters as JSON, never
 * between a surrogate pair.
 */
function fitAt(text: string, from: number, room: number): number {
  let used = 0;
  let k = from;
  while (k < text.length) {
    const c = text.charCodeAt(k);
    const pair = c >= 0xd800 && c <= 0xdbff && k + 1 < text.length && text.charCodeAt(k + 1) >= 0xdc00 && text.charCodeAt(k + 1) <= 0xdfff;
    const size = pair ? 2 : c === 0x22 || c === 0x5c || c === 0x08 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d ? 2 : c < 0x20 || (c >= 0xd800 && c <= 0xdfff) ? 6 : 1;
    if (used + size > room) break;
    used += size;
    k += pair ? 2 : 1;
  }
  return k;
}
/** A cursor's offset is one this slicer could have issued: inside the text, and never between a surrogate pair. */
const between = (text: string, at: number): boolean => at > 0 && /[\uDC00-\uDFFF]/.test(text[at] ?? '') && /[\uD800-\uDBFF]/.test(text[at - 1]!);
/** What a slice's reply takes besides its text and messages, at the longest its covers and next can be. */
const envelope = (handle: string): number => JSON.stringify({ handle, covers: 'x'.repeat(160), text: '', next: `m${'9'.repeat(10)}.${'9'.repeat(10)}`, messages: [] }).length;
// A role or tool name is a word; one past 200 characters is clipped, so no message's entry can fill a slice alone.
const entryOf = (at: string, m: Message, start: number, end: number): NonNullable<Slice['messages']>[number] =>
  ({ at, role: (m.role || 'unknown').slice(0, 200), outside: m.outside, ...(m.tool !== undefined ? { tool: m.tool.slice(0, 200) } : {}), start, end });

/** The slicer over a hub's root: its record at `<root>/ledger.db`, its evidence store and its wiki, read only. */
export async function openSlicer(root: string): Promise<Slicer> {
  const evidence = await openEvidenceStore({ root: join(root, 'evidence'), readOnly: true });
  const record: RecordReader = openRecordReader({ path: join(root, 'ledger.db'), evidence });

  async function transcript(handle: string, session: string): Promise<Message[]> {
    const messages = await record.transcript(session);
    if (!messages) throw new NotFound(`${handle} names no session a transcript.archived event links`);
    return messages;
  }

  /** A slice of a session: whole messages while they fit, then as much of the next as fits. */
  async function sessionSlice(handle: string, session: string, cursor: string | undefined): Promise<Slice> {
    const messages = await transcript(handle, session);
    const at = cursor === undefined ? [0, 0] : SESSION_CURSOR.exec(cursor)?.slice(1).map(Number);
    if (!at || (cursor !== undefined && (at[0]! >= messages.length || at[1]! >= messages[at[0]!]!.text.length || between(messages[at[0]!]!.text, at[1]!)))) throw new NotFound(`${handle}: no slice at ${cursor}`);
    let [i, offset] = at as [number, number];
    let text = '';
    const listed: NonNullable<Slice['messages']> = [];
    // The whole reply reaches the prompt as JSON, so the cap holds its text and its message list as JSON writes them.
    let used = envelope(handle);
    const first = i;
    const from = offset;
    for (; i < messages.length; i++, offset = 0) {
      const m = messages[i]!;
      const at = `${handle}#${m.id}`;
      // A continuation from a later message's start carries the line break the slice before it ended short of.
      const sep = text || (i === first && i > 0 && offset === 0) ? '\n' : '';
      const start = text.length + sep.length;
      // Its entry, with an end at least as long as the real one's, and the line break as JSON writes it.
      const room = CAP - used - JSON.stringify(entryOf(at, m, start, start + CAP)).length - 1 - 2 * sep.length;
      const end = room > 0 ? fitAt(m.text, offset, room) : offset;
      if (end <= offset) {
        // A message whose entry alone leaves no room would give a slice that never moves on.
        if (!listed.length) throw new NotFound(`${handle}: message ${i + 1}'s handle alone passes the cap`);
        break;
      }
      text += sep;
      const entry = entryOf(at, m, start, start + end - offset);
      listed.push(entry);
      used += JSON.stringify(entry).length + 1 + 2 * sep.length + JSON.stringify(m.text.slice(offset, end)).length - 2;
      text += m.text.slice(offset, end);
      if (end < m.text.length) { offset = end; break; }
    }
    const done = i >= messages.length;
    // Cut inside a message it lists, or at the end of the last one it lists.
    const cutInside = !done && offset > 0;
    return {
      handle,
      covers: messages.length ? `messages ${first + 1} to ${first + listed.length} of ${messages.length}${from > 0 ? `, from character ${from + 1} of message ${first + 1}` : ''}${cutInside ? `, up to character ${offset} of message ${i + 1}` : ''}` : 'an empty transcript',
      text, ...(done ? {} : { next: `m${i}.${offset}` }), messages: listed,
    };
  }

  /** A slice of one text: from the cursor's offset, up to the cap. */
  function textSlice(handle: string, whole: string, cursor: string | undefined, entry?: Message): Slice {
    const from = cursor === undefined ? 0 : Number(OFFSET_CURSOR.exec(cursor)?.[1] ?? NaN);
    if (!Number.isInteger(from) || from < 0 || (from > 0 && from >= whole.length) || between(whole, from)) throw new NotFound(`${handle}: no slice at ${cursor}`);
    // The reply reaches the prompt as JSON, a message's entry with it, so the cap holds them all as JSON writes them.
    const room = CAP - envelope(handle) - (entry ? JSON.stringify(entryOf(handle, entry, 0, CAP)).length : 0);
    const end = room > 0 ? fitAt(whole, from, room) : from;
    if (end <= from && from < whole.length) throw new NotFound(`${handle}: the handle alone passes the cap`);
    const text = whole.slice(from, end);
    return {
      handle, covers: `characters ${from + 1} to ${end} of ${whole.length}`, text,
      ...(end < whole.length ? { next: `c${end}` } : {}),
      ...(entry ? { messages: [entryOf(handle, entry, 0, text.length)] } : {}),
    };
  }

  /** A claim on the wiki's pages, by its handle: its text as its line holds it. */
  function claim(handle: string): string | undefined {
    const m = WIKI.exec(handle);
    const file = m && join(root, 'wiki', `${m[1]}.md`);
    if (!m || !file || !existsSync(file)) return undefined;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const parsed = parseClaimLine(line);
      if (parsed && parsed.record.id === m[2]) return parsed.text;
    }
    return undefined;
  }

  async function whole(handle: string): Promise<{ text: string; role?: string; tool?: string; outside: boolean } | undefined> {
    const msg = MESSAGE.exec(handle);
    if (msg) {
      const m = (await record.transcript(msg[1]!))?.find((x) => x.id === msg[2]);
      return m && { text: m.text, ...(m.role ? { role: m.role } : {}), ...(m.tool !== undefined ? { tool: m.tool } : {}), outside: m.outside };
    }
    if (SESSION.test(handle)) return undefined;
    const wiki = claim(handle);
    if (wiki !== undefined) return { text: wiki, outside: false };
    return (await record.resolve(handle)) ?? undefined;
  }

  const archived = async (): Promise<string[]> => (await record.archived()).map((id) => `session:${id}`);
  return {
    async read(handle, cursor) {
      const session = SESSION.exec(handle);
      if (session) return sessionSlice(handle, session[1]!, cursor);
      const msg = MESSAGE.exec(handle);
      if (msg) {
        const m = (await transcript(handle, msg[1]!)).find((x) => x.id === msg[2]);
        if (!m) throw new NotFound(`${handle} names no message of its session's archived transcript`);
        return textSlice(handle, m.text, cursor, m);
      }
      const found = await whole(handle);
      if (!found) throw new NotFound(`${handle} names nothing the record can read`);
      return textSlice(handle, found.text, cursor);
    },
    async find(query, cursor, sessions) {
      // Lowercased a character at a time, as matchAt reads the text, so 'ΟΔΟΣ', 'οδος' and 'οδοσ' find each other.
      const needle = [...query].map(lowerOf).join('');
      if (!needle.trim()) throw new NotFound('deep find needs words to look for');
      const from = cursor === undefined ? 0 : Number(/^h(\d+)$/.exec(cursor)?.[1] ?? NaN);
      if (!Number.isInteger(from)) throw new NotFound(`deep find ${query}: no slice at ${cursor}`);
      // The hit test and the context's place read the text the same way, character by character.
      const holds = (text: string): boolean => matchAt(text, needle) >= 0;
      const hits: Found['hits'] = [];
      const context = (text: string): string => {
        // At most CONTEXT characters, however long the query, so every hit fits within the cap.
        const at = Math.max(0, matchAt(text, needle));
        // Its ends move out of a surrogate pair, so the context is whole characters.
        const start = Math.max(0, at - 80);
        const end = Math.min(text.length, at + needle.length + 80);
        const line = text.slice(between(text, start) ? start - 1 : start, between(text, end) ? end + 1 : end).replace(/\s+/g, ' ').trim();
        return line.slice(0, cutAt(line, 0, CONTEXT));
      };
      for (const handle of sessions ?? (await archived())) {
        const id = SESSION.exec(handle)?.[1];
        const t = id ? await record.transcript(id) : undefined;
        for (const m of t ?? []) if (holds(m.text)) hits.push({ handle: `${handle}#${m.id}`, context: context(m.text) });
      }
      if (!sessions) {
        for (const handle of await record.findable()) {
          const text = (await record.resolve(handle))?.text;
          // Bytes that are not UTF-8 text decode with U+FFFD or hold NUL: not text to show.
          if (text && !/[\u0000\uFFFD]/.test(text) && holds(text)) hits.push({ handle, context: context(text) });
        }
        for (const page of existsSync(join(root, 'wiki')) ? pagesUnder(join(root, 'wiki'), '') : []) {
          for (const line of readFileSync(join(root, 'wiki', `${page}.md`), 'utf8').split('\n')) {
            const parsed = parseClaimLine(line);
            if (parsed && typeof parsed.record.id === 'string' && holds(parsed.text)) hits.push({ handle: `wiki:${page}#${parsed.record.id}`, context: context(parsed.text) });
          }
        }
      }
      if (from > 0 && from >= hits.length) throw new NotFound(`deep find ${query}: no slice at ${cursor}`);
      // The reply reaches the prompt as JSON, so the cap holds the hits as JSON writes them.
      const out: Found['hits'] = [];
      let used = JSON.stringify({ hits: [], next: `h${'9'.repeat(10)}` }).length;
      let i = from;
      for (; i < hits.length; i++) {
        const size = JSON.stringify(hits[i]).length + 1;
        if (used + size > CAP) {
          if (!out.length) throw new NotFound(`deep find ${query}: ${hits[i]!.handle}'s hit alone passes the cap`);
          break;
        }
        out.push(hits[i]!);
        used += size;
      }
      return { hits: out, ...(i < hits.length ? { next: `h${i}` } : {}) };
    },
    archived,
    whole,
    close: () => record.close(),
  };
}

/** The wiki's pages under a folder, by name. */
function pagesUnder(dir: string, prefix: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? pagesUnder(join(dir, e.name), `${prefix}${e.name}/`) : e.name.endsWith('.md') ? [`${prefix}${e.name.slice(0, -3)}`] : []);
}
