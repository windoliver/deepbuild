import { FIELD_TRIGGERS, fieldRanges, type Range } from './fields.js';
import { loadRules, type Rule } from './patterns.js';

export interface Run { env?: Readonly<Record<string, string>>; held?: readonly string[] }

const MASK = '[REDACTED]';
const SECRET_NAME = /TOKEN|KEY|SECRET|PASSWORD|AUTH/i;
// Multi-line patterns, such as a private key block, read this far past their keyword's line.
const MULTILINE_WINDOW = 65_536;
const FOLD = Uint8Array.from({ length: 256 }, (_, c) => (c >= 65 && c <= 90 ? c | 32 : c));

/** One string to find: `match` returns where a match starting at `at` ends, or -1. A keyword names its rules, or starts a field check. */
interface Needle { match(text: Buffer, at: number, latin: string): number; rules?: Rule[]; field?: true }

/** Files a needle under its first three bytes with A-Z folded, and marks the bitmap so most positions cost one lookup. */
function add(bits: Uint8Array, byKey: Map<number, Needle[]>, head: Uint8Array, needle: Needle): void {
  const key = FOLD[head[0]!]! << 16 | FOLD[head[1]!]! << 8 | FOLD[head[2]!]!;
  const at = slot(key);
  bits[at >>> 3]! |= 1 << (at & 7);
  const list = byKey.get(key);
  if (list) list.push(needle);
  else byKey.set(key, [needle]);
}
/** A key's place in the bitmap: one bit of 2^20, so a table is 128 KB. */
const slot = (key: number) => Math.imul(key, 0x9e3779b1) >>> 12;
const marked = (bits: Uint8Array, key: number) => { const at = slot(key); return (bits[at >>> 3]! & (1 << (at & 7))) !== 0; };

const rules = loadRules();
const keywordBits = new Uint8Array(1 << 17);
const keywords = new Map<number, Needle[]>();
const folded = (bytes: Buffer) => (text: Buffer, at: number) => {
  for (let j = 0; j < bytes.length; j++) if (FOLD[text[at + j]!] !== bytes[j]) return -1;
  return at + bytes.length;
};
for (const keyword of new Set(rules.flatMap((rule) => rule.keywords))) {
  const bytes = Buffer.from(keyword.toLowerCase(), 'latin1');
  const needle: Needle = { match: folded(bytes), rules: rules.filter((rule) => rule.keywords.includes(keyword)) };
  if (bytes.length >= 3) add(keywordBits, keywords, bytes, needle);
  // A two-byte keyword is found by each three bytes it can start.
  else for (let next = 0; next < 256; next++) if (FOLD[next] === next) add(keywordBits, keywords, Buffer.from([...bytes, next]), needle);
}
// Field names are found in the same pass: each trigger is three bytes or more.
for (const word of FIELD_TRIGGERS) { const bytes = Buffer.from(word, 'latin1'); add(keywordBits, keywords, bytes, { match: folded(bytes), field: true }); }

/** The values a run's output is scrubbed of: what the hub holds, and the env values that look secret. */
export function scrubList(run: Run | undefined): string[] {
  const values = [...(run?.held ?? [])];
  for (const [name, value] of Object.entries(run?.env ?? {})) {
    const longWord = /^\S{16,}$/.test(value) && !value.split(':').every((part) => part.includes('/'));
    if (value && (SECRET_NAME.test(name) || longWord || !scrub(Buffer.from(value), []).equals(Buffer.from(value)))) values.push(value);
  }
  return values.filter(Boolean);
}

interface Tables { bits: Uint8Array; byValue: Map<number, Needle[]>; short: Buffer[] }
const NO_VALUES: Tables = { bits: keywordBits, byValue: new Map(), short: [] };
// The tables for the last few value lists: the hub scrubs every hook by the same values, and building them copies the bitmap.
const cached = new Map<string, Tables>();
const CACHED = 4;

