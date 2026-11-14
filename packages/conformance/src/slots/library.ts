// The asset.library@1 kit (#2147, the slot #1731 fills): deep.registerSource's library variant. `search(ctx, query)`
// answers rows of an online library's catalog and `fetch(ctx, {id})` names an asset's file, its sidecars, its license
// and its upstream, both read through `ctx.fetch` from the library's own records; the hub downloads every byte, so a
// fill downloads none. The kit stands in for the library with a small API of its own: `GET /api/search?q=<words>
// [&type=<kind>]` gives every entry holding each word, with no size filter; `GET /api/assets/<id>` an asset's record;
// `GET /files/<name>` a file's bytes. It answers at once, so the preflight's synchronous kit check can drive a fill,
// and logs every path a fill asks for, so a fill's answers are held to the records it was given and to what it read.
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { after, list, object, same, text, word } from './shared.js';

const LIBRARY = 'asset.library@1';

type Kind = 'model' | 'hdri' | 'texture';
interface RecordLicense { key: string; spdx: string | null; name: string; url: string; attribution: string | null }
interface File { path: string; bytes: number; sha256: string }
/** An asset's record on the library, its main file first. */
interface Entry { id: string; name: string; type: Kind; tags: string[]; size_m: number | null; triangles: number | null; license: RecordLicense; thumbnail: string; url: string; version: string; modified: string; files: File[] }
interface LibraryQuery { words: string; kind: Kind | null; size_m: [number, number] | null; license: string[] | null; limit: number }
interface LibraryAnswer { status: number; headers: Record<string, string>; body: string }
/** The hub's call on the library's host; the kit's library answers at once. */
interface LibraryCtx { fetch(request: { method: string; path: string; headers?: Record<string, string> }): Promise<LibraryAnswer> | LibraryAnswer }
interface License { id: string; terms: string; shareable: boolean; credit: string | null }
interface Row { id: string; name: string; kind: Kind; license: License; size_m: number | null; triangles: number | null; thumbnail: string; url: string }
type Fetched = { file: File; sidecars: File[]; license: License; upstream: { url: string; version: string; modified: string } } | { failed: string };
interface LibraryFill extends SlotFill {
  slot: 'asset.library@1';
  variant: 'library';
  search(ctx: LibraryCtx, query: LibraryQuery): Promise<{ rows: Row[] }> | { rows: Row[] };
  fetch(ctx: LibraryCtx, query: { id: string }): Promise<Fetched> | Fetched;
}
interface Input { catalog: Entry[]; query: LibraryQuery; fetch: string }

