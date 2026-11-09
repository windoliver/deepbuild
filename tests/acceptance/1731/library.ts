// The fixture library for the #1731 acceptance tests: 30 models, 5 HDRIs and 5 textures under CC0, CC-BY 4.0 and one
// unknown license, each with its own record, its file (a model's glTF with its .bin sidecar, an HDRI's .hdr, a
// texture's .png) and a thumbnail, all made here from the catalog below, the same bytes every run. It is served over
// HTTPS on 127.0.0.1 by `openLibrary`, which keeps a request log: every request that reached it, in order. The
// library's API is its own (README, The fixture library); the test fill (fixtures/shelf) is the only code that reads it.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { crc32, deflateSync } from 'node:zlib';

export type Kind = 'model' | 'hdri' | 'texture';
/** A license as the library's own record writes it: an SPDX ID when it has one, else none, only its own name. */
export interface RecordLicense { key: string; spdx: string | null; name: string; url: string; attribution: string | null }
export const CC0: RecordLicense = { key: 'cc0', spdx: 'CC0-1.0', name: 'CC0 1.0 Universal', url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: null };
export const CC_BY = (author: string): RecordLicense => ({ key: 'cc-by', spdx: 'CC-BY-4.0', name: 'Creative Commons Attribution 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attribution: `${author}, Shelf` });
/** The one unknown license: the library's own terms, with no SPDX ID. */
export const SHELF_STANDARD: RecordLicense = { key: 'standard', spdx: null, name: 'Shelf Standard License', url: 'https://shelf.example/license', attribution: null };

interface Entry { id: string; name: string; kind: Kind; tags: string[]; size_m: number | null; license: RecordLicense }
const m = (id: string, name: string, tags: string[], size_m: number | null, license: RecordLicense): Entry => ({ id, name, kind: 'model', tags, size_m, license });

/** The catalog. Every chair's tags hold `chair`; the unknown-license model is a chair in range, so the same search finds it. */
const ENTRIES: Entry[] = [
  // 12 chairs: 9 with a stated size in [0.4, 1.2], 2 outside it, 1 with none stated.
  m('oak-chair', 'Oak Dining Chair', ['chair', 'seat', 'wood'], 0.82, CC_BY('Ana Ruiz')),
  m('pine-chair', 'Pine Kitchen Chair', ['chair', 'seat', 'wood'], 0.79, CC0),
  m('office-chair', 'Office Chair', ['chair', 'seat', 'office'], 1.05, CC0),
  m('bar-chair', 'Bar Stool Chair', ['chair', 'stool', 'seat'], 0.62, CC_BY('Lee Park')),
  m('kids-chair', 'Kids Chair', ['chair', 'seat', 'toy'], 0.45, CC0),
  m('wing-chair', 'Wingback Chair', ['chair', 'seat', 'armchair'], 1.18, CC_BY('Ana Ruiz')),
  m('shelf-armchair', 'Shelf Armchair', ['chair', 'armchair', 'seat'], 0.9, SHELF_STANDARD),
  m('lawn-chair', 'Lawn Chair', ['chair', 'seat', 'garden'], 0.95, CC0),
  m('rocking-chair', 'Rocking Chair', ['chair', 'seat', 'wood'], 1.02, CC_BY('Mo Diallo')),
  m('doll-chair', 'Doll House Chair', ['chair', 'toy', 'miniature'], 0.12, CC0),
  m('throne-chair', 'Throne Chair', ['chair', 'seat', 'royal'], 1.6, CC_BY('Lee Park')),
  m('camp-chair', 'Folding Camp Chair', ['chair', 'seat', 'camping'], null, CC0),
  // 18 other models, many in the same size range.
  m('oak-table', 'Oak Table', ['table', 'wood'], 0.75, CC0),
  m('desk', 'Writing Desk', ['desk', 'table', 'office'], 0.76, CC_BY('Mo Diallo')),
  m('floor-lamp', 'Floor Lamp', ['lamp', 'light'], 0.6, CC0),
  m('crate', 'Wooden Crate', ['crate', 'box', 'wood'], 0.5, CC0),
  m('barrel', 'Oak Barrel', ['barrel', 'wood'], 0.9, CC_BY('Ana Ruiz')),
  m('sofa', 'Two-Seat Sofa', ['sofa', 'seat', 'couch'], 0.85, CC0),
  m('bench', 'Park Bench', ['bench', 'seat', 'garden'], 0.45, CC_BY('Lee Park')),
  m('bookshelf', 'Tall Bookshelf', ['shelf', 'books'], 1.8, CC0),
  m('potted-plant', 'Potted Plant', ['plant', 'pot'], 0.7, CC0),
  m('vase', 'Clay Vase', ['vase', 'pot'], 0.3, CC_BY('Mo Diallo')),
  m('bed', 'Single Bed', ['bed', 'bedroom'], 0.55, CC0),
  m('cabinet', 'Kitchen Cabinet', ['cabinet', 'kitchen'], 1.1, CC0),
  m('pine-tree', 'Pine Tree', ['tree', 'nature'], 4.0, CC0),
  m('boulder', 'Mossy Boulder', ['rock', 'nature'], 1.0, CC_BY('Lee Park')),
  m('hatchback', 'Hatchback Car', ['car', 'vehicle'], 1.5, CC0),
  m('mug', 'Coffee Mug', ['mug', 'kitchen'], 0.1, CC0),
  m('front-door', 'Front Door', ['door', 'house'], 2.1, CC_BY('Ana Ruiz')),
  m('picket-fence', 'Picket Fence', ['fence', 'garden'], 1.2, CC0),
  // 5 HDRIs and 5 textures, no size stated.
  { id: 'noon-sky', name: 'Noon Sky', kind: 'hdri', tags: ['sky', 'sun'], size_m: null, license: CC0 },
  { id: 'soft-studio', name: 'Soft Studio', kind: 'hdri', tags: ['studio', 'indoor'], size_m: null, license: CC0 },
  { id: 'field-sunset', name: 'Field at Sunset', kind: 'hdri', tags: ['sky', 'sunset'], size_m: null, license: CC_BY('Mo Diallo') },
  { id: 'night-city', name: 'Night City', kind: 'hdri', tags: ['city', 'night'], size_m: null, license: CC0 },
  { id: 'overcast-forest', name: 'Overcast Forest', kind: 'hdri', tags: ['forest', 'overcast'], size_m: null, license: CC_BY('Lee Park') },
  { id: 'oak-planks', name: 'Oak Planks', kind: 'texture', tags: ['wood', 'floor'], size_m: null, license: CC0 },
  { id: 'red-brick', name: 'Red Brick', kind: 'texture', tags: ['brick', 'wall'], size_m: null, license: CC_BY('Ana Ruiz') },
  { id: 'concrete', name: 'Raw Concrete', kind: 'texture', tags: ['concrete', 'floor'], size_m: null, license: CC0 },
  { id: 'marble', name: 'White Marble', kind: 'texture', tags: ['marble', 'stone'], size_m: null, license: CC0 },
  { id: 'rust-metal', name: 'Rusty Metal', kind: 'texture', tags: ['metal', 'rust'], size_m: null, license: CC_BY('Mo Diallo') },
];

/** A model's triangles: each is a box, 12 triangles. */
export const TRIANGLES = 12;
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

// ---- Bytes: PNG, Radiance HDR, and a glTF box with its .bin sidecar, each a valid file of its type.
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.from([0, ...Array.from({ length: width }, () => rgb).flat()])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function hdr(rgbe: [number, number, number, number]): Buffer {
  return Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 4\n', 'ascii'), Buffer.from(Array.from({ length: 8 }, () => rgbe).flat())]);
}
/** A box `size` tall and half that wide and deep, on y = 0, in metres (glTF's units, +Y up): its .gltf and its .bin. */
function box(id: string, size: number): { gltf: Buffer; bin: Buffer } {
  const w = size / 4;
  const p = [[-w, 0, -w], [w, 0, -w], [w, 0, w], [-w, 0, w], [-w, size, -w], [w, size, -w], [w, size, w], [-w, size, w]];
  const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const positions = Buffer.alloc(p.length * 12);
  p.flat().forEach((v, i) => positions.writeFloatLE(v, i * 4));
  const indices = Buffer.alloc(idx.length * 2);
  idx.forEach((v, i) => indices.writeUInt16LE(v, i * 2));
  const bin = Buffer.concat([positions, indices]);
  const gltf = {
    asset: { version: '2.0', generator: 'dh1731 fixture' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: id }],
    meshes: [{ name: id, primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-w, 0, -w], max: [w, size, w] },
      { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 }, { buffer: 0, byteOffset: positions.length, byteLength: indices.length, target: 34963 }],
    buffers: [{ uri: `${id}.bin`, byteLength: bin.length }],
  };
  return { gltf: Buffer.from(`${JSON.stringify(gltf, null, 2)}\n`), bin };
}
const colorOf = (id: string): [number, number, number] => { const h = createHash('sha256').update(id).digest(); return [h[0]!, h[1]!, h[2]!]; };

