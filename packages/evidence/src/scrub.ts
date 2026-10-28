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
  bits[slot(key)] = 1;
  const list = byKey.get(key);
  if (list) list.push(needle);
  else byKey.set(key, [needle]);
}
const slot = (key: number) => Math.imul(key, 0x9e3779b1) >>> 12;

const rules = loadRules();
const keywordBits = new Uint8Array(1 << 20);
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
// The tables for the last few value lists: the hub scrubs every hook by the same values, and building them copies a 1 MB bitmap.
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

/** Each pattern rule's match in `text`, in order and once, as printed, and whether a field rule's mask covers part of it too. */
export function patternMatches(text: Buffer): [match: Buffer, field: boolean][] {
  const { fields, matches } = masksOf(text, [], true);
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
function masksOf(text: Buffer, values: readonly string[], patterns: boolean): { latin: string; masks: Range[]; fields: Range[]; matches: Range[] } {
  const latin = text.toString('latin1');
  const { bits, byValue, short } = tablesFor(values);
  const masks: Range[] = [];
  const hits: [number, Rule[]][] = [];
  const fields: number[] = [];
  let key = FOLD[text[0] ?? 0]! << 8 | FOLD[text[1] ?? 0]!;
  // One pass finds every candidate start, three bytes in, then checks it.
  for (let i = 2; i < text.length; i++) {
    key = (key << 8 | FOLD[text[i]!]!) & 0xffffff;
    if (!bits[slot(key)]) continue;
    // Keywords only start the pattern pass.
    if (patterns) for (const needle of keywords.get(key) ?? []) if (needle.match(text, i - 2, latin) > 0) { if (needle.field) fields.push(i - 2); else hits.push([i - 2, needle.rules!]); }
    for (const needle of byValue.get(key) ?? []) { const end = needle.match(text, i - 2, latin); if (end > 0) masks.push([i - 2, end]); }
  }
  for (const form of short) for (let at = text.indexOf(form); at >= 0; at = text.indexOf(form, at + 1)) masks.push([at, at + form.length]);

  // Fields and patterns are found in the text as printed, so no mask can hide what another rule would find.
  return { latin, masks, fields: patterns ? fieldRanges(latin, fields, MASK) : [], matches: patterns ? patternRanges(latin, hits) : [] };
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
