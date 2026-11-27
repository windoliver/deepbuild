// Writes #2044's fixtures (README.md beside this file: The fixtures). Kept so each fixture's bytes can be read from
// the code that made them; the tests read the files in fixtures/ and hold each to what its criterion says of it, so
// this script is no part of a test run.
//
//   node tests/acceptance/2044/make-fixtures.mjs
//
// Each fixture states the one number or name its criterion gives and is otherwise a small file with nothing wrong
// in it, so a refusal can only be for that number or name.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const folder = fileURLToPath(new URL('./fixtures/', import.meta.url));
mkdirSync(folder, { recursive: true });
const keep = (name, bytes) => {
  writeFileSync(`${folder}${name}`, bytes);
  console.log(`${name} ${bytes.length} bytes`);
};

// ---- MP4: one video track of four one-byte samples in one chunk, laid out as the base's own writer of a one-track
// MP4 lays its file out (crates/deep-codecs/src/lib.rs, `mux_h264`): ftyp, mdat, then moov with mvhd and one trak
// (tkhd, mdia with mdhd, hdlr and minf; minf with vmhd, dinf and stbl; stbl with stsd, stts, stsz, stsc, stco).

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const zeros = (n) => Buffer.alloc(n);
const box = (kind, ...body) => {
  const bytes = Buffer.concat(body);
  return Buffer.concat([u32(bytes.length + 8), Buffer.from(kind, 'latin1'), bytes]);
};
const full = (kind, versionAndFlags, ...body) => box(kind, u32(versionAndFlags), ...body);

/** The MP4, with its sample size table and its time table as given: `stsz` is [fixed size, count], `stts` its runs. */
function mp4({ stsz, stts }) {
  const samples = Buffer.from([1, 2, 3, 4]);
  const [timescale, duration, width, height] = [25, samples.length, 16, 16];
  const ftyp = box('ftyp', Buffer.from('isom'), u32(512), Buffer.from('isomiso2avc1mp41'));
  const mdat = box('mdat', samples);
  const dataAt = ftyp.length + 8;
  const matrix = Buffer.concat([0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(u32));
  const mvhd = full('mvhd', 0, u32(0), u32(0), u32(timescale), u32(duration), u32(0x10000), Buffer.from([1, 0]), zeros(10), matrix, zeros(24), u32(2));
  const tkhd = full('tkhd', 3, u32(0), u32(0), u32(1), u32(0), u32(duration), zeros(8), zeros(4), zeros(4), matrix, u32(width << 16), u32(height << 16));
  const mdhd = full('mdhd', 0, u32(0), u32(0), u32(timescale), u32(duration), Buffer.from([0x55, 0xc4, 0, 0]));
  const hdlr = full('hdlr', 0, u32(0), Buffer.from('vide'), zeros(12), Buffer.from('VideoHandler\0'));
  const vmhd = full('vmhd', 1, zeros(8));
  const dref = full('dref', 0, u32(1), full('url ', 1));
  const entry = Buffer.concat([zeros(6), Buffer.from([0, 1]), zeros(16), u16(width), u16(height),
    Buffer.from([0, 0x48, 0, 0, 0, 0x48, 0, 0, 0, 0, 0, 0, 0, 1]), zeros(32), Buffer.from([0, 0x18, 0xff, 0xff])]);
  const stbl = box('stbl',
    full('stsd', 0, u32(1), box('avc1', entry)),
    full('stts', 0, u32(stts.length), ...stts.flatMap(([count, delta]) => [u32(count), u32(delta)])),
    full('stsz', 0, u32(stsz[0]), u32(stsz[1])),
    full('stsc', 0, u32(1), u32(1), u32(samples.length), u32(1)),
    full('stco', 0, u32(1), u32(dataAt)));
  const minf = box('minf', vmhd, box('dinf', dref), stbl);
  const moov = box('moov', mvhd, box('trak', tkhd, box('mdia', mdhd, hdlr, minf)));
  return Buffer.concat([ftyp, mdat, moov]);
}

// Criterion 1: `stsz` states a fixed sample size of 1 and 50,000,000 samples; the file holds four bytes of samples.
keep('stsz.mp4', mp4({ stsz: [1, 50_000_000], stts: [[4, 1]] }));
// Criterion 2: `stts` holds 2 runs of 4,000,000,000 samples each; the file holds four samples.
keep('stts.mp4', mp4({ stsz: [1, 4], stts: [[4_000_000_000, 1], [4_000_000_000, 2]] }));

// ---- glTF: JSON with its one buffer inline as a data URI.

const floats = (...values) => { const b = Buffer.alloc(4 * values.length); values.forEach((v, i) => b.writeFloatLE(v, 4 * i)); return b; };
const inline = (bytes) => ({ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` });
const gltf = (doc) => Buffer.from(`${JSON.stringify({ asset: { version: '2.0' }, ...doc, scene: 0 })}\n`);

// Criterion 3: one accessor of count 1,000,000 over a 12-byte buffer view with byteStride 0. The 12 bytes are one row.
keep('accessor.gltf', gltf({
  buffers: [inline(floats(1, 2, 3))],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12, byteStride: 0 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 1_000_000, type: 'VEC3' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  nodes: [{ mesh: 0 }],
  scenes: [{ nodes: [0] }],
}));

// Criterion 4: 24 nodes, each listing the next node twice as its children; the last has no next. No node has a name
// or a mesh, so a node is named by its index alone and a walk that visits a node twice keeps nothing for it.
keep('nodes.gltf', gltf({
  nodes: Array.from({ length: 24 }, (_, i) => (i < 23 ? { children: [i + 1, i + 1] } : {})),
  scenes: [{ nodes: [0] }],
}));

// Criterion 5: two accessors interleaved in one buffer view at byteStride 24 (a position, then its normal, per
// vertex; the second accessor's last row ends on the view's last byte), and two nodes that use one mesh.
const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
const interleaved = Buffer.concat(corners.map((corner) => floats(...corner, 0, 0, 1)));
keep('shared-mesh.gltf', gltf({
  buffers: [inline(interleaved)],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: interleaved.length, byteStride: 24 }],
  accessors: [
    { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
    { bufferView: 0, byteOffset: 12, componentType: 5126, count: 3, type: 'VEC3' },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
  nodes: [{ mesh: 0, translation: [1, 2, 3] }, { mesh: 0, translation: [-4, 5, 6] }],
  scenes: [{ nodes: [0, 1] }],
}));

// ---- SVG, criterion 7: one path; the root has an attribute named `aé`, no such attribute, or one named `ONCLICK`.
const svg = (attribute) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attribute}><path id="mark" d="M1 1h8v8h-8z" fill="#336699"/></svg>\n`, 'utf8');
keep('attribute.svg', svg(' aé="1"'));
keep('attribute-none.svg', svg(''));
keep('attribute-onclick.svg', svg(' ONCLICK="1"'));