/** One file of an asset, as its record lists it. */
export interface FileRecord { path: string; bytes: number; sha256: string }
/** An asset's own record on the library, at /api/assets/<id>. */
export interface AssetRecord {
  id: string; name: string; type: Kind; tags: string[]; size_m: number | null; triangles: number | null;
  license: RecordLicense; url: string; version: string; modified: string; thumbnail: string; files: FileRecord[];
}
export interface Asset { record: AssetRecord; files: Map<string, Buffer>; thumbnail: Buffer }

/** The library's own URL for an asset, its record's version and modified time. */
const pageOf = (id: string): string => `https://shelf.example/a/${id}`;
const VERSION = '3';
const MODIFIED = '2026-09-14T10:00:00Z';

function build(e: Entry): Asset {
  const files = new Map<string, Buffer>();
  if (e.kind === 'model') {
    const { gltf, bin } = box(e.id, e.size_m ?? 0.7);
    files.set(`/files/${e.id}.gltf`, gltf);
    files.set(`/files/${e.id}.bin`, bin);
  } else if (e.kind === 'hdri') files.set(`/files/${e.id}.hdr`, hdr([...colorOf(e.id), 128] as [number, number, number, number]));
  else files.set(`/files/${e.id}.png`, png(4, 4, colorOf(e.id)));
  const thumbnail = png(2, 2, colorOf(`thumb:${e.id}`));
  return {
    files, thumbnail,
    record: {
      id: e.id, name: e.name, type: e.kind, tags: e.tags, size_m: e.size_m, triangles: e.kind === 'model' ? TRIANGLES : null,
      license: e.license, url: pageOf(e.id), version: VERSION, modified: MODIFIED, thumbnail: `/thumbs/${e.id}.png`,
      files: [...files].map(([path, b]) => ({ path, bytes: b.length, sha256: sha256(b) })),
    },
  };
}
export const ASSETS: ReadonlyMap<string, Asset> = new Map(ENTRIES.map((e) => [e.id, build(e)]));
export const asset = (id: string): Asset => ASSETS.get(id) ?? (() => { throw Error(`no fixture asset ${id}`); })();
/** The SHA-256 of an asset's main file (its .gltf, .hdr or .png): what the store holds it by. */
export const fileHash = (id: string): string => asset(id).record.files[0]!.sha256;
/** The bytes of an asset's file and its sidecars together. */
export const totalBytes = (id: string): number => asset(id).record.files.reduce((n, f) => n + f.bytes, 0);
export const thumbHash = (id: string): string => sha256(asset(id).thumbnail);