/** The search tables for a list of values: the keyword bitmap with each value's forms added. */
function tablesFor(values: readonly string[]): Tables {
  if (!values.length) return NO_VALUES;
  const key = JSON.stringify(values);
  const found = cached.get(key);
  if (found) return found;
  const tables: Tables = { bits: keywordBits.slice(), byValue: new Map(), short: [] };
  for (const value of values) {
    for (const form of forms(Buffer.from(value, 'utf8'))) {
      if (form.length >= 3) add(tables.bits, tables.byValue, form, { match: (t, at) => (t.subarray(at, at + form.length).equals(form) ? at + form.length : -1) });
      else tables.short.push(form);
    }
    const url = urlForm(Buffer.from(value, 'utf8'));
    if (url) add(tables.bits, tables.byValue, Buffer.from(url.head, 'latin1'), { match: (_, at, latin) => { url.regex.lastIndex = at; return url.regex.test(latin) ? url.regex.lastIndex : -1; } });
  }
  if (cached.size >= CACHED) cached.delete(cached.keys().next().value!);
  cached.set(key, tables);
  return tables;
}

/** Scrubs bytes by value, in every printed form, and then, unless `patterns` is false, by pattern. */
export function scrub(text: Buffer, values: readonly string[], patterns = true): Buffer {
  const { latin, masks, fields, matches } = masksOf(text, values, patterns);
  let out = '';
  let at = 0;
  for (const [from, to, replacement = MASK] of merge([...masks, ...fields, ...matches])) { out += latin.slice(at, from) + replacement; at = to; }
  return Buffer.from(out + latin.slice(at), 'latin1');
}

/**
 * A complete-line prefix whose masks do not cross the cut. Lookahead keeps multi-line rules and held values whole;
 * field masks can extend beyond that window, so an unfinished one keeps its opening line until more text arrives.
 * `end` is a byte offset in the UTF-8 input. Zero asks the caller for more complete lines, never an unsafe cut.
 */
export function scrubPrefix(text: Buffer, values: readonly string[], target: number, final: boolean | 'growing'): { end: number; bytes: Buffer; continuable: boolean; matches: { at: number; match: string; field: boolean }[] } {
  const lookahead = Math.max(MULTILINE_WINDOW, ...values.map((v) => Buffer.byteLength(v) * 3));
  const scanned = masksOf(text, values, true);
  let safe = final ? growingEnd(text, values, scanned) : Math.max(0, text.length - lookahead);
  for (const at of scanned.unfinished) safe = Math.min(safe, at ? text.lastIndexOf(10, at - 1) + 1 : 0);
  const ceiling = final === true ? text.length : safe;
  if (!ceiling) return { end: 0, bytes: Buffer.alloc(0), continuable: false, matches: [] };
  let end = text.lastIndexOf(10, Math.min(target, ceiling) - 1) + 1;
  // A single long line is indivisible. It is eligible only when its complete line and lookahead are present.
  if (!end) {
    const newline = text.indexOf(10);
    if (newline >= 0 && newline < ceiling) end = newline + 1;
    else if (final === true) end = text.length;
    else return { end: 0, bytes: Buffer.alloc(0), continuable: false, matches: [] };
  }
  const { latin, masks, fields, matches } = scanned;
  const found = matched(text, fields, matches);
  const ranges = merge([...masks, ...fields, ...matches]);
  // Prefer moving backwards so ordinary parts stay bounded, but re-check earlier masks after every move.
  // When a mask reaches from the first line there is no safe earlier cut: advance past it and any masks that
  // cross that new boundary. Keeping the direction avoids cycling between two masks on one shared line.
  let forward = false;
  for (;;) {
    const crossing = end < text.length ? ranges.find(([from, to]) => from < end && to >= end) : undefined;
    if (!crossing) break;
    const [from, to] = crossing;
    const before = text.lastIndexOf(10, from - 1) + 1;
    if (!forward && before) { end = before; continue; }
    forward = true;
    const after = text.indexOf(10, to);
    if (after >= 0 && after < ceiling) end = after + 1;
    else if (final === true) end = text.length;
    else return { end: 0, bytes: Buffer.alloc(0), continuable: false, matches: [] };
  }
  let out = '', at = 0;
  for (const [from, to, replacement = MASK] of ranges) {
    if (from >= end) break;
    out += latin.slice(at, from) + replacement; at = to;
  }
  return { end, bytes: Buffer.from(out + latin.slice(at, end), 'latin1'), continuable: end <= safe, matches: found.flatMap(([match, field]) => {
    const at = match.byteOffset - text.byteOffset;
    return at + match.length <= end ? [{ at, match: match.toString('utf8'), field }] : [];
  }) };
}