const RULES = {
  bytes: { id: 'downloads-nothing', rule: 'Search and fetch read only the library\'s catalog and records: neither downloads an asset\'s file, which the hub alone does.', message: 'downloaded an asset\'s file itself' },
  license: { id: 'license-from-record', rule: 'A row\'s and a fetch\'s license is the record\'s: its SPDX ID when it has one, else a LicenseRef- ID of the library\'s own, never another license\'s ID, with the record\'s credit.', message: 'reported a license other than the library\'s record gives' },
  rows: { id: 'rows-as-asked', rule: 'Search answers the library\'s own rows for the query and only those: each holds its words, is of the kind and license asked and has a stated size in the range asked, as many as the limit allows, each as its record states it.', message: 'answered rows other than the library\'s for the query' },
  record: { id: 'fetch-from-record', rule: 'Fetch names the file, sidecars and upstream of the asset\'s own record, and says failed for an ID the library has no record of.', message: 'named a fetch other than the asset\'s record' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

/** The library's stand-in over a catalog, and its log of every path asked for. */
function library(catalog: Entry[]): { ctx: LibraryCtx; log: string[] } {
  const log: string[] = [];
  const answer = (status: number, body: unknown): LibraryAnswer => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ctx: LibraryCtx = {
    fetch: (request) => {
      log.push(request.path);
      const url = new URL(request.path, 'https://library.kit');
      if (url.pathname === '/api/search') {
        const words = wordsOf(url.searchParams.get('q') ?? '');
        const type = url.searchParams.get('type');
        return answer(200, { results: catalog.filter((e) => holds(e, words) && (!type || e.type === type)) });
      }
      const record = url.pathname.startsWith('/api/assets/') ? catalog.find((e) => e.id === decodeURIComponent(url.pathname.slice(12))) : undefined;
      if (record) return answer(200, record);
      if (url.pathname.startsWith('/files/')) return { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: 'kit-bytes' };
      return answer(404, { error: 'not found' });
    },
  };
  return { ctx, log };
}
const wordsOf = (text: string): string[] => text.toLowerCase().split(/\s+/).filter(Boolean);
const holds = (e: Entry, words: string[]): boolean => words.every((w) => e.tags.includes(w) || e.name.toLowerCase().split(/\s+/).includes(w));
/** The rows the query asks for, by ID: a license filter lists SPDX IDs, so a record with none never matches one. */
const asked = ({ catalog, query: q }: Input): string[] => catalog.filter((e) => holds(e, wordsOf(q.words))
  && (!q.kind || e.type === q.kind)
  && (!q.size_m || (e.size_m !== null && e.size_m >= q.size_m[0] && e.size_m <= q.size_m[1]))
  && (!q.license || (e.license.spdx !== null && q.license.includes(e.license.spdx)))).map((e) => e.id);

type Fault = 'none' | 'measures-by-download' | 'reports-cc0' | 'keeps-unsized' | 'drops-sidecars';
function reference(fault: Fault = 'none'): LibraryFill {
  const licenseOf = (l: RecordLicense): License => (fault === 'reports-cc0' && l.spdx === null
    ? { id: 'CC0-1.0', terms: 'https://creativecommons.org/publicdomain/zero/1.0/', shareable: true, credit: null }
    : { id: l.spdx ?? `LicenseRef-kit-${l.key}`, terms: l.url, shareable: l.spdx !== null, credit: l.attribution });
  return {
    slot: LIBRARY, revision: 1, variant: 'library',
    search(ctx, q) {
      const params = new URLSearchParams({ q: q.words });
      if (q.kind) params.set('type', q.kind);
      return after(ctx.fetch({ method: 'GET', path: `/api/search?${params}` }), (a) => {
        const rows: Row[] = [];
        for (const e of (JSON.parse(a.body) as { results: Entry[] }).results) {
          // The planted measure: the model's main file downloaded to read its height, whatever its record states.
          if (fault === 'measures-by-download' && e.type === 'model') void ctx.fetch({ method: 'GET', path: e.files[0]!.path });
          if (q.size_m && (e.size_m === null ? fault !== 'keeps-unsized' : e.size_m < q.size_m[0] || e.size_m > q.size_m[1])) continue;
          const license = licenseOf(e.license);
          if (q.license && !q.license.includes(license.id)) continue;
          rows.push({ id: e.id, name: e.name, kind: e.type, license, size_m: e.size_m, triangles: e.triangles, thumbnail: e.thumbnail, url: e.url });
        }
        return { rows: rows.slice(0, q.limit) };
      });
    },
    fetch(ctx, q) {
      return after(ctx.fetch({ method: 'GET', path: `/api/assets/${encodeURIComponent(q.id)}` }), (a): Fetched => {
        if (a.status === 404) return { failed: 'not found' };
        const r = JSON.parse(a.body) as Entry;
        const [file, ...sidecars] = r.files;
        return { file: file!, sidecars: fault === 'drops-sidecars' ? [] : sidecars, license: licenseOf(r.license), upstream: { url: r.url, version: r.version, modified: r.modified } };
      });
    },
  };
}

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: LibraryFill): PlantedFill<LibraryFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (): PlantedFill<LibraryFill>[] => [
  plant('measures-by-download', 'bytes', ['file_downloaded'], reference('measures-by-download')),
  plant('reports-cc0', 'license', ['license_not_record'], reference('reports-cc0')),
  plant('keeps-unsized', 'rows', ['row_not_asked'], reference('keeps-unsized')),
  plant('drops-sidecars', 'record', ['fetch_not_record'], reference('drops-sidecars')),
];

const CC0: RecordLicense = { key: 'cc0', spdx: 'CC0-1.0', name: 'CC0 1.0 Universal', url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: null };
const CC_BY: RecordLicense = { key: 'cc-by', spdx: 'CC-BY-4.0', name: 'Creative Commons Attribution 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'Ana Ruiz, Kit Library' };
/** The library's own terms, with no SPDX ID. */
const STANDARD: RecordLicense = { key: 'standard', spdx: null, name: 'Kit Standard License', url: 'https://library.kit/license', attribution: null };
const LICENSES = [CC0, CC_BY, STANDARD];
const hex = (id: string, n: number): string => Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(id.charCodeAt(i % id.length) + i + n) % 16]).join('');
function entry(id: string, name: string, type: Kind, tags: string[], size_m: number | null, license: RecordLicense): Entry {
  const main = type === 'model' ? [`${id}.gltf`, `${id}.bin`] : [`${id}.${type === 'hdri' ? 'hdr' : 'png'}`];
  return {
    id, name, type, tags, size_m, triangles: type === 'model' ? 12 : null, license, thumbnail: `/thumbs/${id}.png`, url: `https://library.kit/a/${id}`,
    version: '1', modified: '2026-10-01T00:00:00Z', files: main.map((file, i) => ({ path: `/files/${file}`, bytes: 1024 * (i + 1), sha256: hex(id, i) })),
  };
}
const CATALOG: Entry[] = [
  entry('oak-chair', 'Oak Dining Chair', 'model', ['chair', 'seat', 'wood'], 0.82, CC_BY),
  entry('pine-chair', 'Pine Kitchen Chair', 'model', ['chair', 'seat', 'wood'], 0.79, CC0),
  entry('kit-armchair', 'Kit Armchair', 'model', ['chair', 'armchair'], 0.9, STANDARD),
  entry('camp-chair', 'Folding Camp Chair', 'model', ['chair', 'camping'], null, CC0),
  entry('throne-chair', 'Throne Chair', 'model', ['chair', 'royal'], 1.6, CC_BY),
  entry('oak-table', 'Oak Table', 'model', ['table', 'wood'], 0.75, CC0),
  entry('oak-planks', 'Oak Planks', 'texture', ['wood', 'floor'], null, CC0),
];