/**
 * The license the fill reports for a record, by the mapping fixtures/shelf/index.ts makes: the SPDX ID when the
 * record has one, else `LicenseRef-shelf-<key>`; its terms, whether it may be shared, and the credit it asks.
 */
export function reportedLicense(l: RecordLicense): { id: string; terms: string; shareable: boolean; credit: string | null } {
  return { id: l.spdx ?? `LicenseRef-shelf-${l.key}`, terms: l.url, shareable: l.spdx !== null, credit: l.attribution };
}
export const UNKNOWN_ID = reportedLicense(SHELF_STANDARD).id;

/** Whole words, lower-case: an entry's name split on what isn't a letter or digit, and its tags. */
export const wordsOf = (r: AssetRecord): Set<string> => new Set([...r.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean), ...r.tags]);

// ---- The server.
export interface Request { at: number; method: string; path: string }
export interface Library {
  /** host:port, as a grant and the fill name it. */
  host: string;
  /** Every request that reached it, in order. */
  log: Request[];
  /** The requests since index `from`, as text a failure can quote. */
  quote(from?: number): string;
  /** Stops listening and drops every open connection: from then on the host can't be reached (offline). */
  close(): Promise<void>;
}

/** The library's search API: every word (whole words of its name and tags), optionally one type; no size filter. */
function search(url: URL): unknown {
  const words = (url.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const type = url.searchParams.get('type');
  const results = [...ASSETS.values()].map((a) => a.record).filter((r) => (!type || r.type === type) && words.every((w) => wordsOf(r).has(w)))
    .map(({ files: _files, ...entry }) => entry);
  return { total: results.length, results };
}

export async function openLibrary(tls: { key: string; cert: string }): Promise<Library> {
  const log: Request[] = [];
  const server: Server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const url = new URL(req.url ?? '/', 'https://library.invalid');
    log.push({ at: Date.now(), method: req.method ?? '', path: `${url.pathname}${url.search}` });
    req.resume();
    const send = (status: number, type: string, body: Buffer | string) => res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) }).end(body);
    if (req.method !== 'GET') return send(405, 'text/plain', 'GET only');
    if (url.pathname === '/api/search') return send(200, 'application/json', JSON.stringify(search(url)));
    const record = /^\/api\/assets\/([a-z0-9-]+)$/.exec(url.pathname);
    if (record) {
      const a = ASSETS.get(record[1]!);
      return a ? send(200, 'application/json', JSON.stringify(a.record)) : send(404, 'application/json', '{"error":"no such asset"}');
    }
    const thumb = /^\/thumbs\/([a-z0-9-]+)\.png$/.exec(url.pathname);
    if (thumb && ASSETS.has(thumb[1]!)) return send(200, 'image/png', ASSETS.get(thumb[1]!)!.thumbnail);
    for (const a of ASSETS.values()) {
      const bytes = a.files.get(url.pathname);
      if (bytes) return send(200, url.pathname.endsWith('.gltf') ? 'model/gltf+json' : url.pathname.endsWith('.png') ? 'image/png' : 'application/octet-stream', bytes);
    }
    return send(404, 'text/plain', 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  let closed = false;
  return {
    host, log,
    quote: (from = 0) => log.slice(from).map((r) => `${r.method} ${r.path}`).join(', ') || '(no requests)',
    close: () => (closed ? Promise.resolve() : new Promise<void>((resolve) => { closed = true; server.close(() => resolve()); server.closeAllConnections(); })),
  };
}
