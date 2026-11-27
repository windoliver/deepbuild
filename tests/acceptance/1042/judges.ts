// The judges of the #1042 acceptance tests (README: Criteria to tests): each decides one clause of a criterion from
// what a test read (a request log, the player's reading entries, what the page shows, an export's reply, a receipt, a
// bundle's font, two renders) and answers with the failures, each naming what its criterion names. They are plain
// functions over values: no process, no browser, no test runner, so each was tried against planted inputs before any
// program existed. Every expected value comes from the issue's text and the design.

import { inflateSync } from 'node:zlib';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown, n = 300): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);

/** Flicks in a second, and the step of every piece here: a 60th of a second, 11,760,000 flicks. */
export const FLICKS = 705_600_000;
export const STEP = FLICKS / 60;

// ---------------------------------------------------------------------------------------------------
// AC1: the request log. "the player requests only its own files and the piece's declared public sources, with no
// cookie or credential"

/** One request or connection a page opened, as the browser's own record gives it (`by: 'browser'`: a request, the
 * headers a request went out with (`wire`), a socket) or as the page-side log does (`by: 'page'`: each way a script
 * opens a connection). `host` is the wire record's authority; `servers` a peer connection's ICE servers. */
export interface Reached { by: 'browser' | 'page'; kind: string; url: string; method?: string; host?: string; headers: Record<string, string>; servers?: string[] }
/** One request as a stand-in server received it: when (ms), its method, its target as sent (path and query), its
 * headers by lower-case name, and the status it was answered with (0: the caller left before an answer). */
export interface Arrived { at: number; method: string; url: string; headers: Record<string, string>; status: number }
/** What a piece's page may ask for: the bundle's own files, by their paths under the bundle's folder (`base`, a URL
 * that ends in `/`), and the piece's declared public sources, each by its whole URL. */
export interface Allowed { base: string; files: readonly string[]; sources: readonly string[] }

/** Header names that carry a cookie or a credential: the three HTTP has for them, and any name that says key, token,
 * secret, credential, password or session (no header a browser adds to a plain GET does). */
const CREDENTIAL = /^(cookie|authorization|proxy-authorization)$|key|token|secret|credential|passw|session/;
const credentials = (headers: Record<string, string>): string[] => Object.keys(headers).filter((h) => CREDENTIAL.test(h.toLowerCase()));
/** The path of the site's icon, which a browser asks a page's host for by itself. */
const ICON = '/favicon.ico';
/** The browser's own loads of a page, of its scripts and of its site's icon carry the origin's cookies by the
 * browser's rule, which no page can turn off; every other request is one the player's script made. `path` is the
 * request's path on its host. */
const browsersOwnLoad = (headers: Record<string, string>, path: string): boolean => {
  const dest = headers['sec-fetch-dest'] ?? '';
  return dest === 'document' || dest === 'script' || (path === ICON && dest !== 'empty');
};
const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return ''; } };
const pathOf = (url: string): string => { try { return new URL(url, 'http://unnamed.invalid/').pathname; } catch { return ''; } };
const targetOf = (url: string): string => { const u = new URL(url); return `${u.pathname}${u.search}`; };

/** Where a URL the page asked for goes: one of the bundle's own files, a declared source, nowhere (a `data:`,
 * `blob:` or `about:` URL names no host), or anything else. The browser's own request for a site's icon counts as
 * the page's own, as #172's suite counts it. */
function placeOf(url: string, a: Allowed): 'own' | 'source' | 'nowhere' | 'other' {
  if (/^(data|blob|about):/i.test(url)) return 'nowhere';
  let u: URL;
  try { u = new URL(url, a.base); } catch { return 'other'; }
  u.hash = '';
  if (a.sources.includes(u.href)) return 'source';
  if (u.href === new URL(ICON, a.base).href) return 'own';
  if (!u.href.startsWith(a.base) || u.search !== '') return 'other';
  const rel = decodeURIComponent(u.href.slice(a.base.length));
  return rel === '' || a.files.includes(rel) ? 'own' : 'other';
}

/** The failures of "requests only its own files and the piece's declared public sources, with no cookie or
 * credential" over one session's logs: the browser's own record and the page-side log (`reached`), what reached the
 * bundle's server (`bundle`) and what reached the stand-in source (`source`). Each failure names the request. */