const toCase = (id: string, part: 'fixed' | 'seeded', input: Input): SlotCase => ({ id, part, input: input as unknown as JsonValue, expected: { rows: asked(input) } });
const fixtures: Fixture[] = [
  toCase('chairs-in-range', 'fixed', { catalog: CATALOG, query: { words: 'chair', kind: null, size_m: [0.4, 1.2], license: null, limit: 50 }, fetch: 'oak-chair' }),
  toCase('cc0-wood-model-then-unknown', 'fixed', { catalog: CATALOG, query: { words: 'wood', kind: 'model', size_m: null, license: ['CC0-1.0'], limit: 1 }, fetch: 'no-such-asset' }),
].map(({ id, input, expected }) => ({ id, input, expected }));

/** Three catalogs from the draw, each with a sized query and a fetch of one of its assets or of none. */
const generate = (random: Random): SlotCase[] => [0, 1, 2].map((i) => {
  const tag = word(random, 5);
  const catalog = Array.from({ length: random.int(3, 8) }, (_, j) => entry(`${word(random, 6)}-${j}`, `${word(random, 4)} ${word(random, 5)}`, random.pick(['model', 'hdri', 'texture'] as Kind[]),
    random.int(0, 3) ? [tag, word(random, 4)] : [word(random, 4)], random.int(0, 4) ? random.int(5, 300) / 100 : null, random.pick(LICENSES)));
  const low = random.int(10, 150) / 100;
  return toCase(`seeded-${i + 1}`, 'seeded', { catalog, query: { words: tag, kind: null, size_m: [low, low + 1], license: null, limit: random.int(1, 8) }, fetch: i === 2 ? 'no-such-asset' : catalog[random.int(0, catalog.length - 1)]!.id });
});