/** The complete prefix of a live tail that cannot still be the opening of a multi-line scrub match. */
function growingEnd(bytes: Buffer, values: readonly string[], scanned: ReturnType<typeof masksOf>): number {
  let end = bytes.lastIndexOf(10) + 1;
  const lineOf = (at: number) => at ? bytes.lastIndexOf(10, at - 1) + 1 : 0;
  // Only raw held values can span literal newlines (their URL/base64 forms cannot). Keep a matching partial suffix
  // from its opening line; it is compared and scrubbed again with the rest at the next pass.
  for (const value of values) {
    const b = Buffer.from(value);
    const newline = b.indexOf(10);
    if (newline < 0) continue;
    const first = b.subarray(0, newline + 1);
    for (let at = bytes.indexOf(first); at >= 0; at = bytes.indexOf(first, at + 1)) {
      const tail = bytes.subarray(at);
      if (tail.length < b.length && tail.equals(b.subarray(0, tail.length))) end = Math.min(end, lineOf(at));
    }
  }
  const { latin, hits } = scanned;
  for (const [at, candidates] of hits) {
    const start = lineOf(at);
    if (start >= end || bytes.length - start >= MULTILINE_WINDOW) continue;
    const nl = latin.indexOf('\n', at);
    if (nl >= 0) {
      // Agent JSONL entries close every string on their own physical line. Escaped newlines are part of that line
      // and already scrubbed, not the start of a literal multi-line block continuing in the next message.
      try { JSON.parse(latin.slice(start, nl)); continue; } catch { /* a plain/multi-line source */ }
    }
    const window = latin.slice(start, start + MULTILINE_WINDOW);
    for (const rule of candidates) if (rule.multiline && ![...window.matchAll(rule.regex)].some((m) => m.index! <= at - start && m.index! + m[0].length > at - start)) {
      end = Math.min(end, start); break;
    }
  }
  return end;
}

/** Each pattern rule's match in `text`, in order and once, as printed, and whether a field rule's mask covers part of it too. */
export function patternMatches(text: Buffer): [match: Buffer, field: boolean][] {
  const { fields, matches } = masksOf(text, [], true);
  return matched(text, fields, matches);
}
function matched(text: Buffer, fields: Range[], matches: Range[]): [match: Buffer, field: boolean][] {
  // The field masks as disjoint ranges in order, so each match finds the first that may overlap it by halving.
  const covered = merge(fields);
  const found: [Buffer, boolean][] = [];
  let last: Range | undefined;
  for (const range of matches.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (last && range[0] === last[0] && range[1] === last[1]) continue;
    last = range;
    let [low, high] = [0, covered.length];
    while (low < high) { const mid = (low + high) >> 1; if (covered[mid]![1] <= range[0]) low = mid + 1; else high = mid; }
    found.push([text.subarray(range[0], range[1]), low < covered.length && covered[low]![0] < range[1]]);
  }
  return found;
}

/** The text as latin1, and the ranges its scrub masks: by held value, by field name and by pattern. */
function masksOf(text: Buffer, values: readonly string[], patterns: boolean): { latin: string; masks: Range[]; fields: Range[]; matches: Range[]; hits: [number, Rule[]][]; unfinished: number[] } {
  const latin = text.toString('latin1');
  const { bits, byValue, short } = tablesFor(values);
  const masks: Range[] = [];
  const hits: [number, Rule[]][] = [];
  const fields: number[] = [];
  let key = FOLD[text[0] ?? 0]! << 8 | FOLD[text[1] ?? 0]!;
  // One pass finds every candidate start, three bytes in, then checks it.
  for (let i = 2; i < text.length; i++) {
    key = (key << 8 | FOLD[text[i]!]!) & 0xffffff;
    if (!marked(bits, key)) continue;
    // Keywords only start the pattern pass.
    if (patterns) for (const needle of keywords.get(key) ?? []) if (needle.match(text, i - 2, latin) > 0) { if (needle.field) fields.push(i - 2); else hits.push([i - 2, needle.rules!]); }
    for (const needle of byValue.get(key) ?? []) { const end = needle.match(text, i - 2, latin); if (end > 0) masks.push([i - 2, end]); }
  }
  for (const form of short) for (let at = text.indexOf(form); at >= 0; at = text.indexOf(form, at + 1)) masks.push([at, at + form.length]);

  // Fields and patterns are found in the text as printed, so no mask can hide what another rule would find.
  const unfinished: number[] = [];
  return { latin, masks, fields: patterns ? fieldRanges(latin, fields, MASK, unfinished) : [], matches: patterns ? patternRanges(latin, hits) : [], hits, unfinished };
}