export function requestFailures(a: Allowed, reached: readonly Reached[], bundle: readonly Arrived[], source: readonly Arrived[]): string[] {
  const f: string[] = [];
  const own = hostOf(a.base);
  const sourceHosts = a.sources.map(hostOf);
  const log = (r: Reached): string => (r.by === 'browser' ? "the browser's record" : 'the page-side log');
  for (const r of reached) {
    if (r.kind === 'RTCPeerConnection') {
      for (const s of r.servers ?? []) f.push(`the page set up a peer connection through ${s}, a host the piece doesn't declare (${log(r)})`);
      continue;
    }
    if (r.kind === 'wire') {
      // The headers a request went out with, by the host it went to.
      const host = r.host ?? hostOf(r.url);
      for (const h of credentials(r.headers)) {
        if (h.toLowerCase() === 'cookie' && host === own && !sourceHosts.includes(host) && browsersOwnLoad(r.headers, r.headers[':path'] ?? pathOf(r.url))) continue;
        f.push(`a request to ${r.url || host} went out with a ${h} header (${log(r)})`);
      }
      continue;
    }
    if (/^(websocket|webtransport)$/i.test(r.kind)) { f.push(`the page opened a ${r.kind} to ${r.url}; the piece declares no relay (${log(r)})`); continue; }
    const place = placeOf(r.url, a);
    if (place === 'other') f.push(`the page asked for ${r.url}, which is neither one of the bundle's own files nor a declared public source (${r.kind}, ${log(r)})`);
    if (r.by === 'browser' && place !== 'nowhere' && r.method !== undefined && r.method !== 'GET' && !(place === 'source' && r.method === 'OPTIONS')) f.push(`the page sent a ${r.method} to ${r.url}; the player only reads (${log(r)})`);
  }
  for (const q of bundle) {
    const url = new URL(q.url, a.base).href;
    if (placeOf(url, a) !== 'own') f.push(`the bundle's server was asked for ${q.url}, which is not one of the bundle's own files`);
    if (q.method !== 'GET') f.push(`the bundle's server was sent a ${q.method} for ${q.url}; the player only reads`);
    for (const h of credentials(q.headers)) {
      if (h === 'cookie' && browsersOwnLoad(q.headers, pathOf(q.url))) continue;
      f.push(`the player's request for its own file ${q.url} carries a ${h} header`);
    }
  }
  const declared = a.sources.map(targetOf);
  for (const q of source) {
    if (!declared.includes(q.url)) f.push(`the source's host was asked for ${q.url}, not the declared ${declared.join(' or ')}`);
    if (q.method !== 'GET' && q.method !== 'OPTIONS') f.push(`the source was sent a ${q.method} for ${q.url}; the player only reads`);
    for (const h of credentials(q.headers)) f.push(`the request to the source for ${q.url} carries a ${h} header`);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// AC1: "each value a source gives arrives as one input entry at the first step not yet run and shows its source and
// age"

/** A reading entry of the player's input track, as probe()'s `readings` lists it (README: probe()). */
export interface Entry { t: number; reading: string; value: JsonValue; as_of: number }
/** probe()'s `readings`, read: the entries, or why they can't be read. */
export function entriesOf(probe: JsonValue | undefined): { entries: Entry[]; why: string } {
  const list = isObject(probe) ? probe['readings'] : undefined;
  if (!Array.isArray(list)) return { entries: [], why: `probe().readings is ${show(list)}, not the list of the reading entries on the player's input track` };
  const entries: Entry[] = [];
  for (const [i, v] of list.entries()) {
    if (!isObject(v) || typeof v['t'] !== 'number' || !Number.isSafeInteger(v['t']) || typeof v['reading'] !== 'string' || typeof v['as_of'] !== 'number' || !Number.isSafeInteger(v['as_of'])) {
      return { entries: [], why: `probe().readings[${i}] is ${show(v)}, not a reading entry {t: flicks, reading, value, as_of: microseconds}` };
    }
    entries.push({ t: v['t'], reading: v['reading'], value: v['value'] ?? null, as_of: v['as_of'] });
  }
  return { entries, why: '' };
}
/** A value as the page shows it (README: What the page shows): the text of the element marked for its bound value,
 * the `<time datetime>` elements it holds, and whether it shows. */
export interface Shown { text: string; times: { datetime: string; text: string }[]; visible: boolean }
/** One value the stand-in source gave and what the test read around it: when the source was asked (ms), when the
 * test saw the page show it (ms), the steps the player had run just before the value was given and just after it was
 * shown (the same step when the player was held paused), and the player's reading entries before and after. */
export interface Delivery { value: number; askedAt: number; seenAt: number; stepBefore: number; stepAfter: number; paused: boolean; before: readonly Entry[]; after: readonly Entry[]; shown: Shown | null }

const keyOf = (e: Entry): string => `${e.t}|${e.reading}|${JSON.stringify(e.value)}|${e.as_of}`;
/** The entries of `after` that `before` doesn't hold, and those of `before` that `after` lost. */
function gained(before: readonly Entry[], after: readonly Entry[]): { added: Entry[]; lost: Entry[] } {
  const left = new Map<string, number>();
  for (const e of before) left.set(keyOf(e), (left.get(keyOf(e)) ?? 0) + 1);
  const added: Entry[] = [];
  for (const e of after) { const n = left.get(keyOf(e)) ?? 0; if (n > 0) left.set(keyOf(e), n - 1); else added.push(e); }
  return { added, lost: before.filter((e) => { const n = left.get(keyOf(e)) ?? 0; if (n > 0) { left.set(keyOf(e), n - 1); return true; } return false; }) };
}

/** The failures of one value the source gave: it is one input entry of the declared reading, stamped at the first
 * step not yet run when it arrived, with an as-of time between the source being asked and the page showing it; and
 * the page shows the value with its source (`host`, the source's host and port) and its age (a `<time>` at its as-of
 * time, with words). Each failure names the value. */
export function deliveryFailures(d: Delivery, o: { reading: string; host: string }): string[] {
  const what = `the value ${d.value} the source gave`;
  const f: string[] = [];
  const { added, lost } = gained(d.before, d.after);
  if (lost.length) f.push(`${what}: ${lost.length} earlier reading ${lost.length === 1 ? 'entry is' : 'entries are'} gone from the input track (${show(lost)})`);
  if (added.length !== 1) f.push(`${what} arrived as ${added.length} input entries, not one: ${show(added)}`);
  const e = added[0];
  if (e) {
    if (e.reading !== `reading:${o.reading}`) f.push(`${what}: its entry names ${show(e.reading)}, not reading:${o.reading}`);
    if (e.value !== d.value) f.push(`${what}: its entry holds ${show(e.value)}`);
    const step = e.t / STEP;
    const first = d.paused ? `step ${d.stepBefore}, the first not yet run while the player was held paused there` : `a step from ${d.stepBefore} to ${d.stepAfter}, the first not yet run while it arrived`;
    if (!Number.isInteger(step)) f.push(`${what}: its entry is stamped ${e.t} flicks, which is no step's start (a step is ${STEP} flicks)`);
    else if (step < d.stepBefore || step > d.stepAfter) f.push(`${what}: its entry is stamped at step ${step}, not at ${first}`);
    if (d.paused && d.stepBefore !== d.stepAfter) f.push(`${what}: the player held paused ran from step ${d.stepBefore} to ${d.stepAfter}`);
    // A source's own clock reads whole seconds, and a player may stamp the moment it sent its request: an as-of time
    // is never more than a second before the second the source was asked in, and never after the page showed it.
    const asOfMs = e.as_of / 1000;
    if (asOfMs < Math.floor(d.askedAt / 1000) * 1000 - 1000 || asOfMs > d.seenAt) f.push(`${what}: its entry's as-of time ${new Date(asOfMs).toISOString()} is not between the source being asked (${new Date(d.askedAt).toISOString()}) and the page showing it (${new Date(d.seenAt).toISOString()})`);
  }
  if (!d.shown) { f.push(`${what}: the page doesn't show it`); return f; }
  if (!d.shown.visible) f.push(`${what}: the element that holds it doesn't show`);
  if (!d.shown.text.includes(String(d.value))) f.push(`${what}: the page shows "${d.shown.text.trim().slice(0, 120)}", which doesn't hold ${d.value}`);
  if (!d.shown.text.includes(o.host)) f.push(`${what}: the page shows it without its source ${o.host}: "${d.shown.text.trim().slice(0, 120)}"`);
  const time = d.shown.times.find((t) => e !== undefined && Math.abs(Date.parse(t.datetime) - e.as_of / 1000) < 1000);
  if (!time) f.push(`${what}: the page shows it with no <time> at its as-of time${e ? ` ${new Date(e.as_of / 1000).toISOString()}` : ''}, so no age: ${show(d.shown.times)}`);
  else if (!time.text) f.push(`${what}: its age (the <time> at ${time.datetime}) has no words to read`);
  return f;
}

/** The failures of "shows its … age" over time: `fresh` is the value as the page showed it when it arrived, `aged`
 * the same value `seconds` of play later with no newer value given. The age's words must have changed, the value and
 * its as-of time not. */
export function ageFailures(fresh: Shown | null, aged: Shown | null, value: number, seconds: number): string[] {
  const what = `the value ${value}, ${seconds} s after it arrived`;
  if (!fresh || !aged) return [`${what}: the page doesn't show it`];
  const f: string[] = [];
  if (!aged.text.includes(String(value))) f.push(`${what}: the page shows "${aged.text.trim().slice(0, 120)}", which doesn't hold it`);
  const was = fresh.times[0];
  const now = aged.times.find((t) => t.datetime === was?.datetime);
  if (!was || !now) f.push(`${what}: its as-of time changed though the source gave no newer value: ${show(fresh.times)} then ${show(aged.times)}`);
  else if (now.text === was.text) f.push(`${what}: the page still shows its age as "${now.text}", the words it showed when the value arrived, so it shows no age`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// AC1: "a source that answers only with a key is refused at export, naming it"

/** The code of the refusal of a declared source that needs a key (README: The refusal). */
export const SOURCE_KEY = 'web.source_key';
/** The failures of an export's reply as the refusal of the source `keyed` (its reading's ID), and of no other: the
 * export is refused, one refusal has the code and names the keyed source, and none names `open`, the source that
 * needs no key. */
export function keyedRefusalFailures(reply: JsonObject, keyed: string, open: string): string[] {
  if (reply['outcome'] !== 'refused') return [`the export of a piece whose source ${keyed} answers only with a key is ${show(reply['outcome'])}, not refused`];
  const list = Array.isArray(reply['refused']) ? reply['refused'].filter(isObject) : [];
  const forKey = list.filter((r) => r['code'] === SOURCE_KEY);
  const f: string[] = [];
  if (!forKey.some((r) => r['item'] === keyed)) f.push(`the refusal doesn't name the source ${keyed} as needing a key (a refused entry {item: "${keyed}", code: "${SOURCE_KEY}"}): ${show(reply['refused'], 600)}`);
  for (const r of forKey) if (r['item'] !== keyed) f.push(`the refusal names ${show(r['item'])} as needing a key; only ${keyed} does`);
  for (const r of list) if (r['item'] === open) f.push(`the refusal names the source ${open}, which answers with no key: ${show(r)}`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// AC2: "its receipt lists the fallback for that item"

/** Today's light, as a key and a receipt name the light that drew (Light: ray traced: `light: rays |
 * without_history`). */
export const TODAYS_LIGHT = 'without_history';
/** The failures of a web export's receipt as listing today's light as the fallback for `item`, the light whose
 * shadows the scene names rays for: one `stand_in` entry for the item on the web path, saying which light draws in
 * its place, with the answer's words; and no refusal of it. */
export function fallbackFailures(receipt: JsonObject, item: string): string[] {
  const f: string[] = [];
  const refused = Array.isArray(receipt['refused']) ? receipt['refused'].filter(isObject) : [];
  for (const r of refused) if (r['item'] === item) f.push(`the receipt refuses ${item}: ${show(r)}`);
  const list = receipt['stand_in'];
  if (!Array.isArray(list)) return [...f, `the receipt's stand_in is ${show(list)}, not a list`];
  const own = list.filter(isObject).filter((s) => s['item'] === item && s['path'] === 'web');
  if (own.length !== 1) return [...f, `the receipt lists ${own.length} fallbacks for ${item} on the web path, not one: its stand_in is ${show(list, 600)}`];
  const s = own[0]!;
  if (s['light'] !== TODAYS_LIGHT) f.push(`the receipt's entry for ${item} names the light ${show(s['light'])}, not ${TODAYS_LIGHT} (today's light)`);
  for (const k of ['entry', 'draws', 'receipt']) if (typeof s[k] !== 'string' || s[k].trim() === '') f.push(`the receipt's entry for ${item} has no ${k}: ${show(s)}`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// AC3: "bundles a subset of the CJK face under 200 KB", a subset that "keeps the font's licence and name" (Scope)

/** An OpenType font's name records by ID, read from its `name` table (the Unicode records in English where it has
 * them); or a sentence saying why the bytes can't be read as one. */
export function fontNames(font: Uint8Array): Map<number, string> | string {
  const b = Buffer.from(font.buffer, font.byteOffset, font.byteLength);
  if (b.length < 12) return `it is ${b.length} bytes`;
  const magic = b.toString('latin1', 0, 4);
  if (magic !== 'OTTO' && b.readUInt32BE(0) !== 0x00010000 && magic !== 'true') return `it starts ${show(magic)}, not as an OpenType font file does`;
  const tables = b.readUInt16BE(4);
  let name = -1;
  for (let i = 0; i < tables && 28 + 16 * i <= b.length; i++) if (b.toString('latin1', 12 + 16 * i, 16 + 16 * i) === 'name') name = b.readUInt32BE(20 + 16 * i);
  if (name < 0 || name + 6 > b.length) return 'it has no name table';
  const count = b.readUInt16BE(name + 2);
  const strings = name + b.readUInt16BE(name + 4);
  const out = new Map<number, string>();
  const rank = new Map<number, number>();
  for (let i = 0; i < count && name + 18 + 12 * i <= b.length; i++) {
    const r = name + 6 + 12 * i;
    const [platform, language, id, length, offset] = [0, 4, 6, 8, 10].map((o) => b.readUInt16BE(r + o)) as [number, number, number, number, number];
    if (strings + offset + length > b.length) continue;
    const raw = b.subarray(strings + offset, strings + offset + length);
    const unicode = platform === 3 || platform === 0;
    // A Unicode record is UTF-16, two bytes a unit: one of an odd length is no record.
    if (unicode && raw.length % 2 !== 0) continue;
    const text = unicode ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1');
    // English Unicode records first, then any Unicode record, then the rest.
    const order = unicode && (platform === 0 || language === 0x409) ? 0 : unicode ? 1 : 2;
    if (order < (rank.get(id) ?? 3)) { out.set(id, text); rank.set(id, order); }
  }
  return out;
}
/** The name records a subset keeps: its font's name (the family), and its licence (the copyright line, the licence
 * and where the licence is published). */
export const KEPT_NAMES: readonly { id: number; what: string }[] = [
  { id: 1, what: 'family name' }, { id: 0, what: 'copyright line' }, { id: 13, what: 'licence' }, { id: 14, what: 'licence address' },
];
/** The failures of a bundle's CJK font as a subset of the app's face under `limit` bytes that keeps the face's name
 * and licence. `subset` is the bundle's font file, `face` the app's whole face. */
export function subsetFailures(subset: Uint8Array, face: Uint8Array, limit: number): string[] {
  const f: string[] = [];
  if (subset.length >= limit) f.push(`the bundle's CJK font is ${subset.length.toLocaleString('en-US')} bytes, not under ${limit.toLocaleString('en-US')}${subset.length === face.length ? ' (the whole face)' : ''}`);
  const [own, whole] = [fontNames(subset), fontNames(face)];
  if (typeof whole === 'string') return [...f, `the app's CJK face can't be read: ${whole}`];
  if (typeof own === 'string') return [...f, `the bundle's CJK font can't be read as a font: ${own}`];
  for (const { id, what } of KEPT_NAMES) {
    const want = whole.get(id);
    if (want !== undefined && own.get(id) !== want) f.push(`the bundle's CJK font doesn't keep the face's ${what} (name record ${id}): it has ${show(own.get(id), 80)}`);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// AC3's wrong program (README: Planted programs): the app's CJK face with its character map moved by one glyph for
// the text's code points, so a bundle that holds it sets the text in other glyphs of the same face.

/** A font's `cmap` subtables that map Unicode (platform 0, or platform 3 with encoding 1 or 10) in format 4 or 12,
 * each once by where it starts in the file; or a sentence saying why the bytes can't be read as a font with one. */
function unicodeMaps(b: Buffer): { at: number; format: number }[] | string {
  if (b.length < 12) return `it is ${b.length} bytes`;
  let cmap = -1;
  for (let i = 0; i < b.readUInt16BE(4) && 28 + 16 * i <= b.length; i++) if (b.toString('latin1', 12 + 16 * i, 16 + 16 * i) === 'cmap') cmap = b.readUInt32BE(20 + 16 * i);
  if (cmap < 0 || cmap + 4 > b.length) return 'it has no cmap table';
  const maps = new Map<number, number>();
  for (let i = 0; i < b.readUInt16BE(cmap + 2) && cmap + 12 + 8 * i <= b.length; i++) {
    const r = cmap + 4 + 8 * i;
    const [platform, encoding, at] = [b.readUInt16BE(r), b.readUInt16BE(r + 2), cmap + b.readUInt32BE(r + 4)];
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) || at + 16 > b.length) continue;
    const format = b.readUInt16BE(at);
    if (format === 4 || format === 12) maps.set(at, format);
  }
  return maps.size ? [...maps].map(([at, format]) => ({ at, format })) : 'its cmap has no Unicode subtable of format 4 or 12';
}
/** Where a subtable holds `codePoint`: a format 4 segment's `idDelta` and the glyph it gives, or a format 12
 * group's `startGlyphID` and the glyph it gives; null when the subtable doesn't map it. */
function mapped(b: Buffer, m: { at: number; format: number }, codePoint: number): { field: number; glyph: number } | null {
  if (m.format === 12) {
    for (let k = 0; k < b.readUInt32BE(m.at + 12); k++) {
      const g = m.at + 16 + 12 * k;
      if (codePoint >= b.readUInt32BE(g) && codePoint <= b.readUInt32BE(g + 4)) return { field: g + 8, glyph: b.readUInt32BE(g + 8) + codePoint - b.readUInt32BE(g) };
    }
    return null;
  }
  if (codePoint > 0xffff) return null;
  const twice = b.readUInt16BE(m.at + 6);
  const [ends, starts, deltas, offsets] = [m.at + 14, m.at + 16 + twice, m.at + 16 + 2 * twice, m.at + 16 + 3 * twice];
  for (let k = 0; 2 * k < twice; k++) {
    if (codePoint > b.readUInt16BE(ends + 2 * k)) continue;
    const start = b.readUInt16BE(starts + 2 * k);
    if (codePoint < start) return null;
    const [delta, offset] = [b.readUInt16BE(deltas + 2 * k), b.readUInt16BE(offsets + 2 * k)];
    const listed = offset ? b.readUInt16BE(offsets + 2 * k + offset + 2 * (codePoint - start)) : codePoint;
    return offset && listed === 0 ? null : { field: deltas + 2 * k, glyph: (listed + delta) & 0xffff };
  }
  return null;
}
/** The glyph each Unicode subtable of `font` gives `codePoint` (0 where one doesn't map it), in the file's order; or
 * a sentence saying why the font can't be read. */
export function glyphsOf(font: Uint8Array, codePoint: number): number[] | string {
  const b = Buffer.from(font.buffer, font.byteOffset, font.byteLength);
  const maps = unicodeMaps(b);
  return typeof maps === 'string' ? maps : maps.map((m) => mapped(b, m, codePoint)?.glyph ?? 0);
}
/** A copy of `face` whose character map gives each of `codePoints` the glyph after its own: every format 4 segment
 * and every format 12 group that holds one is moved by one glyph, in place. The copy is the face's size and keeps
 * every table, name and glyph of it; only what the map names changes. A sentence when the face can't be read. */
export function shiftedFace(face: Uint8Array, codePoints: readonly number[]): Buffer | string {
  const b = Buffer.from(face);
  const maps = unicodeMaps(b);
  if (typeof maps === 'string') return maps;
  for (const m of maps) {
    const fields = new Set<number>();
    for (const c of codePoints) { const at = mapped(b, m, c); if (at) fields.add(at.field); }
    for (const field of fields) { if (m.format === 12) b.writeUInt32BE(b.readUInt32BE(field) + 1, field); else b.writeUInt16BE((b.readUInt16BE(field) + 1) & 0xffff, field); }
  }
  return b;
}
/** The failures of `wrong` as that copy of `face`: in every Unicode subtable, each of `codePoints` has a glyph in
 * the face and the glyph after it in the copy. */
export function shiftFailures(face: Uint8Array, wrong: Uint8Array, codePoints: readonly number[]): string[] {
  const f: string[] = [];
  for (const c of codePoints) {
    const name = `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
    const [was, now] = [glyphsOf(face, c), glyphsOf(wrong, c)];
    if (typeof was === 'string' || typeof now === 'string') return [`the font can't be read: ${typeof was === 'string' ? was : String(now)}`];
    if (was.includes(0)) f.push(`the face has no glyph for ${name} in one of its character maps: ${show(was)}`);
    else if (now.length !== was.length || now.some((g, i) => g !== was[i]! + 1)) f.push(`the wrong font maps ${name} to ${show(now)}, not to the glyph after the face's ${show(was)}`);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// AC3: "the bundle's fonts render that text identically to the app's within one code value"

/** A picture's pixels: 8-bit RGBA rows, top-down. */
export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** A PNG's pixels (8-bit RGB or RGBA, not interlaced: what the app's still export and the browser's canvas write). */
export function decodePng(file: Uint8Array): Image {
  const b = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (!b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let p = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (p + 12 <= b.length) {
    const len = b.readUInt32BE(p); const type = b.toString('latin1', p + 4, p + 8); const body = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; } else if (type === 'IDAT') data.push(body); else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`the PNG is depth ${depth}, color type ${color}, interlace ${interlace}; this reader takes 8-bit RGB or RGBA, not interlaced`);
  const ch = color === 6 ? 4 : 3; const stride = width * ch;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch]! : 0; const up = prev[i]!; const c = i >= ch ? prev[i - ch]! : 0; const x = line[i]!;
      line[i] = (filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + up : filter === 3 ? x + ((a + up) >> 1) : x + paeth(a, up, c)) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) rgba[(y * width + x) * 4 + k] = line[x * ch + k]!;
      rgba[(y * width + x) * 4 + 3] = ch === 4 ? line[x * ch + 3]! : 255;
    }
    prev = line;
  }
  return { width, height, rgba };
}
/** The pixels of `box` ([x, y, w, h]) that are ink: more than 64 code values, in some channel, from the box's
 * commonest color (its ground). */
export function inkIn(img: Image, box: readonly [number, number, number, number]): number {
  const [x0, y0, w, h] = box;
  const counts = new Map<number, number>();
  const at = (x: number, y: number): number => (y * img.width + x) * 4;
  const color = (i: number): number => (img.rgba[i]! << 16) | (img.rgba[i + 1]! << 8) | img.rgba[i + 2]!;
  for (let y = y0; y < Math.min(y0 + h, img.height); y++) for (let x = x0; x < Math.min(x0 + w, img.width); x++) { const c = color(at(x, y)); counts.set(c, (counts.get(c) ?? 0) + 1); }
  const ground = [...counts].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 0;
  const g = [ground >> 16, (ground >> 8) & 255, ground & 255];
  let ink = 0;
  for (let y = y0; y < Math.min(y0 + h, img.height); y++) for (let x = x0; x < Math.min(x0 + w, img.width); x++) { const i = at(x, y); if ([0, 1, 2].some((k) => Math.abs(img.rgba[i + k]! - g[k]!) > 64)) ink++; }
  return ink;
}
/** The failures of "the bundle's fonts render that text identically to the app's within one code value": `app` is the
 * app's render of the piece's frame, `bundle` the same frame as the player drew it with the bundle's fonts (or a
 * sentence saying why it drew none). The app's render must show the text (at least `least` ink pixels in the text's
 * `box`), the two must be one size, and every pixel's every channel must be within one code value. A failure names
 * how many pixels differ, the first of them and the largest difference. */
export function renderFailures(app: Image, bundle: Image | string, box: readonly [number, number, number, number], least: number): string[] {
  const ink = inkIn(app, box);
  if (ink < least) return [`the app's own render shows ${ink} ink pixels in the text's box, under ${least}: it doesn't show the text, so it proves nothing about the bundle's fonts`];
  if (typeof bundle === 'string') return [`the bundle's fonts drew no frame to compare: ${bundle}`];
  if (bundle.width !== app.width || bundle.height !== app.height) return [`the bundle's fonts drew ${bundle.width} × ${bundle.height} pixels, the app ${app.width} × ${app.height}`];
  let differ = 0; let worst = 0; let first = '';
  for (let i = 0; i < app.rgba.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(app.rgba[i + k]! - bundle.rgba[i + k]!));
    if (d <= 1) continue;
    if (!differ) first = `(${(i / 4) % app.width}, ${Math.floor(i / 4 / app.width)}): the app's [${[...app.rgba.subarray(i, i + 4)].join(', ')}], the bundle's fonts' [${[...bundle.rgba.subarray(i, i + 4)].join(', ')}]`;
    differ++; worst = Math.max(worst, d);
  }
  return differ ? [`the bundle's fonts draw ${differ.toLocaleString('en-US')} of ${(app.width * app.height).toLocaleString('en-US')} pixels more than one code value from the app's, by up to ${worst}; the first at ${first}`] : [];
}