function holdLicense(what: string, got: unknown, own: RecordLicense): void {
  const l = object(`${what}'s license`, got);
  const id = text(`${what}'s license id`, l.id);
  const fits = own.spdx === null ? id.startsWith('LicenseRef-') : id === own.spdx;
  if (!fits || l.credit !== own.attribution) throw fail(RULES.license.message, ['license_not_record'], `${what} has the license ${id} crediting ${JSON.stringify(l.credit)}; the library's record says ${own.spdx ?? `${own.name}, with no SPDX ID`} crediting ${JSON.stringify(own.attribution)}`);
}
function downloaded(log: string[], what: string): void {
  const files = log.filter((path) => path.startsWith('/files/'));
  if (files.length) throw fail(RULES.bytes.message, ['file_downloaded'], `${what} asked the library for ${files.join(', ')}; the request log: ${log.join(', ')}`);
}

function* judge(fill: LibraryFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const input = c.input as unknown as Input;
  const want = (c.expected as { rows: string[] }).rows;
  const { ctx, log } = library(input.catalog);
  const found = object('search\'s answer', yield () => fill.search(ctx, structuredClone(input.query)));
  downloaded(log, 'its search');
  const ids: string[] = [];
  for (const r of list('search\'s rows', found.rows)) {
    const row = object('a row', r);
    const own = input.catalog.find((e) => e.id === row.id);
    if (own) holdLicense(`row ${own.id}`, row.license, own.license);
    if (!own || !want.includes(own.id) || ids.includes(own.id)) throw fail(RULES.rows.message, ['row_not_asked'], `answered the row ${JSON.stringify(row.id)}${own && ids.includes(own.id) ? ' twice' : ''}; the query ${JSON.stringify(input.query)} asks for ${want.join(', ') || 'none'}`);
    const stated = { name: own.name, kind: own.type, size_m: own.size_m, triangles: own.triangles, thumbnail: own.thumbnail, url: own.url };
    const given = { name: row.name, kind: row.kind, size_m: row.size_m, triangles: row.triangles, thumbnail: row.thumbnail, url: row.url };
    if (!same(given, stated)) throw fail(RULES.rows.message, ['row_not_record'], `row ${own.id} says ${JSON.stringify(given)}; its record says ${JSON.stringify(stated)}`);
    ids.push(own.id);
  }
  const room = Math.min(input.query.limit, want.length);
  if (ids.length !== room) throw fail(RULES.rows.message, ['row_not_asked'], `answered ${ids.length} rows; the query asks for ${room} of ${want.join(', ') || 'none'}`);
  const got = object('fetch\'s answer', yield () => fill.fetch(ctx, { id: input.fetch }));
  downloaded(log, 'its fetch');
  const own = input.catalog.find((e) => e.id === input.fetch);
  if (!own) {
    if (typeof got.failed !== 'string') throw fail(RULES.record.message, ['fetch_not_record'], `answered ${JSON.stringify(got)} for ${input.fetch}, which the library has no record of`);
    return;
  }
  if ('failed' in got) throw fail(RULES.record.message, ['fetch_not_record'], `said ${JSON.stringify(got.failed)} for ${own.id}, which the library has a record of`);
  holdLicense(`the fetch of ${own.id}`, got.license, own.license);
  const [file, ...sidecars] = own.files;
  const stated = { file, sidecars, upstream: { url: own.url, version: own.version, modified: own.modified } };
  const given = { file: got.file, sidecars: got.sidecars, upstream: got.upstream };
  if (!same(given, stated)) throw fail(RULES.record.message, ['fetch_not_record'], `the fetch of ${own.id} names ${JSON.stringify(given)}; its record says ${JSON.stringify(stated)}`);
}

export const libraryKit = (): SlotKitImpl<LibraryFill> => ({
  slot: LIBRARY, fills: 'many', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