/** Raw, and base64 after 0, 1 or 2 leading bytes in both alphabets: only the characters the value alone decides. */
function forms(value: Buffer): Buffer[] {
  const out = new Set([value.toString('latin1')]);
  for (const lead of [0, 1, 2]) {
    const b64 = Buffer.concat([Buffer.alloc(lead), value]).toString('base64');
    const core = b64.slice(Math.ceil((8 * lead) / 6), Math.floor((8 * (lead + value.length)) / 6));
    if (core) out.add(core).add(core.replaceAll('+', '-').replaceAll('/', '_'));
  }
  return [...out].map((form) => Buffer.from(form, 'latin1'));
}

// How a URL encoder writes each byte: unreserved bytes as themselves, the rest as %XX with hex of either case.
const URL_BYTE = Array.from({ length: 256 }, (_, b) => {
  const c = String.fromCharCode(b);
  if (/[A-Za-z0-9\-_.~]/.test(c)) return { lower: c.toLowerCase(), source: c === '.' ? '\\.' : c };
  const hex = b.toString(16).padStart(2, '0');
  return { lower: `%${hex}`, source: `%${hex.replace(/[a-f]/g, (h) => `[${h}${h.toUpperCase()}]`)}` };
});

/** The URL-encoded form as a sticky pattern; undefined when that is the raw form or is too short to key. */
function urlForm(value: Buffer): { head: string; regex: RegExp } | undefined {
  if (value.every((b) => URL_BYTE[b]!.lower.length === 1)) return undefined;
  const head = [...value.subarray(0, 3)].map((b) => URL_BYTE[b]!.lower).join('').slice(0, 3);
  if (head.length < 3) return undefined; // two bytes or fewer: the short raw form already covers it
  return { head, regex: new RegExp([...value].map((b) => URL_BYTE[b]!.source).join(''), 'y') };
}

/** The ranges in order with overlaps merged; each is replaced by the mask, or by its own replacement. */
function merge(ranges: Range[]): Range[] {
  // Wider ranges first at each start, and of equal ones the one with its own replacement.
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1] || Number(b[2] !== undefined) - Number(a[2] !== undefined));
  const merged: Range[] = [];
  for (const [from, to, replacement] of ranges) {
    const last = merged.at(-1);
    // A range that covers the others it overlaps keeps its own replacement, as a JSON-safe mask must.
    if (last && from <= last[1]) { if (to > last[1]) [last[1], last[2]] = [to, undefined]; }
    else merged.push([from, to, replacement]);
  }
  return merged;
}

/** Every match of a rule on the line its keyword was found on (or past it, for a multi-line rule). */
function patternRanges(text: string, hits: [number, Rule[]][]): Range[] {
  const windows = new Map<number, Set<Rule>>();
  for (const [at, found] of hits) {
    const start = text.lastIndexOf('\n', at - 1) + 1;
    const set = windows.get(start) ?? new Set();
    for (const rule of found) set.add(rule);
    windows.set(start, set);
  }
  const ranges: Range[] = [];
  for (const [start, found] of windows) {
    const lineEnd = text.indexOf('\n', start);
    for (const rule of found) {
      const end = rule.multiline ? Math.min(text.length, start + MULTILINE_WINDOW) : lineEnd < 0 ? text.length : lineEnd;
      for (const m of text.slice(start, end).matchAll(rule.regex)) {
        const group = rule.group === 'first' ? m.findIndex((g, n) => n > 0 && g) : rule.group;
        const [from, to] = m.indices![group > 0 ? group : 0]!;
        // A secret matched with its quotes, as `("[a-z0-9]{8,20}")` is, keeps them, so JSON stays JSON.
        const quoted = to - from > 1 && text[start + from] === '"' && text[start + to - 1] === '"' ? 1 : 0;
        ranges.push([start + from + quoted, start + to - quoted]);
      }
    }
  }
  return ranges;
}
